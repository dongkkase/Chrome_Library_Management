const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const resolverSource = fs.readFileSync(path.join(root, 'buzzheavier-download.js'), 'utf8');
const start = background.indexOf('function waitForBuzzheavierTabReady(');
const end = background.indexOf('async function performRidiSearch(', start);
assert.ok(start >= 0 && end > start);
const handlerSource = background.slice(start, end);
const pageUrl = 'https://buzzheavier.com/abcdefghijkl';
const directUrl = 'https://ts.buzzheavier.com/d/abcdefghijkl?v=signed-token';
const settle = () => new Promise(resolve => setImmediate(resolve));

function createEvent() {
    const listeners = new Set();
    return {
        listeners,
        addListener: callback => listeners.add(callback),
        removeListener: callback => listeners.delete(callback),
        emit: (...args) => [...listeners].forEach(callback => callback(...args))
    };
}

function createHarness(overrides = {}) {
    const state = {
        tabStatus: 'complete',
        currentUrl: pageUrl,
        documentId: 'owned-document',
        resolveResult: { ok: true, url: directUrl },
        downloadId: 501,
        ...overrides
    };
    const calls = { create: [], update: [], remove: [], scripts: [], downloads: [], toasts: [] };
    const updated = createEvent();
    const removed = createEvent();
    const timers = new Map();
    const folders = {};
    let listener;
    let nextTimer = 0;
    const module = vm.runInNewContext(`${resolverSource}\nBuzzheavierDownload;`, { URL });
    const chrome = {
        runtime: {
            lastError: undefined,
            onMessage: { addListener: callback => { listener = callback; } }
        },
        tabs: {
            onUpdated: updated,
            onRemoved: removed,
            async create(options) {
                calls.create.push({ ...options });
                return { id: 90, status: state.tabStatus };
            },
            async get(tabId) {
                assert.equal(tabId, 90);
                if (state.getError) throw new Error(state.getError);
                return { id: 90, status: state.tabStatus };
            },
            async update(tabId, options) {
                calls.update.push({ tabId, ...options });
                if (state.updateError) throw new Error(state.updateError);
                return { id: tabId };
            },
            async remove(tabId) {
                calls.remove.push(tabId);
                removed.emit(tabId);
            }
        },
        scripting: {
            async executeScript(options) {
                calls.scripts.push(options);
                if (calls.scripts.length === state.scriptErrorAt) throw new Error('script execution failed');
                if (options.func === module.resolveInPage) {
                    return [{ frameId: 0, documentId: state.documentId, result: state.resolveResult }];
                }
                return [{ frameId: 0, documentId: state.documentId, result: state.currentUrl }];
            }
        },
        downloads: {
            download(options, callback) {
                calls.downloads.push({ ...options });
                if (state.downloadThrow) throw new Error(state.downloadThrow);
                chrome.runtime.lastError = state.downloadError ? { message: state.downloadError } : undefined;
                callback(state.downloadId);
                chrome.runtime.lastError = undefined;
            }
        }
    };
    vm.runInNewContext(handlerSource, {
        chrome,
        BuzzheavierDownload: module,
        downloadTitlesMap: folders,
        getBookStoreErrorMessage: error => error?.message || String(error),
        sendTabMessage: (tabId, message) => calls.toasts.push({ tabId, ...message }),
        setTimeout(callback, duration) {
            const id = ++nextTimer;
            timers.set(id, { callback, duration });
            return id;
        },
        clearTimeout: id => timers.delete(id)
    });
    return {
        state, calls, folders, timers, updated, removed,
        dispatch(extra = {}) {
            let resolve;
            const request = { responseCount: 0 };
            request.response = new Promise(done => { resolve = done; });
            request.keepAlive = listener({
                action: 'DOWNLOAD_BUZZHEAVIER', url: pageUrl, title: '예시 도서',
                downloadFolder: '만화/예시 도서', ...extra
            }, { tab: { id: 42 } }, response => {
                request.responseCount++;
                resolve(JSON.parse(JSON.stringify(response)));
            });
            return request;
        }
    };
}

function assertLifecycleCleared(fixture) {
    assert.equal(fixture.updated.listeners.size, 0);
    assert.equal(fixture.removed.listeners.size, 0);
    assert.equal(fixture.timers.size, 0);
}

test('비활성 전용 탭에서 문서를 확인하고 해당 documentId로 해석한 뒤 폴더와 다운로드를 연결한다', async () => {
    const fixture = createHarness();
    const request = fixture.dispatch();
    assert.equal(request.keepAlive, true);
    assert.deepEqual(await request.response, { ok: true, downloadId: 501 });
    assert.equal(request.responseCount, 1);
    assert.deepEqual(fixture.calls.create, [{ url: pageUrl, active: false }]);
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls.scripts[0].target)), { tabId: 90, frameIds: [0] });
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls.scripts[1].target)), { tabId: 90, documentIds: ['owned-document'] });
    assert.deepEqual(Array.from(fixture.calls.scripts[1].args), [pageUrl]);
    assert.ok(fixture.calls.scripts.every(call => !call.world || call.world === 'ISOLATED'));
    assert.deepEqual(fixture.calls.downloads, [{ url: directUrl, conflictAction: 'uniquify' }]);
    assert.deepEqual(fixture.folders, { 501: '만화/예시 도서' });
    assert.deepEqual(fixture.calls.remove, [90]);
    assert.equal(fixture.calls.update.length, 0);
    assert.equal(fixture.calls.toasts[0].tabId, 42);
    assert.match(fixture.calls.toasts[0].msg, /시작/);
    assertLifecycleCleared(fixture);
});

test('전용 탭의 로드 완료를 기다리고 documentId가 없으면 해당 탭 최상위 frame만 실행한다', async () => {
    const fixture = createHarness({ tabStatus: 'loading', documentId: undefined });
    const request = fixture.dispatch({ downloadFolder: '' });
    await settle();
    assert.equal(fixture.calls.scripts.length, 0);
    fixture.updated.emit(91, { status: 'complete' });
    assert.equal(fixture.calls.scripts.length, 0);
    fixture.updated.emit(90, { status: 'complete' });
    assert.equal((await request.response).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls.scripts[1].target)), { tabId: 90, frameIds: [0] });
    assert.equal(fixture.folders[501], '예시 도서');
    assertLifecycleCleared(fixture);
});

test('준비 탭 종료나 20초 로드 제한은 요청을 실패시키고 리스너와 타이머를 모두 정리한다', async () => {
    for (const closedByUser of [true, false]) {
        const fixture = createHarness({ tabStatus: 'loading' });
        const request = fixture.dispatch();
        await settle();
        assert.equal(fixture.updated.listeners.size, 1);
        assert.equal(fixture.removed.listeners.size, 1);
        const timer = [...fixture.timers.values()][0];
        assert.equal(timer.duration, 20000);
        if (closedByUser) fixture.removed.emit(90);
        else timer.callback();
        const response = await request.response;
        assert.equal(response.ok, false);
        assert.match(response.error, closedByUser ? /닫혔/ : /초과/);
        assert.equal(fixture.calls.downloads.length, 0);
        assert.deepEqual(fixture.calls.remove, [90]);
        assertLifecycleCleared(fixture);
    }
});

test('탭 조회·스크립트·주소 해석 실패 또는 페이지 이동 시 본인이 만든 탭만 닫는다', async () => {
    for (const settings of [
        { getError: 'tab unavailable' },
        { scriptErrorAt: 1 },
        { scriptErrorAt: 2 },
        { currentUrl: 'https://example.com/abcdefghijkl' },
        { currentUrl: 'https://buzzheavier.com/anotherfile1' },
        { resolveResult: { ok: false, error: '파일이 없습니다.' } },
        { resolveResult: { ok: true, url: 'https://example.com/file.zip' } }
    ]) {
        const fixture = createHarness(settings);
        const response = await fixture.dispatch().response;
        assert.equal(response.ok, false);
        assert.equal(fixture.calls.downloads.length, 0);
        assert.deepEqual(fixture.calls.remove, [90]);
        assert.equal(fixture.calls.update.length, 0);
        assert.equal(fixture.calls.toasts[0].isError, true);
        assertLifecycleCleared(fixture);
    }
});

test('보안 확인이 필요하면 전용 탭을 활성화해 유지하고 다운로드나 반복 시도를 하지 않는다', async () => {
    const fixture = createHarness({ resolveResult: { ok: false, code: 'verification-required', error: '브라우저 확인 필요' } });
    const response = await fixture.dispatch().response;
    assert.equal(response.ok, false);
    assert.equal(response.code, 'verification-required');
    assert.deepEqual(fixture.calls.update, [{ tabId: 90, active: true }]);
    assert.deepEqual(fixture.calls.remove, []);
    assert.equal(fixture.calls.scripts.length, 2);
    assert.equal(fixture.calls.downloads.length, 0);
    assert.match(fixture.calls.toasts[0].msg, /열린 탭에서 확인/);
    assertLifecycleCleared(fixture);
});

test('Chrome 다운로드 오류와 잘못된 ID는 실패로 응답하고 폴더 맵을 남기지 않는다', async () => {
    for (const settings of [
        { downloadError: 'download blocked' },
        { downloadId: undefined },
        { downloadId: -1 },
        { downloadThrow: 'API unavailable' }
    ]) {
        const fixture = createHarness(settings);
        const request = fixture.dispatch();
        assert.equal((await request.response).ok, false);
        assert.equal(request.responseCount, 1);
        assert.equal(fixture.calls.downloads.length, 1);
        assert.deepEqual(fixture.folders, {});
        assert.deepEqual(fixture.calls.remove, [90]);
        assertLifecycleCleared(fixture);
    }
});

test('입력 URL이 잘못되면 탭과 다운로드를 만들지 않고 오류를 반환한다', async () => {
    const fixture = createHarness();
    const response = await fixture.dispatch({ url: 'https://example.com/abcdefghijkl' }).response;
    assert.equal(response.ok, false);
    assert.equal(fixture.calls.create.length, 0);
    assert.equal(fixture.calls.scripts.length, 0);
    assert.equal(fixture.calls.downloads.length, 0);
    assert.equal(fixture.calls.remove.length, 0);
    assertLifecycleCleared(fixture);
});
