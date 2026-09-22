const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'google-sync-ui.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function createHarness(initialStatus) {
    const elements = new Map();
    const windowListeners = new Map();
    const calls = [];
    const confirmations = [];
    const state = { status: initialStatus, confirm: true, nextResponse: null };

    function getElement(id) {
        if (!elements.has(id)) {
            const listeners = new Map();
            elements.set(id, {
                hidden: false,
                disabled: false,
                checked: false,
                value: '',
                textContent: '',
                setAttribute() {},
                addEventListener(name, callback) {
                    listeners.set(name, callback);
                },
                click() {
                    if (this.hidden || this.disabled) return;
                    listeners.get('click')?.();
                },
                change(value) {
                    if (this.hidden || this.disabled) return;
                    if (typeof value === 'boolean') this.checked = value;
                    else this.value = String(value);
                    listeners.get('change')?.();
                }
            });
        }
        return elements.get(id);
    }

    vm.runInNewContext(source, {
        document: {
            getElementById: getElement,
            querySelector: () => getElement('backupTab'),
            addEventListener() {}
        },
        window: {
            confirm(message) {
                confirmations.push(message);
                return state.confirm;
            },
            addEventListener(name, callback) {
                windowListeners.set(name, callback);
            }
        },
        chrome: {
            runtime: {
                async sendMessage(message) {
                    calls.push(JSON.parse(JSON.stringify(message)));
                    if (state.nextResponse) {
                        const response = state.nextResponse;
                        state.nextResponse = null;
                        return response;
                    }
                    return { ok: true, status: state.status };
                }
            },
            storage: { onChanged: { addListener() {} } }
        }
    });

    return { state, calls, confirmations, element: getElement, focus: () => windowListeners.get('focus')() };
}

function enabledStatus(extra = {}) {
    return {
        available: true,
        configured: true,
        enabled: true,
        busy: false,
        state: 'idle',
        accountEmail: 'reader@example.com',
        ...extra
    };
}

test('동기화가 지원되지 않는 설치본은 상태만 조회하고 연결 기능을 제공하지 않는다', async () => {
    const harness = createHarness({ available: false, configured: true, enabled: false });
    await settle();

    assert.equal(harness.element('googleSyncConnectBtn').hidden, true);
    assert.equal(harness.element('googleSyncNowBtn').hidden, true);
    assert.match(harness.element('googleSyncStatus').textContent, /동기화 지원 배포 파일/);
    assert.deepEqual(harness.calls, [{ action: 'GOOGLE_SYNC_STATUS' }]);
});

test('접힌 패널 제목의 배지는 확인 대기와 오류를 알리고 정상 상태에서는 숨긴다', async () => {
    const conflict = { token: 'pending', reason: 'both-changed', localCount: 3, remoteCount: 4 };
    const harness = createHarness(enabledStatus({ state: 'conflict', conflict }));
    await settle();
    const badge = harness.element('googleSyncSummaryBadge');
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, '확인 필요');

    harness.state.status = enabledStatus({ state: 'error', conflict, error: '네트워크 오류' });
    harness.focus();
    await settle();
    assert.equal(badge.textContent, '확인 필요');

    harness.state.status = enabledStatus({ state: 'error', error: '네트워크 오류' });
    harness.focus();
    await settle();
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, '동기화 오류');

    harness.state.status = enabledStatus();
    harness.focus();
    await settle();
    assert.equal(badge.hidden, true);
    assert.equal(badge.textContent, '');

    harness.state.status = enabledStatus({ enabled: false, state: 'disabled', conflict });
    harness.focus();
    await settle();
    assert.equal(badge.hidden, true);
});

test('동기화 요청 중에는 중복 실행과 연결 해제를 막는다', async () => {
    const harness = createHarness(enabledStatus());
    await settle();
    let finish;
    harness.state.nextResponse = new Promise(resolve => { finish = resolve; });
    harness.element('googleSyncNowBtn').click();

    assert.equal(harness.element('googleSyncNowBtn').disabled, true);
    assert.equal(harness.element('googleSyncDisconnectBtn').disabled, true);
    for (const name of ['AutoSync', 'IntervalMinutes', 'SyncOnStartup', 'SyncOnChange']) {
        assert.equal(harness.element(`googleSync${name}`).disabled, true);
    }
    harness.element('googleSyncNowBtn').click();
    assert.equal(harness.calls.filter(call => call.action === 'GOOGLE_SYNC_NOW').length, 1);

    finish({ ok: true, status: enabledStatus() });
    await settle();
    assert.equal(harness.element('googleSyncNowBtn').disabled, false);
});

test('목록 충돌은 확인한 선택과 충돌 토큰을 함께 전송한다', async () => {
    const harness = createHarness(enabledStatus({
        state: 'conflict',
        conflict: { token: 'conflict-123', localCount: 10, remoteCount: 20 }
    }));
    await settle();
    assert.equal(harness.element('googleSyncConflict').hidden, false);
    assert.equal(harness.element('googleSyncNowBtn').disabled, true);
    assert.match(harness.element('googleSyncConflictDetails').textContent, /10권.*20권/);

    harness.state.confirm = false;
    harness.element('googleSyncUseRemoteBtn').click();
    assert.equal(harness.calls.length, 1);

    harness.state.confirm = true;
    harness.element('googleSyncUseLocalBtn').click();
    await settle();
    assert.deepEqual(harness.calls[1], {
        action: 'GOOGLE_SYNC_RESOLVE',
        resolution: 'local',
        conflictToken: 'conflict-123'
    });
    assert.match(harness.confirmations[0], /로컬 복원 지점/);
    assert.match(harness.confirmations[1], /전체 교체/);
});

test('삭제 보호 화면과 최종 확인에 선택별 대상과 변경 건수를 표시한다', async () => {
    const harness = createHarness(enabledStatus({
        state: 'conflict',
        conflict: {
            token: 'deletion-123', reason: 'deletion', proposedDirection: 'upload',
            localCount: 10, remoteCount: 20,
            localChanges: { added: 2, updated: 3, removed: 12 },
            remoteChanges: { added: 12, updated: 3, removed: 2 }
        }
    }));
    await settle();

    assert.match(harness.element('googleSyncConflictReason').textContent, /Google 목록의 도서가 삭제/);
    assert.equal(harness.element('googleSyncLocalChanges').textContent, '이 기기 목록 사용 → Google 목록: 추가 2건 · 수정 3건 · 삭제 12건');
    assert.equal(harness.element('googleSyncRemoteChanges').textContent, 'Google 목록 사용 → 이 기기 목록: 추가 12건 · 수정 3건 · 삭제 2건');
    assert.equal(harness.element('googleSyncNowBtn').disabled, true);

    harness.state.confirm = false;
    harness.element('googleSyncUseLocalBtn').click();
    harness.element('googleSyncUseRemoteBtn').click();
    assert.match(harness.confirmations[0], /Google 목록: 추가 2건 · 수정 3건 · 삭제 12건/);
    assert.match(harness.confirmations[0], /교체 전 Google 목록을 이 기기의 로컬 복원 지점에 먼저 저장/);
    assert.match(harness.confirmations[1], /이 기기 목록: 추가 12건 · 수정 3건 · 삭제 2건/);
    assert.match(harness.confirmations[1], /현재 목록은 로컬 복원 지점에 먼저 저장/);
    assert.match(harness.confirmations[1], /목록을 다시 확인.*내용이 바뀌었으면 다시 선택/);
    assert.equal(harness.calls.length, 1);
});

test('Google 파일이 사라졌을 때는 비어 있는 목록 적용 없이 재저장만 선택한다', async () => {
    const harness = createHarness(enabledStatus({
        state: 'conflict',
        conflict: {
            token: 'missing-123', reason: 'remote-missing',
            localCount: 10, remoteCount: 0,
            localChanges: { added: 10, updated: 0, removed: 0 }
        }
    }));
    await settle();

    assert.match(harness.element('googleSyncConflictReason').textContent, /Google 파일을 찾을 수 없습니다/);
    assert.equal(harness.element('googleSyncConflictDetails').textContent, '이 기기 10권 · Google 파일 없음');
    assert.equal(harness.element('googleSyncUseRemoteBtn').hidden, true);
    assert.equal(harness.element('googleSyncUseRemoteBtn').disabled, true);
    assert.equal(harness.element('googleSyncRemoteChanges').hidden, true);
    harness.element('googleSyncUseRemoteBtn').click();
    assert.equal(harness.calls.length, 1);

    harness.element('googleSyncUseLocalBtn').click();
    await settle();
    assert.match(harness.confirmations[0], /Google에 다시 저장/);
    assert.doesNotMatch(harness.confirmations[0], /Google 목록 0권을 전체 교체/);
    assert.doesNotMatch(harness.confirmations[0], /Google 목록을 이 기기의 로컬 복원 지점/);
    assert.deepEqual(harness.calls[1], {
        action: 'GOOGLE_SYNC_RESOLVE', resolution: 'local', conflictToken: 'missing-123'
    });
});

test('확인 후 목록이 바뀌면 새로운 변경 내역과 토큰으로 다시 선택한다', async () => {
    const conflict = {
        token: 'before', reason: 'both-changed', localCount: 5, remoteCount: 8,
        localChanges: { added: 1, updated: 2, removed: 4 },
        remoteChanges: { added: 4, updated: 2, removed: 1 }
    };
    const harness = createHarness(enabledStatus({ state: 'conflict', conflict }));
    await settle();
    const updatedConflict = {
        ...conflict, token: 'after', reason: 'review-required', remoteCount: 9,
        localChanges: { added: 1, updated: 3, removed: 5 },
        remoteChanges: { added: 5, updated: 3, removed: 1 }
    };
    harness.state.status = enabledStatus({ state: 'conflict', conflict: updatedConflict });
    harness.state.nextResponse = Promise.resolve({
        ok: false, error: '목록이 변경되었습니다. 다시 확인해 주세요.', status: harness.state.status
    });
    harness.element('googleSyncUseRemoteBtn').click();
    await settle();

    assert.equal(harness.calls[1].conflictToken, 'before');
    assert.equal(harness.element('googleSyncNowBtn').disabled, true);
    assert.match(harness.element('googleSyncConflictReason').textContent, /다시 확인이 필요/);
    assert.match(harness.element('googleSyncConflictDetails').textContent, /Google 9권/);
    assert.match(harness.element('googleSyncRemoteChanges').textContent, /추가 5건 · 수정 3건 · 삭제 1건/);
    harness.element('googleSyncUseRemoteBtn').click();
    await settle();
    assert.equal(harness.calls[2].conflictToken, 'after');
    assert.match(harness.confirmations[1], /Google 도서 목록 9권/);
});

test('충돌 원인에 맞는 안내를 표시하고 이전 형식의 건수를 0으로 단정하지 않는다', async () => {
    const reasons = [
        ['both-changed', null, /이 기기와 Google 목록이 모두 변경/],
        ['initial-difference', null, /처음 연결한 두 목록/],
        ['remote-replaced', null, /이전과 다른 파일/],
        ['local-restore', null, /복원하거나 전체 교체/],
        ['deletion', 'download', /이 기기 목록의 도서가 삭제/]
    ];
    for (const [reason, proposedDirection, expected] of reasons) {
        const harness = createHarness(enabledStatus({
            state: 'conflict',
            conflict: { token: reason, reason, proposedDirection, localCount: 4, remoteCount: 3 }
        }));
        await settle();
        assert.match(harness.element('googleSyncConflictReason').textContent, expected);
        assert.match(harness.element('googleSyncLocalChanges').textContent, /변경 내역을 다시 확인/);
        assert.doesNotMatch(harness.element('googleSyncLocalChanges').textContent, /삭제 0건/);
    }
});

test('연결 해제는 확인 후 실행하며 데이터 유지 안내를 제공한다', async () => {
    const harness = createHarness(enabledStatus());
    await settle();
    harness.state.confirm = false;
    harness.element('googleSyncDisconnectBtn').click();
    assert.equal(harness.calls.length, 1);

    harness.state.confirm = true;
    harness.state.status = enabledStatus({ enabled: false, state: 'disabled' });
    harness.element('googleSyncDisconnectBtn').click();
    await settle();
    assert.equal(harness.calls[1].action, 'GOOGLE_SYNC_DISCONNECT');
    assert.equal(harness.element('googleSyncConnectBtn').hidden, false);
    assert.match(harness.confirmations[1], /목록은 유지/);
});

test('실패 메시지를 표시하고 다음 실행에서 복구할 수 있다', async () => {
    const harness = createHarness(enabledStatus());
    await settle();
    harness.state.nextResponse = Promise.resolve({ ok: false, error: '네트워크 연결을 확인해 주세요.' });
    harness.element('googleSyncNowBtn').click();
    await settle();

    assert.equal(harness.element('googleSyncError').textContent, '네트워크 연결을 확인해 주세요.');
    assert.equal(harness.element('googleSyncNowBtn').disabled, false);
    harness.element('googleSyncNowBtn').click();
    await settle();
    assert.equal(harness.element('googleSyncError').hidden, true);
});

test('늦게 도착한 상태 조회는 이후 연결 결과를 덮어쓰지 않는다', async () => {
    const disconnected = enabledStatus({ enabled: false, state: 'disabled' });
    const harness = createHarness(disconnected);
    await settle();
    let finishRefresh;
    harness.state.nextResponse = new Promise(resolve => { finishRefresh = resolve; });
    harness.focus();
    harness.state.status = enabledStatus();
    harness.element('googleSyncConnectBtn').click();
    await settle();

    finishRefresh({ ok: true, status: disconnected });
    await settle();
    assert.equal(harness.element('googleSyncConnectBtn').hidden, true);
    assert.equal(harness.element('googleSyncNowBtn').hidden, false);
    assert.match(harness.element('googleSyncAccount').textContent, /reader@example.com/);
});

test('동기화 옵션은 기본값을 표시하고 연결할 수 없는 설치본에서도 저장한다', async () => {
    const harness = createHarness({ available: false, configured: false, enabled: false });
    await settle();

    assert.equal(harness.element('googleSyncAutoSync').checked, true);
    assert.equal(harness.element('googleSyncAutoSync').disabled, false);
    assert.equal(harness.element('googleSyncIntervalMinutes').value, '5');
    assert.equal(harness.element('googleSyncSyncOnStartup').checked, true);
    assert.equal(harness.element('googleSyncSyncOnChange').checked, true);

    const preferences = { autoSync: true, intervalMinutes: 30, syncOnStartup: true, syncOnChange: true };
    harness.state.status = { ...harness.state.status, preferences };
    harness.element('googleSyncIntervalMinutes').change('30');
    await settle();

    assert.deepEqual(harness.calls[1], { action: 'GOOGLE_SYNC_UPDATE_PREFERENCES', preferences });
    assert.equal(harness.element('googleSyncIntervalMinutes').value, '30');
    assert.match(harness.element('googleSyncSchedule').textContent, /약 30분 간격/);
    assert.equal(harness.element('googleSyncConnectBtn').hidden, true);
});

test('자동 동기화를 끄면 하위 옵션을 보존해 비활성화하고 지금 동기화는 허용한다', async () => {
    const preferences = { autoSync: true, intervalMinutes: 15, syncOnStartup: false, syncOnChange: true };
    const harness = createHarness(enabledStatus({ preferences }));
    await settle();
    let finish;
    harness.state.nextResponse = new Promise(resolve => { finish = resolve; });
    harness.element('googleSyncAutoSync').change(false);

    assert.equal(harness.element('googleSyncAutoSync').checked, false);
    assert.equal(harness.element('googleSyncAutoSync').disabled, true);
    assert.equal(harness.element('googleSyncIntervalMinutes').disabled, true);
    assert.equal(harness.element('googleSyncSyncOnStartup').disabled, true);
    assert.equal(harness.element('googleSyncSyncOnChange').disabled, true);
    assert.deepEqual(harness.calls[1], {
        action: 'GOOGLE_SYNC_UPDATE_PREFERENCES',
        preferences: { ...preferences, autoSync: false }
    });
    harness.element('googleSyncSyncOnChange').change(false);
    assert.equal(harness.calls.length, 2);

    harness.state.status = enabledStatus({ preferences: { ...preferences, autoSync: false } });
    finish({ ok: true, status: harness.state.status });
    await settle();

    assert.equal(harness.element('googleSyncAutoSync').disabled, false);
    assert.equal(harness.element('googleSyncIntervalMinutes').disabled, true);
    assert.equal(harness.element('googleSyncSyncOnStartup').checked, false);
    assert.equal(harness.element('googleSyncSyncOnChange').checked, true);
    assert.match(harness.element('googleSyncStatus').textContent, /수동 동기화 모드/);
    assert.doesNotMatch(harness.element('googleSyncSchedule').textContent, /약 15분/);
    assert.equal(harness.element('googleSyncNowBtn').disabled, false);
    harness.element('googleSyncNowBtn').click();
    await settle();
    assert.equal(harness.calls[2].action, 'GOOGLE_SYNC_NOW');
});

test('옵션 저장 실패 시 기존 설정을 복구하고 오류를 표시한다', async () => {
    const preferences = { autoSync: true, intervalMinutes: 60, syncOnStartup: true, syncOnChange: false };
    const harness = createHarness(enabledStatus({ preferences }));
    await settle();
    harness.state.nextResponse = Promise.resolve({ ok: false, error: '옵션을 저장하지 못했습니다.' });
    harness.element('googleSyncAutoSync').change(false);
    await settle();

    assert.equal(harness.element('googleSyncAutoSync').checked, true);
    assert.equal(harness.element('googleSyncIntervalMinutes').value, '60');
    assert.equal(harness.element('googleSyncIntervalMinutes').disabled, false);
    assert.equal(harness.element('googleSyncSyncOnChange').checked, false);
    assert.equal(harness.element('googleSyncError').textContent, '옵션을 저장하지 못했습니다.');
    assert.match(harness.element('googleSyncSchedule').textContent, /Chrome 시작 시/);
    assert.doesNotMatch(harness.element('googleSyncSchedule').textContent, /변경 후 약 30초/);
});

test('시작 및 변경 옵션을 끄면 안내를 갱신하고 연결을 해제해도 설정을 유지한다', async () => {
    let preferences = { autoSync: true, intervalMinutes: 15, syncOnStartup: true, syncOnChange: true };
    const harness = createHarness(enabledStatus({ preferences }));
    await settle();

    preferences = { ...preferences, syncOnStartup: false };
    harness.state.status = enabledStatus({ preferences });
    harness.element('googleSyncSyncOnStartup').change(false);
    await settle();
    assert.equal(harness.calls[1].preferences.syncOnStartup, false);
    assert.doesNotMatch(harness.element('googleSyncSchedule').textContent, /Chrome 시작 시/);

    preferences = { ...preferences, syncOnChange: false };
    harness.state.status = enabledStatus({ preferences });
    harness.element('googleSyncSyncOnChange').change(false);
    await settle();
    assert.equal(harness.calls[2].preferences.syncOnChange, false);
    assert.doesNotMatch(harness.element('googleSyncSchedule').textContent, /변경 후 약 30초/);

    harness.state.status = enabledStatus({ enabled: false, state: 'disabled', preferences });
    harness.element('googleSyncDisconnectBtn').click();
    await settle();
    assert.equal(harness.element('googleSyncIntervalMinutes').value, '15');
    assert.equal(harness.element('googleSyncSyncOnStartup').checked, false);
    assert.equal(harness.element('googleSyncSyncOnChange').checked, false);
    assert.equal(harness.element('googleSyncAutoSync').disabled, false);
});
