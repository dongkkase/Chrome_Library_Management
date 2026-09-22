(() => {
    'use strict';

    const panel = document.getElementById('googleSyncPanel');
    if (!panel) return;

    const elements = Object.fromEntries([
        'Status', 'SummaryBadge', 'Account', 'LastTime', 'Error', 'ConnectBtn', 'NowBtn',
        'DisconnectBtn', 'Conflict', 'ConflictReason', 'ConflictDetails',
        'LocalChanges', 'RemoteChanges', 'UseLocalBtn', 'UseRemoteBtn',
        'AutoSync', 'IntervalMinutes', 'SyncOnStartup', 'SyncOnChange', 'Schedule'
    ].map(name => [name, document.getElementById(`googleSync${name}`)]));
    const defaultPreferences = {
        autoSync: true,
        intervalMinutes: 5,
        syncOnStartup: true,
        syncOnChange: true
    };
    let currentStatus = null;
    let pendingPreferences = null;
    let requestInFlight = false;
    let refreshInFlight = false;
    let requestEpoch = 0;
    let requestError = '';

    function formatTime(value) {
        if (!value) return '';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        });
    }

    function setOptionalText(element, text) {
        element.textContent = text;
        element.hidden = !text;
    }

    function conflictReason(conflict) {
        switch (conflict.reason) {
            case 'both-changed':
                return '마지막 동기화 이후 이 기기와 Google 목록이 모두 변경되었습니다. 사용할 목록을 확인해 주세요.';
            case 'initial-difference':
                return '처음 연결한 두 목록이 서로 다릅니다. 사용할 목록을 확인해 주세요.';
            case 'remote-missing':
                return '이전에 동기화한 Google 파일을 찾을 수 없습니다. 이 기기 목록을 Google에 다시 저장할지 확인해 주세요.';
            case 'remote-replaced':
                return 'Google 동기화 파일이 이전과 다른 파일로 바뀌었습니다. 사용할 목록을 확인해 주세요.';
            case 'local-restore':
                return '이 기기의 목록을 복원하거나 전체 교체했습니다. 다른 기기에 반영할 목록을 확인해 주세요.';
            case 'deletion':
                if (conflict.proposedDirection === 'upload') {
                    return '이 기기 목록을 적용하면 Google 목록의 도서가 삭제됩니다. 삭제 건수를 확인해 주세요.';
                }
                if (conflict.proposedDirection === 'download') {
                    return 'Google 목록을 적용하면 이 기기 목록의 도서가 삭제됩니다. 삭제 건수를 확인해 주세요.';
                }
                return '목록 적용 시 삭제되는 도서가 있습니다. 삭제 건수를 확인해 주세요.';
            case 'review-required':
                return '목록을 안전하게 적용하려면 다시 확인이 필요합니다. 최신 변경 건수를 확인한 뒤 사용할 목록을 선택해 주세요.';
            default:
                return '두 목록이 달라 사용할 목록을 선택해야 합니다.';
        }
    }

    function changeSummary(changes) {
        if (!changes || !['added', 'updated', 'removed'].every(key => Number.isSafeInteger(changes[key]) && changes[key] >= 0)) {
            return '변경 내역을 다시 확인한 뒤 적용합니다.';
        }
        return `추가 ${changes.added.toLocaleString('ko-KR')}건 · 수정 ${changes.updated.toLocaleString('ko-KR')}건 · 삭제 ${changes.removed.toLocaleString('ko-KR')}건`;
    }

    function conflictImpact(conflict, resolution) {
        return resolution === 'local'
            ? `이 기기 목록 사용 → Google 목록: ${changeSummary(conflict.localChanges)}`
            : `Google 목록 사용 → 이 기기 목록: ${changeSummary(conflict.remoteChanges)}`;
    }

    function renderStatus() {
        const status = currentStatus;
        const available = !!(status && status.available && status.configured);
        const enabled = !!(status && status.enabled);
        const busy = requestInFlight || !!(status && (status.busy || status.state === 'syncing'));
        const conflict = enabled && status.state === 'conflict' ? status.conflict : null;
        const preferences = pendingPreferences || { ...defaultPreferences, ...(status && status.preferences) };
        let summary = '동기화 상태를 확인하고 있습니다.';

        if (status) {
            if (!status.available) {
                summary = status.unavailableReason || '이 설치본에서는 Google 동기화를 사용할 수 없습니다. 동기화 지원 배포 파일을 사용해 주세요.';
            } else if (!status.configured) {
                summary = status.unavailableReason || '현재 배포본에서는 Google 동기화를 준비 중입니다.';
            } else if (busy) {
                summary = 'Google 동기화를 처리하고 있습니다.';
            } else if (!enabled) {
                summary = 'Google 계정을 연결하면 동기화를 시작합니다.';
            } else if (conflict) {
                summary = '목록 선택이 필요해 자동 동기화를 멈췄습니다.';
            } else if (status.state === 'error') {
                summary = '동기화를 완료하지 못했습니다. 아래 내용을 확인해 주세요.';
            } else if (!preferences.autoSync) {
                summary = '수동 동기화 모드입니다. 지금 동기화 버튼으로 목록을 맞출 수 있습니다.';
            } else {
                summary = '자동 동기화가 켜져 있습니다.';
            }
        }

        elements.Status.textContent = summary;
        const summaryBadge = enabled && status.conflict
            ? '확인 필요'
            : (status && status.state === 'error' ? '동기화 오류' : '');
        setOptionalText(elements.SummaryBadge, summaryBadge);
        setOptionalText(elements.Account, enabled && status.accountEmail ? `연결 계정: ${status.accountEmail}` : '');
        const lastTime = status && formatTime(status.lastSyncedAt);
        const lastTimeText = lastTime || (status ? '기록 없음' : '확인 중');
        setOptionalText(elements.LastTime, `이 기기 최근 동기화 완료: ${lastTimeText}`);
        setOptionalText(elements.Error, requestError || (status && status.error) || '');
        elements.ConnectBtn.hidden = !!status && (!available || (enabled && status.state !== 'error'));
        elements.ConnectBtn.textContent = enabled ? 'Google 계정 다시 연결' : 'Google 계정 연결';
        elements.ConnectBtn.disabled = !available || busy;
        elements.NowBtn.hidden = !available || !enabled;
        elements.NowBtn.disabled = busy || !!conflict;
        elements.DisconnectBtn.hidden = !enabled;
        elements.DisconnectBtn.disabled = busy;
        elements.UseLocalBtn.disabled = busy || !conflict;
        elements.UseRemoteBtn.hidden = !!conflict && conflict.reason === 'remote-missing';
        elements.UseRemoteBtn.disabled = busy || !conflict || conflict.reason === 'remote-missing';
        elements.Conflict.hidden = !conflict;
        panel.setAttribute('aria-busy', String(busy));

        elements.AutoSync.checked = preferences.autoSync;
        elements.IntervalMinutes.value = String(preferences.intervalMinutes);
        elements.SyncOnStartup.checked = preferences.syncOnStartup;
        elements.SyncOnChange.checked = preferences.syncOnChange;
        elements.AutoSync.disabled = !status || busy;
        for (const name of ['IntervalMinutes', 'SyncOnStartup', 'SyncOnChange']) {
            elements[name].disabled = !status || busy || !preferences.autoSync;
        }
        const schedule = ['Google 계정을 연결할 때 한 번 동기화를 확인합니다.'];
        if (preferences.autoSync) {
            const triggers = [];
            if (preferences.syncOnStartup) triggers.push('Chrome 시작 시');
            if (preferences.syncOnChange) triggers.push('도서 목록이나 누락 권수 변경 후 약 30초 뒤');
            triggers.push(`약 ${preferences.intervalMinutes}분 간격`);
            schedule.push(`연결 중에는 ${triggers.join(', ')}으로 자동 확인합니다.`);
        } else {
            schedule.push('자동 동기화는 꺼져 있으며, 지금 동기화 버튼으로 직접 확인할 수 있습니다.');
        }
        schedule.push('Chrome 실행 중 인터넷 연결과 Google 인증이 유지되어야 하며, 브라우저 상태에 따라 늦어질 수 있습니다.');
        elements.Schedule.textContent = schedule.join(' ');

        if (conflict) {
            const localCount = Number(conflict.localCount) || 0;
            const remoteCount = Number(conflict.remoteCount) || 0;
            const remoteTime = formatTime(conflict.remoteUpdatedAt);
            const remoteDetails = conflict.reason === 'remote-missing'
                ? 'Google 파일 없음'
                : `Google ${remoteCount.toLocaleString('ko-KR')}권${remoteTime ? ` (저장: ${remoteTime})` : ''}`;
            elements.ConflictReason.textContent = conflictReason(conflict);
            elements.ConflictDetails.textContent = `이 기기 ${localCount.toLocaleString('ko-KR')}권 · ${remoteDetails}`;
            elements.LocalChanges.textContent = conflictImpact(conflict, 'local');
            setOptionalText(elements.RemoteChanges, conflict.reason === 'remote-missing' ? '' : conflictImpact(conflict, 'remote'));
        }
    }

    async function refreshStatus() {
        if (requestInFlight || refreshInFlight) return;
        refreshInFlight = true;
        const epoch = requestEpoch;
        try {
            const response = await chrome.runtime.sendMessage({ action: 'GOOGLE_SYNC_STATUS' });
            if (epoch !== requestEpoch) return;
            if (response && response.status) currentStatus = response.status;
            if (!response || !response.ok) {
                throw new Error(response && response.error ? response.error : '동기화 상태를 불러오지 못했습니다.');
            }
            requestError = '';
        } catch (error) {
            if (epoch === requestEpoch) requestError = error.message || '동기화 상태를 불러오지 못했습니다.';
        } finally {
            refreshInFlight = false;
            renderStatus();
        }
    }

    async function runAction(action, extra = {}) {
        if (requestInFlight) return;
        requestEpoch++;
        requestInFlight = true;
        requestError = '';
        pendingPreferences = action === 'GOOGLE_SYNC_UPDATE_PREFERENCES' ? extra.preferences : null;
        renderStatus();
        try {
            const response = await chrome.runtime.sendMessage({ action, ...extra });
            if (response && response.status) currentStatus = response.status;
            if (!response || !response.ok) {
                throw new Error(response && response.error ? response.error : '동기화 요청을 처리하지 못했습니다.');
            }
        } catch (error) {
            requestError = error.message || '동기화 요청을 처리하지 못했습니다.';
        } finally {
            requestInFlight = false;
            pendingPreferences = null;
            renderStatus();
        }
    }

    function resolveConflict(resolution) {
        const conflict = currentStatus && currentStatus.conflict;
        if (!conflict || requestInFlight || currentStatus.busy) return;
        if (resolution === 'remote' && conflict.reason === 'remote-missing') return;
        const actionDescription = resolution === 'local'
            ? (conflict.reason === 'remote-missing'
                ? `이 기기의 도서 목록 ${conflict.localCount}권을 Google에 다시 저장합니다. 다른 기기에도 이 목록이 반영됩니다.`
                : `이 기기의 도서 목록 ${conflict.localCount}권으로 Google 목록 ${conflict.remoteCount}권을 전체 교체합니다. 교체 전 Google 목록을 이 기기의 로컬 복원 지점에 먼저 저장합니다. 다른 기기에도 이 목록이 반영됩니다.`)
            : `Google 도서 목록 ${conflict.remoteCount}권으로 이 기기 목록 ${conflict.localCount}권을 전체 교체합니다. 현재 목록은 로컬 복원 지점에 먼저 저장합니다.`;
        const prompt = `${conflictReason(conflict)}\n\n${conflictImpact(conflict, resolution)}\n\n${actionDescription}\n적용 전 두 목록을 다시 확인하며, 내용이 바뀌었으면 다시 선택해야 합니다. 계속하시겠습니까?`;
        if (!window.confirm(prompt)) return;
        void runAction('GOOGLE_SYNC_RESOLVE', { resolution, conflictToken: conflict.token });
    }

    elements.ConnectBtn.addEventListener('click', () => void runAction('GOOGLE_SYNC_CONNECT'));
    elements.NowBtn.addEventListener('click', () => void runAction('GOOGLE_SYNC_NOW'));
    elements.DisconnectBtn.addEventListener('click', () => {
        if (!window.confirm('이 기기의 Google 동기화를 중지하시겠습니까? 이 기기와 Google에 저장된 도서 목록은 유지됩니다.')) return;
        void runAction('GOOGLE_SYNC_DISCONNECT');
    });
    elements.UseLocalBtn.addEventListener('click', () => resolveConflict('local'));
    elements.UseRemoteBtn.addEventListener('click', () => resolveConflict('remote'));
    for (const name of ['AutoSync', 'IntervalMinutes', 'SyncOnStartup', 'SyncOnChange']) {
        elements[name].addEventListener('change', () => {
            const preferences = {
                autoSync: elements.AutoSync.checked,
                intervalMinutes: Number(elements.IntervalMinutes.value),
                syncOnStartup: elements.SyncOnStartup.checked,
                syncOnChange: elements.SyncOnChange.checked
            };
            void runAction('GOOGLE_SYNC_UPDATE_PREFERENCES', { preferences });
        });
    }
    document.querySelector('[data-target="tab-backup"]')?.addEventListener('click', () => void refreshStatus());
    window.addEventListener('focus', () => void refreshStatus());
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void refreshStatus();
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && Object.keys(changes).some(key => key.startsWith('googleSync'))) {
            void refreshStatus();
        }
    });
    void refreshStatus();
})();
