const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'file-backup.js'), 'utf8');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const MINUTE = 60 * 1000;
const BACKUP_DELAY = 30 * 1000;
const ALARM = 'book-manager-file-backup';

function event() {
    const listeners = [];
    return { addListener: listener => listeners.push(listener), emit: (...args) => listeners.forEach(listener => listener(...args)), listeners };
}

function harness(options = {}) {
    const state = {
        now: options.now || 1794100000000,
        storage: clone(options.storage || {}),
        books: clone(options.books || [{ id: 1, title: '도서', type: 'incomplete', lastVol: '1' }]),
        revision: options.revision || 1,
        alarms: new Map(),
        downloads: new Map(options.downloads || []),
        requests: [], blobs: [],
        offscreen: false,
        completeImmediately: options.completeImmediately !== false,
        downloadError: null,
        captureHook: null,
        reads: 0
    };
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [state.now])); }
        static now() { return state.now; }
    }
    const chrome = {
        runtime: {
            id: 'test-extension',
            getURL: file => `chrome-extension://test-extension/${file}`,
            onMessage: event(), onStartup: event(), onInstalled: event(),
            getContexts: async () => state.offscreen ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : [],
            sendMessage: async message => {
                assert.equal(message.target, 'file-backup-offscreen');
                const url = `blob:chrome-extension://test-extension/${message.requestId}`;
                state.blobs.push({ url, data: JSON.parse(message.text) });
                return { ok: true, url };
            }
        },
        storage: {
            onChanged: event(),
            local: {
                get: async defaults => ({ ...clone(defaults), ...clone(Object.fromEntries(
                    Object.keys(defaults).filter(key => key in state.storage).map(key => [key, state.storage[key]])
                )) }),
                set: async values => {
                    const changes = {};
                    for (const [key, value] of Object.entries(values)) {
                        if (JSON.stringify(state.storage[key]) !== JSON.stringify(value)) {
                            changes[key] = { oldValue: clone(state.storage[key]), newValue: clone(value) };
                            state.storage[key] = clone(value);
                        }
                    }
                    if (Object.keys(changes).length) chrome.storage.onChanged.emit(changes, 'local');
                }
            }
        },
        alarms: {
            onAlarm: event(),
            get: async name => state.alarms.get(name),
            create: async (name, values) => state.alarms.set(name, clone(values)),
            clear: async name => state.alarms.delete(name)
        },
        offscreen: {
            createDocument: async values => { assert.deepEqual(Array.from(values.reasons), ['BLOBS']); state.offscreen = true; },
            closeDocument: async () => { state.offscreen = false; }
        },
        downloads: {
            onChanged: event(), onCreated: event(),
            download: async values => {
                if (state.downloadError) throw state.downloadError;
                const id = state.downloads.size + 1;
                const item = {
                    id, url: values.url, byExtensionId: chrome.runtime.id,
                    filename: `/downloads/${values.filename}`,
                    state: state.completeImmediately ? 'complete' : 'in_progress'
                };
                state.requests.push(clone(values));
                state.downloads.set(id, item);
                chrome.downloads.onCreated.emit(item);
                return id;
            },
            search: async query => [...state.downloads.values()].filter(item =>
                (query.id === undefined || query.id === item.id) && (!query.url || query.url === item.url)),
            show: async id => { state.shown = id; },
            showDefaultFolder: async () => { state.shown = 'default'; }
        }
    };
    const context = vm.createContext({
        chrome, Date: Clock, crypto: webcrypto, TextEncoder,
        console: { error() {}, warn() {} },
        getDefaultEditionKeywords: () => ['완전판'],
        bookStoreWithSyncLock: operation => operation(),
        bookStoreGetRevision: async () => { state.reads++; return state.revision; },
        bookStoreGetAllWithRevision: async () => {
            const snapshot = { bookList: clone(state.books), revision: state.revision };
            if (state.captureHook) await state.captureHook();
            return snapshot;
        }
    });
    const api = vm.runInContext(`${source}\nFileBackup;`, context);
    function request(action = 'FILE_BACKUP_STATUS', values = {}, sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('options.html') }) {
        return new Promise(resolve => chrome.runtime.onMessage.listeners[0]({ action, ...values }, sender, resolve));
    }
    async function fire(name = ALARM) {
        state.alarms.delete(name);
        chrome.alarms.onAlarm.emit({ name });
        await request();
    }
    async function change(title = `도서 ${state.revision + 1}`) {
        state.revision++;
        state.books[0].title = title;
        await chrome.storage.local.set({ bookStoreChange: { token: `change-${state.revision}` } });
        await request();
    }
    async function finish(id = 1, result = 'complete') {
        state.downloads.get(id).state = result;
        chrome.downloads.onChanged.emit({ id, state: { current: result } });
        await request();
    }
    return { state, chrome, api, request, fire, change, finish };
}

test('기본값은 꺼짐이며 백업을 켜면 현재 목록을 30초 뒤 예약한다', async () => {
    const h = harness();
    await h.api.initialize();
    assert.equal(h.state.alarms.size, 0);
    assert.equal(h.state.reads, 0);
    const response = await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    assert.equal(response.ok, true);
    assert.equal(h.state.alarms.get(ALARM).when, h.state.now + BACKUP_DELAY);
    assert.equal(h.state.requests.length, 0);
});

test('마지막 변경 30초 뒤 새 JSON 파일을 저장하고 완료된 파일만 성공 처리한다', async () => {
    const h = harness({ completeImmediately: false });
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.now += BACKUP_DELAY - 1000;
    await h.change('최신 도서');
    assert.equal(h.state.alarms.get(ALARM).when, h.state.now + BACKUP_DELAY);
    h.state.now += BACKUP_DELAY;
    await h.fire();
    assert.equal(h.state.requests.length, 1);
    assert.equal(h.state.storage.fileBackupState.lastCompletedAt, undefined);
    assert.equal(h.state.offscreen, true);
    const download = h.state.requests[0];
    assert.equal(download.saveAs, false);
    assert.equal(download.conflictAction, 'uniquify');
    assert.match(download.filename, /^LibraryMatchingManagerBackups\/book_manager_backup_.*\.json$/);
    assert.equal(h.state.blobs[0].data.bookList[0].title, '최신 도서');
    assert.deepEqual(h.state.blobs[0].data.editionKeywords, ['완전판']);
    await h.finish();
    assert.equal(h.state.storage.fileBackupState.lastCompletedAt, h.state.now);
    assert.equal(h.state.storage.fileBackupState.lastBookCount, 1);
    assert.equal(h.state.offscreen, false);
});

test('변경이 계속되어도 첫 변경부터 30분에 백업한다', async () => {
    const h = harness();
    const start = h.state.now;
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    for (let elapsed = 20 * 1000; elapsed < 30 * MINUTE; elapsed += 20 * 1000) {
        h.state.now = start + elapsed;
        await h.change();
    }
    assert.equal(h.state.requests.length, 0);
    assert.equal(h.state.alarms.get(ALARM).when, start + 30 * MINUTE);
    h.state.now = start + 30 * MINUTE;
    await h.fire();
    assert.equal(h.state.requests.length, 1);
});

test('같은 내용은 자동 저장을 생략하고 수동 즉시 백업은 새 파일을 만든다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.now += BACKUP_DELAY;
    await h.fire();
    await h.change('도서');
    h.state.now += BACKUP_DELAY;
    await h.fire();
    assert.equal(h.state.requests.length, 1);
    await h.request('FILE_BACKUP_NOW');
    assert.equal(h.state.requests.length, 2);
    assert.notEqual(h.state.requests[0].filename, h.state.requests[1].filename);
});

test('서비스 워커가 재시작되어 예약이 없어져도 원래 기한을 복원한다', async () => {
    const first = harness();
    await first.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    const deadline = first.state.alarms.get(ALARM).when;
    const restarted = harness({ storage: first.state.storage, now: first.state.now + BACKUP_DELAY - 1000 });
    await restarted.api.initialize();
    assert.equal(restarted.state.alarms.get(ALARM).when, deadline);
    restarted.state.now = deadline;
    await restarted.fire();
    assert.equal(restarted.state.requests.length, 1);
});

test('파일 저장 시작 실패는 성공 기록을 남기지 않고 30초 뒤 재시도한다', async () => {
    const h = harness();
    h.state.downloadError = new Error('디스크 오류');
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.now += BACKUP_DELAY;
    await h.fire();
    assert.match(h.state.storage.fileBackupState.error, /디스크 오류/);
    assert.equal(h.state.storage.fileBackupState.lastCompletedAt, undefined);
    assert.equal(h.state.alarms.get(ALARM).when, h.state.now + BACKUP_DELAY);
    h.state.downloadError = null;
    h.state.now += BACKUP_DELAY;
    await h.fire();
    assert.equal(h.state.requests.length, 1);
    assert.equal(h.state.storage.fileBackupState.error, '');
});

test('다운로드 도중 중단되면 이전 성공 상태를 보존하고 다시 예약한다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    await h.request('FILE_BACKUP_NOW');
    const completed = h.state.storage.fileBackupState.lastCompletedAt;
    h.state.completeImmediately = false;
    await h.change();
    h.state.now += BACKUP_DELAY;
    await h.fire();
    await h.finish(2, 'interrupted');
    assert.equal(h.state.storage.fileBackupState.lastCompletedAt, completed);
    assert.match(h.state.storage.fileBackupState.error, /중단/);
    assert.equal(h.state.alarms.get(ALARM).when, h.state.now + BACKUP_DELAY);
});

test('백업 다운로드 중 발생한 변경도 다음 파일에 보관한다', async () => {
    const h = harness({ completeImmediately: false });
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.now += BACKUP_DELAY;
    await h.fire();
    await h.change('다운로드 도중 수정');
    await h.finish();
    assert.ok(h.state.storage.fileBackupState.firstChangeAt);
    h.state.now += BACKUP_DELAY;
    await h.fire();
    assert.equal(h.state.requests.length, 2);
    assert.equal(h.state.blobs[1].data.bookList[0].title, '다운로드 도중 수정');
});

test('캡처 직후 발생한 변경을 백업 완료가 지우지 않는다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.captureHook = async () => {
        h.state.captureHook = null;
        h.state.revision++;
        h.state.books[0].title = '캡처 뒤 변경';
        await h.chrome.storage.local.set({ bookStoreChange: { token: 'after-capture' } });
    };
    h.state.now += BACKUP_DELAY;
    await h.fire();
    await h.request();
    assert.equal(h.state.blobs[0].data.bookList[0].title, '도서');
    assert.ok(h.state.storage.fileBackupState.firstChangeAt);
    h.state.now += BACKUP_DELAY;
    await h.fire();
    assert.equal(h.state.blobs[1].data.bookList[0].title, '캡처 뒤 변경');
});

test('다운로드 번호를 저장하기 전 재시작해도 URL로 완료를 확인한다', async () => {
    const first = harness({ completeImmediately: false });
    await first.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    await first.request('FILE_BACKUP_NOW');
    first.state.storage.fileBackupState.pending.downloadId = null;
    first.state.downloads.get(1).state = 'complete';
    const h = harness({ storage: first.state.storage, downloads: [...first.state.downloads] });
    await h.api.initialize();
    assert.equal(h.state.requests.length, 0);
    assert.equal(h.state.storage.fileBackupState.lastDownloadId, 1);
    assert.equal(h.state.storage.fileBackupState.pending, null);
});

test('백업을 끄면 자동 예약이 취소되고 즉시 파일 백업은 사용할 수 있다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: false });
    assert.equal(h.state.alarms.size, 0);
    await h.change();
    assert.equal(h.state.requests.length, 0);
    await h.request('FILE_BACKUP_NOW');
    assert.equal(h.state.requests.length, 1);
});

test('누락 권수와 사이트 설정 변경도 백업 내용에 포함한다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    await h.chrome.storage.local.set({ missingVolsMap: { 1: [2, 3] }, allowedSites: ['example.com'] });
    await h.request();
    h.state.now += BACKUP_DELAY;
    await h.fire();
    assert.deepEqual(h.state.blobs[0].data.missingVolsMap, { 1: [2, 3] });
    assert.deepEqual(h.state.blobs[0].data.allowedSites, ['example.com']);
});

test('웹페이지 컨텍스트에서는 백업 생성과 설정 변경을 요청할 수 없다', async () => {
    const h = harness();
    const result = await h.request('FILE_BACKUP_NOW', {}, { id: 'test-extension', url: 'https://example.com' });
    assert.equal(result.ok, false);
    assert.equal(h.state.requests.length, 0);
    const invalid = await h.request('FILE_BACKUP_SET_ENABLED', { enabled: 'yes' });
    assert.equal(invalid.ok, false);
    assert.equal(h.state.storage.fileBackupEnabled, undefined);
});

test('백업 Blob 다운로드만 일반 도서 다운로드 처리에서 구분한다', () => {
    const h = harness();
    assert.equal(h.api.isBackupDownload({ url: 'blob:chrome-extension://test-extension/abc', byExtensionId: 'test-extension' }), true);
    assert.equal(h.api.isBackupDownload({ url: 'blob:https://example.com/abc' }), false);
    assert.equal(h.api.isBackupDownload({ url: 'https://example.com/book.zip' }), false);
});

test('기존 사용자 폴더는 업데이트 뒤 다운로드 백업으로 전환하고 같은 내용도 새 위치에 보관한다', async () => {
    const first = harness();
    await first.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    await first.request('FILE_BACKUP_NOW');
    const stored = clone(first.state.storage);
    stored.fileBackupDestination = { id: 'old-folder', label: '이전 백업', absolutePath: 'D:\\백업\\LibraryMatchingManagerBackups' };
    stored.fileBackupState.lastDestinationId = 'old-folder';
    stored.fileBackupState.lastFilename = '이전 백업 → book_manager_backup_old.json';
    stored.fileBackupState.folderAccessIssue = { id: 'old-folder', reason: 'permission' };
    stored.fileBackupState.error = '폴더 접근을 다시 허용해 주세요.';
    const updated = harness({ storage: stored });
    updated.chrome.runtime.onInstalled.emit({ reason: 'update' });
    const before = (await updated.request()).status;
    assert.equal(updated.state.storage.fileBackupDestination, null);
    assert.equal(updated.state.storage.fileBackupState.folderAccessIssue, undefined);
    assert.equal(before.error, '');
    assert.equal(before.lastCompletedAt, stored.fileBackupState.lastCompletedAt);
    assert.equal(before.lastBackupMatchesDestination, false);
    assert.equal(updated.state.alarms.get(ALARM).when, updated.state.now + BACKUP_DELAY);
    updated.state.now += BACKUP_DELAY;
    await updated.fire();
    assert.equal(updated.state.requests.length, 1);
    assert.match(updated.state.requests[0].filename, /^LibraryMatchingManagerBackups\//);
    assert.equal(updated.state.requests[0].saveAs, false);
    assert.equal(updated.state.blobs[0].data.bookList[0].title, '도서');
    assert.equal((await updated.request()).status.lastBackupMatchesDestination, true);
    await updated.fire('book-manager-file-backup-check');
    assert.equal(updated.state.requests.length, 1);
});

test('중단된 사용자 폴더 저장은 완료로 간주하지 않고 현재 목록을 다운로드로 다시 백업한다', async () => {
    const h = harness({ storage: {
        fileBackupEnabled: true,
        fileBackupState: {
            lastCompletedAt: 100,
            lastBookCount: 2,
            lastDestinationId: 'old-folder',
            pending: { destination: { id: 'old-folder' }, filename: 'book_manager_backup_old.json', hash: 'unfinished', startedAt: 200 }
        }
    } });
    h.chrome.runtime.onStartup.emit();
    const response = await h.request();
    assert.equal(response.status.lastCompletedAt, 100);
    assert.equal(response.status.busy, false);
    h.state.now += BACKUP_DELAY;
    await h.fire();
    assert.equal(h.state.requests.length, 1);
    assert.equal(h.state.storage.fileBackupState.lastDestinationId, 'downloads');
    assert.equal(h.state.storage.fileBackupState.lastBookCount, 1);
});

test('자동 백업이 꺼져 있으면 이전 폴더 설정을 정리해도 파일을 만들지 않는다', async () => {
    const h = harness({ storage: {
        fileBackupEnabled: false,
        fileBackupDestination: { id: 'old-folder' },
        fileBackupState: { pending: { destination: { id: 'old-folder' } }, error: '권한 오류' }
    } });
    h.chrome.runtime.onInstalled.emit({ reason: 'update' });
    const response = await h.request();
    assert.equal(response.status.enabled, false);
    assert.equal(response.status.error, '');
    assert.equal(h.state.requests.length, 0);
    assert.equal(h.state.alarms.size, 0);
});

test('사용자 폴더 설정이 남아 있어도 진행 중인 다운로드는 이어서 완료한다', async () => {
    const first = harness({ completeImmediately: false });
    await first.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    await first.request('FILE_BACKUP_NOW');
    const stored = clone(first.state.storage);
    stored.fileBackupDestination = { id: 'old-folder' };
    const restarted = harness({ storage: stored, downloads: [...first.state.downloads] });
    await restarted.api.initialize();
    assert.equal(restarted.state.storage.fileBackupState.pending.downloadId, 1);
    await restarted.finish();
    assert.equal(restarted.state.storage.fileBackupState.lastDownloadId, 1);
    assert.equal(restarted.state.storage.fileBackupState.pending, null);
    assert.equal(restarted.state.requests.length, 0);
});

test('제거된 폴더 선택·권한·경로 등록 명령은 처리하지 않는다', () => {
    const h = harness();
    for (const action of ['FILE_BACKUP_USE_FOLDER', 'FILE_BACKUP_DEFAULT_FOLDER', 'FILE_BACKUP_FOLDER_ACCESS', 'FILE_BACKUP_SET_PATH']) {
        let replied = false;
        const result = h.chrome.runtime.onMessage.listeners[0]({ action }, { id: h.chrome.runtime.id, url: h.chrome.runtime.getURL('options.html') }, () => { replied = true; });
        assert.equal(result, undefined);
        assert.equal(replied, false);
    }
    assert.equal(h.state.requests.length, 0);
});
