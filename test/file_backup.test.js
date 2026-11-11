const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'file-backup.js'), 'utf8');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const MINUTE = 60 * 1000;
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
        folders: new Map(options.folders || []),
        folderFiles: new Map(options.folderFiles || []),
        folderWrites: [],
        folderWriteError: null,
        folderWriteHook: null,
        windows: new Map(options.windows || []),
        createdWindows: [],
        focusedWindows: [],
        windowError: null,
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
            getContexts: async query => query.contextTypes.includes('TAB')
                ? [...state.windows.values()].filter(window => window.url === query.documentUrls[0])
                    .map(window => ({ contextType: 'TAB', documentUrl: window.url, windowId: window.id }))
                : state.offscreen ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : [],
            sendMessage: async message => {
                assert.equal(message.target, 'file-backup-offscreen');
                const url = `blob:chrome-extension://test-extension/${message.requestId}`;
                state.blobs.push({ url, data: JSON.parse(message.text) });
                return { ok: true, url };
            }
        },
        windows: {
            get: async id => {
                if (!state.windows.has(id)) throw new Error('닫힌 창');
                return state.windows.get(id);
            },
            update: async (id, values) => {
                assert.equal(values.focused, true);
                state.focusedWindows.push(id);
            },
            create: async values => {
                if (state.windowError) throw new Error(state.windowError);
                const window = { ...clone(values), id: 100 + state.createdWindows.length };
                state.windows.set(window.id, window);
                state.createdWindows.push(window);
                return window;
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
        FileBackupFolder: {
            NAME: 'LibraryMatchingManagerBackups',
            describe: async id => {
                const folder = state.folders.get(id);
                if (!folder) throw new Error('폴더를 다시 선택해 주세요.');
                return { id, label: folder.label, permission: folder.permission };
            },
            readFile: async (id, name) => {
                if (state.folders.get(id)?.permission !== 'granted') throw new Error('폴더 접근 권한이 필요합니다.');
                const content = state.folderFiles.get(`${id}/${name}`);
                return content === undefined ? null : { text: async () => content };
            },
            writeFile: async (id, name, text) => {
                if (state.folders.get(id)?.permission !== 'granted') throw new Error('폴더 접근 권한이 필요합니다.');
                if (state.folderWriteHook) await state.folderWriteHook();
                if (state.folderWriteError) throw state.folderWriteError;
                const key = `${id}/${name}`;
                assert.equal(state.folderFiles.has(key), false, '기존 파일은 덮어쓰지 않는다.');
                state.folderFiles.set(key, text);
                state.folderWrites.push({ id, name, data: JSON.parse(text) });
            }
        },
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

test('기본값은 꺼짐이며 백업을 켜면 현재 목록을 5분 뒤 예약한다', async () => {
    const h = harness();
    await h.api.initialize();
    assert.equal(h.state.alarms.size, 0);
    assert.equal(h.state.reads, 0);
    const response = await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    assert.equal(response.ok, true);
    assert.equal(h.state.alarms.get(ALARM).when, h.state.now + 5 * MINUTE);
    assert.equal(h.state.requests.length, 0);
});

test('마지막 변경 5분 뒤 새 JSON 파일을 저장하고 완료된 파일만 성공 처리한다', async () => {
    const h = harness({ completeImmediately: false });
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.now += 4 * MINUTE;
    await h.change('최신 도서');
    assert.equal(h.state.alarms.get(ALARM).when, h.state.now + 5 * MINUTE);
    h.state.now += 5 * MINUTE;
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
    for (let index = 1; index <= 7; index++) {
        h.state.now = start + index * 4 * MINUTE;
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
    h.state.now += 5 * MINUTE;
    await h.fire();
    await h.change('도서');
    h.state.now += 5 * MINUTE;
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
    const restarted = harness({ storage: first.state.storage, now: first.state.now + 4 * MINUTE });
    await restarted.api.initialize();
    assert.equal(restarted.state.alarms.get(ALARM).when, deadline);
    restarted.state.now = deadline;
    await restarted.fire();
    assert.equal(restarted.state.requests.length, 1);
});

test('파일 저장 시작 실패는 성공 기록을 남기지 않고 5분 뒤 재시도한다', async () => {
    const h = harness();
    h.state.downloadError = new Error('디스크 오류');
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.now += 5 * MINUTE;
    await h.fire();
    assert.match(h.state.storage.fileBackupState.error, /디스크 오류/);
    assert.equal(h.state.storage.fileBackupState.lastCompletedAt, undefined);
    assert.equal(h.state.alarms.get(ALARM).when, h.state.now + 5 * MINUTE);
    h.state.downloadError = null;
    h.state.now += 5 * MINUTE;
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
    h.state.now += 5 * MINUTE;
    await h.fire();
    await h.finish(2, 'interrupted');
    assert.equal(h.state.storage.fileBackupState.lastCompletedAt, completed);
    assert.match(h.state.storage.fileBackupState.error, /중단/);
    assert.equal(h.state.alarms.get(ALARM).when, h.state.now + 5 * MINUTE);
});

test('백업 다운로드 중 발생한 변경도 다음 파일에 보관한다', async () => {
    const h = harness({ completeImmediately: false });
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.now += 5 * MINUTE;
    await h.fire();
    await h.change('다운로드 도중 수정');
    await h.finish();
    assert.ok(h.state.storage.fileBackupState.firstChangeAt);
    h.state.now += 5 * MINUTE;
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
    h.state.now += 5 * MINUTE;
    await h.fire();
    await h.request();
    assert.equal(h.state.blobs[0].data.bookList[0].title, '도서');
    assert.ok(h.state.storage.fileBackupState.firstChangeAt);
    h.state.now += 5 * MINUTE;
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
    h.state.now += 5 * MINUTE;
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

function addFolder(h, id = 'folder-a', permission = 'granted') {
    h.state.folders.set(id, { label: `${id} → LibraryMatchingManagerBackups`, permission });
    return id;
}

test('선택한 폴더에 직접 JSON을 저장하고 완료 후에만 성공을 기록한다', async () => {
    const h = harness();
    const id = addFolder(h);
    assert.equal((await h.request('FILE_BACKUP_USE_FOLDER', { id })).ok, true);
    h.state.folderWriteHook = async () => {
        assert.ok(h.state.storage.fileBackupState.pending.destination);
        assert.equal(h.state.storage.fileBackupState.lastCompletedAt, undefined);
    };
    await h.request('FILE_BACKUP_NOW');
    assert.equal(h.state.folderWrites.length, 1);
    assert.equal(h.state.folderWrites[0].data.bookList[0].title, '도서');
    assert.match(h.state.folderWrites[0].name, /^book_manager_backup_.*\.json$/);
    assert.equal(h.state.requests.length, 0);
    assert.equal(h.state.offscreen, false);
    assert.equal(h.state.storage.fileBackupState.lastDestinationId, id);
    assert.equal(h.state.storage.fileBackupState.lastDownloadId, null);
    assert.equal((await h.request('FILE_BACKUP_SHOW')).ok, false);
});

test('저장 위치가 달라지면 내용이 같아도 새 위치에 자동 백업한다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    await h.request('FILE_BACKUP_NOW');
    for (const id of ['folder-a', 'folder-b']) {
        addFolder(h, id);
        await h.request('FILE_BACKUP_USE_FOLDER', { id });
        assert.equal((await h.request()).status.lastBackupMatchesDestination, false);
        h.state.now += 5 * MINUTE;
        await h.fire();
        assert.equal(h.state.storage.fileBackupState.lastDestinationId, id);
        assert.equal((await h.request()).status.lastBackupMatchesDestination, true);
    }
    assert.equal(h.state.folderWrites.length, 2);
    await h.request('FILE_BACKUP_DEFAULT_FOLDER');
    h.state.now += 5 * MINUTE;
    await h.fire();
    assert.equal(h.state.requests.length, 2);
    assert.equal(h.state.storage.fileBackupState.lastDestinationId, 'downloads');
});

test('폴더 권한을 잃으면 오류를 표시하고 다운로드 폴더로 우회하지 않는다', async () => {
    const h = harness();
    const id = addFolder(h);
    await h.request('FILE_BACKUP_USE_FOLDER', { id });
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.folders.get(id).permission = 'prompt';
    await h.request('FILE_BACKUP_NOW');
    assert.equal(h.state.folderWrites.length, 0);
    assert.equal(h.state.requests.length, 0);
    assert.equal(h.state.storage.fileBackupState.lastCompletedAt, undefined);
    assert.match(h.state.storage.fileBackupState.error, /권한/);
    assert.equal((await h.request()).status.destination.permission, 'prompt');
    assert.equal((await h.request('FILE_BACKUP_FOLDER_ACCESS')).ok, false);
    h.state.folders.get(id).permission = 'granted';
    assert.equal((await h.request('FILE_BACKUP_FOLDER_ACCESS')).ok, true);
    assert.equal(h.state.folderWrites.length, 1);
    assert.equal(h.state.storage.fileBackupState.error, '');
});

test('자동 백업이 꺼져 있을 때 폴더 접근 허용만으로 파일을 만들지 않는다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_USE_FOLDER', { id: addFolder(h) });
    const response = await h.request('FILE_BACKUP_FOLDER_ACCESS');
    assert.equal(response.ok, true);
    assert.equal(response.status.destination.permission, 'granted');
    assert.equal(h.state.folderWrites.length, 0);
    await h.request('FILE_BACKUP_NOW');
    assert.equal(h.state.folderWrites.length, 1);
});

test('접근 허용 직후 저장이 실패하면 완료로 표시하지 않고 오류와 재시도를 유지한다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_USE_FOLDER', { id: addFolder(h) });
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.folderWriteError = new Error('디스크 공간 부족');
    const response = await h.request('FILE_BACKUP_FOLDER_ACCESS');
    assert.equal(response.status.lastCompletedAt, 0);
    assert.match(response.status.error, /디스크 공간 부족/);
    assert.equal(h.state.alarms.get(ALARM).when, h.state.now + 5 * MINUTE);
    assert.equal(h.state.requests.length, 0);
});

test('폴더의 파일 닫기 실패는 성공으로 처리하지 않고 재시도한다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_USE_FOLDER', { id: addFolder(h) });
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.folderWriteError = new Error('파일 닫기 실패');
    await h.request('FILE_BACKUP_NOW');
    assert.equal(h.state.storage.fileBackupState.lastCompletedAt, undefined);
    assert.equal(h.state.alarms.get(ALARM).when, h.state.now + 5 * MINUTE);
    h.state.folderWriteError = null;
    h.state.now += 5 * MINUTE;
    await h.fire();
    assert.equal(h.state.folderWrites.length, 1);
});

test('워커 재시작 시 폴더에 이미 저장된 파일을 검증해 중복 저장 없이 완료한다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_USE_FOLDER', { id: addFolder(h) });
    let interruptedStorage;
    h.state.folderWriteHook = async () => { interruptedStorage = clone(h.state.storage); };
    await h.request('FILE_BACKUP_NOW');
    const restarted = harness({ storage: interruptedStorage, folders: [...h.state.folders], folderFiles: [...h.state.folderFiles] });
    await restarted.api.initialize();
    assert.equal(restarted.state.storage.fileBackupState.lastBookCount, 1);
    assert.equal(restarted.state.storage.fileBackupState.pending, null);
    assert.equal(restarted.state.folderWrites.length, 0);
});

test('재시작 후 미완료·손상된 폴더 파일은 완료로 표시하지 않는다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_USE_FOLDER', { id: addFolder(h) });
    let interruptedStorage;
    h.state.folderWriteHook = async () => { interruptedStorage = clone(h.state.storage); };
    await h.request('FILE_BACKUP_NOW');
    const pending = interruptedStorage.fileBackupState.pending;
    for (const files of [[], [[`${pending.destination.id}/${pending.filename}`, '{incomplete']]]) {
        const restarted = harness({ storage: interruptedStorage, folders: [...h.state.folders], folderFiles: files });
        await restarted.api.initialize();
        assert.equal(restarted.state.storage.fileBackupState.lastCompletedAt, undefined);
        assert.match(restarted.state.storage.fileBackupState.error, /확인 실패/);
        assert.equal(restarted.state.storage.fileBackupState.pending, null);
    }
});

test('폴더 저장 중 발생한 변경은 다음 백업에 남긴다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_USE_FOLDER', { id: addFolder(h) });
    await h.request('FILE_BACKUP_SET_ENABLED', { enabled: true });
    h.state.folderWriteHook = async () => {
        h.state.folderWriteHook = null;
        h.state.revision++;
        h.state.books[0].title = '파일 저장 중 수정';
        await h.chrome.storage.local.set({ bookStoreChange: { token: 'during-write' } });
    };
    await h.request('FILE_BACKUP_NOW');
    await h.request();
    h.state.now += 5 * MINUTE;
    await h.fire();
    assert.equal(h.state.folderWrites.length, 2);
    assert.equal(h.state.folderWrites[1].data.bookList[0].title, '파일 저장 중 수정');
});

test('없는 폴더·권한 없는 폴더와 외부 페이지의 위치 변경 요청을 거절한다', async () => {
    const h = harness();
    assert.equal((await h.request('FILE_BACKUP_USE_FOLDER', { id: 'missing' })).ok, false);
    assert.equal((await h.request('FILE_BACKUP_USE_FOLDER', { id: addFolder(h, 'denied', 'denied') })).ok, false);
    const id = addFolder(h);
    const sender = { id: h.chrome.runtime.id, url: 'https://example.test' };
    assert.equal((await h.request('FILE_BACKUP_USE_FOLDER', { id }, sender)).ok, false);
    assert.equal((await h.request('FILE_BACKUP_DEFAULT_FOLDER', {}, sender)).ok, false);
    assert.equal(h.state.storage.fileBackupDestination, undefined);
});

test('폴더 기록이 사라져도 선택한 위치를 유지하고 다시 선택하도록 안내한다', async () => {
    const h = harness();
    const id = addFolder(h);
    await h.request('FILE_BACKUP_USE_FOLDER', { id });
    h.state.folders.delete(id);
    const response = await h.request('FILE_BACKUP_NOW');
    assert.equal(response.status.destination.permission, 'missing');
    assert.equal(h.state.storage.fileBackupDestination.id, id);
    assert.equal(h.state.requests.length, 0);
    assert.equal(h.state.folderWrites.length, 0);
});

test('진행 중인 다운로드가 있으면 저장 위치 변경을 완료 후로 미룬다', async () => {
    const h = harness({ completeImmediately: false });
    await h.request('FILE_BACKUP_NOW');
    assert.equal((await h.request('FILE_BACKUP_USE_FOLDER', { id: addFolder(h) })).ok, false);
    assert.equal(h.state.storage.fileBackupDestination, undefined);
    await h.finish();
    assert.equal((await h.request('FILE_BACKUP_USE_FOLDER', { id: 'folder-a' })).ok, true);
});

test('사이드 패널의 연속 요청은 작은 폴더 설정 창 하나를 재사용한다', async () => {
    const h = harness();
    const responses = await Promise.all([
        h.request('FILE_BACKUP_OPEN_FOLDER_WINDOW'), h.request('FILE_BACKUP_OPEN_FOLDER_WINDOW')
    ]);
    assert.ok(responses.every(response => response.ok));
    assert.equal(h.state.createdWindows.length, 1);
    assert.equal(h.state.createdWindows[0].url, h.chrome.runtime.getURL('file-backup-folder-window.html'));
    assert.equal(h.state.createdWindows[0].type, 'popup');
    assert.equal(h.state.createdWindows[0].width, 520);
    assert.deepEqual(h.state.focusedWindows, [100]);
    h.state.windows.delete(100);
    await h.request('FILE_BACKUP_OPEN_FOLDER_WINDOW');
    assert.equal(h.state.createdWindows.length, 2);
});

test('백그라운드 재시작 후에도 열려 있는 폴더 설정 창을 찾아 재사용한다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_OPEN_FOLDER_WINDOW');
    const restarted = harness({ windows: [...h.state.windows] });
    await restarted.request('FILE_BACKUP_OPEN_FOLDER_WINDOW');
    assert.equal(restarted.state.createdWindows.length, 0);
    assert.deepEqual(restarted.state.focusedWindows, [100]);
});

test('전용 창 열기 실패를 알려주고 기존 폴더 설정을 유지한다', async () => {
    const h = harness();
    await h.request('FILE_BACKUP_USE_FOLDER', { id: addFolder(h) });
    h.state.windowError = '창을 열 수 없습니다';
    const response = await h.request('FILE_BACKUP_OPEN_FOLDER_WINDOW');
    assert.equal(response.ok, false);
    assert.match(response.error, /창을 열 수 없습니다/);
    assert.equal(h.state.storage.fileBackupDestination.id, 'folder-a');
});

test('전용 창에는 폴더 선택·접근 허용·백업 명령만 허용한다', async () => {
    const h = harness();
    const sender = { id: h.chrome.runtime.id, url: h.chrome.runtime.getURL('file-backup-folder-window.html') };
    assert.equal((await h.request('FILE_BACKUP_STATUS', {}, sender)).ok, true);
    assert.equal((await h.request('FILE_BACKUP_USE_FOLDER', { id: addFolder(h) }, sender)).ok, true);
    assert.equal((await h.request('FILE_BACKUP_FOLDER_ACCESS', {}, sender)).ok, true);
    assert.equal((await h.request('FILE_BACKUP_NOW', {}, sender)).ok, true);
    assert.equal(h.state.folderWrites.length, 1);
    for (const action of ['FILE_BACKUP_OPEN_FOLDER_WINDOW', 'FILE_BACKUP_DEFAULT_FOLDER', 'FILE_BACKUP_SET_ENABLED', 'FILE_BACKUP_SHOW']) {
        assert.equal((await h.request(action, { enabled: true }, sender)).ok, false);
    }
    assert.equal((await h.request('FILE_BACKUP_OPEN_FOLDER_WINDOW', {}, { ...sender, url: 'https://example.test' })).ok, false);
    assert.equal(h.state.createdWindows.length, 0);
});
