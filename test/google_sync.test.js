const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'google-sync.js'), 'utf8');
const lockSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8')
    .match(/function bookStoreWithSyncLock\(operation\) \{[\s\S]*?\n\}/)[0];
const storeId = 'kjfmielegfhljmjjmhjmidlfdponknpm';
const scope = 'https://www.googleapis.com/auth/drive.appdata';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const book = (id = 1, title = '도서', missingVols = []) => ({ id, title, missingVols });

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
}

function remoteFile(books, etag = '"version-1"') {
    const normalized = books.map(value => ({
        ...value,
        title: value.title.trim(),
        missingVols: [...new Set(value.missingVols)].sort((a, b) => a - b)
    })).sort((a, b) => a.id - b.id).map(canonical);
    const hash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return {
        fileId: 'remote-db', etag,
        payload: { format: 'book-manager-google-sync', version: 1, updatedAt: 123456, hash, books: normalized }
    };
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function event() {
    const listeners = [];
    return {
        listeners,
        addListener: listener => listeners.push(listener),
        emit: (...args) => listeners.forEach(listener => listener(...args))
    };
}

function lockManager() {
    const queues = new Map();
    return {
        request: (name, options, operation) => {
            assert.equal(options.mode, 'exclusive');
            const result = (queues.get(name) || Promise.resolve()).then(operation);
            queues.set(name, result.catch(() => {}));
            return result;
        }
    };
}

async function waitUntil(predicate) {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, '비동기 처리가 제한 시간 내에 완료되지 않았습니다.');
        await new Promise(resolve => setTimeout(resolve, 1));
    }
}

function harness(options = {}) {
    const state = {
        books: clone(options.books || []),
        revision: options.revision || 10,
        remote: clone(options.remote || null),
        storage: {
            googleSyncState: clone(options.state || {}),
            googleSyncPreferences: clone(options.preferences),
            missingVolsMap: clone(options.missingVolsMap || {})
        },
        pending: clone(options.pending),
        replacement: clone(options.replacement),
        account: { id: 'account-1', email: 'reader@example.com', ...options.account },
        auth: [], reads: 0, writes: [], applies: [], backups: [], remoteBackups: [], verifications: [], publications: [],
        clearedTokens: 0,
        alarms: new Map(), alarmCreates: [], alarmClears: [],
        hooks: {}
    };
    if (options.server) {
        Object.defineProperty(state, 'remote', {
            get: () => options.server.file,
            set: value => { options.server.file = value; }
        });
    }
    function assertRemoteVersion(previous) {
        if ((previous?.fileId || null) !== (state.remote?.fileId || null)
            || (previous?.etag || null) !== (state.remote?.etag || null)) {
            const error = new Error('다른 기기에서 DB가 변경되었습니다.');
            error.name = 'GoogleSyncConflictError';
            throw error;
        }
    }
    const chrome = {
        runtime: {
            id: options.extensionId || storeId,
            getManifest: () => ({
                update_url: 'https://clients2.google.com/service/update2/crx',
                oauth2: { client_id: '123456789-valid_client.apps.googleusercontent.com', scopes: [scope] },
                ...options.manifest
            }),
            getURL: file => `chrome-extension://${chrome.runtime.id}/${file}`,
            onMessage: event(), onStartup: event(), onInstalled: event()
        },
        management: {
            getSelf: async () => {
                if (options.installFailure) throw new Error('installation lookup failed');
                return { installType: options.installType || 'normal' };
            }
        },
        identity: { clearAllCachedAuthTokens: async () => { state.clearedTokens++; } },
        storage: {
            onChanged: event(),
            local: {
                get: async defaults => clone(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
                    key, Object.hasOwn(state.storage, key) ? state.storage[key] : value
                ]))),
                set: async values => {
                    if (state.hooks.storageSet) await state.hooks.storageSet(values);
                    const changes = {};
                    for (const [key, value] of Object.entries(values)) {
                        if (JSON.stringify(state.storage[key]) !== JSON.stringify(value)) {
                            changes[key] = { oldValue: clone(state.storage[key]), newValue: clone(value) };
                        }
                        state.storage[key] = clone(value);
                    }
                    chrome.storage.onChanged.emit(changes, 'local');
                }
            }
        },
        alarms: {
            onAlarm: event(),
            create: async (name, settings) => {
                state.alarmCreates.push({ name, ...clone(settings) });
                state.alarms.set(name, clone(settings));
            },
            clear: async name => { state.alarmClears.push(name); state.alarms.delete(name); },
            get: async name => clone(state.alarms.get(name))
        }
    };
    let queue = Promise.resolve();
    const context = vm.createContext({
        chrome, crypto: crypto.webcrypto, TextEncoder, URL,
        navigator: { locks: options.locks || lockManager() },
        GoogleBookDrive: {
            create: async interactive => {
                state.auth.push(interactive);
                if (state.hooks.auth) await state.hooks.auth();
                return {
                    account: async () => clone(state.account),
                    read: async () => {
                        state.reads++;
                        if (state.hooks.read) await state.hooks.read();
                        return clone(state.remote);
                    },
                    assertUnchanged: async previous => {
                        state.verifications.push(clone(previous));
                        if (state.hooks.verify) await state.hooks.verify();
                        assertRemoteVersion(previous);
                    },
                    write: async (payload, previous) => {
                        state.writes.push({ payload: clone(payload), previous: clone(previous) });
                        if (state.hooks.write) await state.hooks.write();
                        assertRemoteVersion(previous);
                        state.remote = { fileId: 'remote-db', etag: `"${crypto.randomUUID()}"`, payload: clone(payload) };
                        return clone(state.remote);
                    }
                };
            }
        },
        enqueueBookMutation: operation => {
            const result = queue.then(operation, operation);
            queue = result.then(() => undefined, () => undefined);
            return result;
        },
        ensureBookStoreReady: async () => {},
        bookStoreGetAllWithRevision: async () => ({ bookList: clone(state.books), revision: state.revision }),
        bookStoreGetRevision: async () => {
            if (state.hooks.localRevision) await state.hooks.localRevision();
            return state.revision;
        },
        getBookMissingVols: (value, map) => {
            const volumes = Object.hasOwn(map, String(value.id)) ? map[String(value.id)] : value.missingVols;
            return Array.isArray(volumes) ? volumes : [];
        },
        bookStoreBackupGoogleRemote: async (books, metadata) => {
            if (state.hooks.backup) await state.hooks.backup();
            state.remoteBackups.push({ books: clone(books), metadata: clone(metadata) });
        },
        bookStoreApplyGoogleSnapshot: async (books, revision, backup, checkpoint) => {
            state.applies.push({ books: clone(books), revision, backup: clone(backup), checkpoint: clone(checkpoint) });
            if (state.hooks.apply) await state.hooks.apply();
            if (revision !== state.revision) {
                const error = new Error('도서 목록이 변경되었습니다.');
                error.name = 'BookStoreConflictError';
                throw error;
            }
            state.backups.push(clone(backup));
            state.books = clone(books);
            state.revision++;
            state.pending = {
                key: 'google-sync-pending', revision: state.revision,
                previousMissingVolsMap: clone(backup.missingVolsMap),
                missingVolsMap: Object.fromEntries(books.map(value => [String(value.id), clone(value.missingVols)])),
                checkpoint: clone(checkpoint)
            };
        },
        bookStorePublishChange: async change => { state.publications.push(clone(change)); },
        db: {
            meta: {
                get: async key => {
                    if (key === 'google-sync-local-replacement') return clone(state.replacement);
                    assert.equal(key, 'google-sync-pending');
                    return clone(state.pending);
                },
                delete: async key => {
                    assert.equal(key, 'google-sync-pending');
                    state.pending = undefined;
                }
            }
        }
    });
    state.sync = vm.runInContext(`${lockSource}\n${source}\nGoogleBookSync;`, context);
    state.withSyncLock = vm.runInContext('bookStoreWithSyncLock;', context);
    state.chrome = chrome;
    state.message = (message, sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('options.html') }) => {
        return new Promise(resolve => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
    };
    return state;
}

test('미연결 상태에서는 초기화 및 자동 동기화가 인증이나 Drive 요청을 시작하지 않는다', async () => {
    const state = harness({ books: [book()] });
    await state.sync.initialize();
    await state.sync.run();
    assert.deepEqual(state.auth, []);
    assert.equal(state.reads, 0);
    assert.equal(state.writes.length, 0);
    assert.equal(state.alarms.size, 0);
    assert.equal((await state.sync.status()).enabled, false);
});

test('고정 ID가 없는 직접 설치본과 지원하지 않는 설치본은 Google 연결을 차단한다', async t => {
    for (const options of [
        { installType: 'development' },
        { installType: 'development', extensionId: 'unrelated-extension', manifest: { key: 'fixed-public-key' } },
        { installType: 'development', manifest: { key: '  ' } },
        { installType: 'sideload' },
        { extensionId: 'unrelated-extension' },
        { manifest: { update_url: undefined } },
        { installFailure: true }
    ]) {
        await t.test(JSON.stringify(options), async () => {
            const state = harness(options);
            assert.equal((await state.sync.status()).available, false);
            await state.sync.initialize();
            await assert.rejects(state.sync.run({ connect: true }), /설치/);
            assert.deepEqual(state.auth, []);
            assert.equal(state.reads, 0);
            assert.equal(state.alarms.size, 0);
        });
    }
});

test('같은 ID로 고정된 직접 설치본은 업데이트 주소 없이 Google 동기화에 연결한다', async () => {
    const state = harness({
        installType: 'development',
        manifest: { key: 'fixed-public-key', update_url: undefined },
        books: [book(1, '직접 설치 도서', [3])]
    });
    const status = await state.sync.status();
    assert.equal(status.available, true);
    assert.equal(status.configured, true);
    await state.sync.run({ connect: true });
    assert.deepEqual(state.auth, [true]);
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].payload.books[0].title, '직접 설치 도서');
    assert.deepEqual(state.writes[0].payload.books[0].missingVols, [3]);
    assert.equal((await state.sync.status()).enabled, true);
});

test('직접 설치본은 같은 계정의 기존 Drive DB를 내려받을 수 있다', async () => {
    const remote = remoteFile([book(1, '다른 기기의 도서')]);
    const state = harness({
        installType: 'development',
        manifest: { key: 'fixed-public-key', update_url: undefined },
        remote
    });
    await state.sync.run({ connect: true });
    assert.deepEqual(state.books, remote.payload.books);
    assert.equal(state.writes.length, 0);
    assert.equal(state.backups.length, 1);
});

test('ID를 고정했어도 OAuth 설정이 없는 직접 설치본은 인증을 시작하지 않는다', async () => {
    const state = harness({
        installType: 'development',
        manifest: { key: 'fixed-public-key', oauth2: undefined, update_url: undefined }
    });
    const status = await state.sync.status();
    assert.equal(status.available, true);
    assert.equal(status.configured, false);
    await assert.rejects(state.sync.run({ connect: true }), /준비 중/);
    assert.deepEqual(state.auth, []);
});

test('OAuth 클라이언트와 앱 데이터 권한이 준비되지 않으면 연결을 시작하지 않는다', async t => {
    for (const oauth2 of [
        undefined,
        { client_id: 'CHROME_STORE_OAUTH_CLIENT_ID', scopes: [scope] },
        { client_id: '123-valid.apps.googleusercontent.com', scopes: [] }
    ]) {
        await t.test(JSON.stringify(oauth2) || 'missing oauth2', async () => {
            const state = harness({ manifest: { oauth2 } });
            const status = await state.sync.status();
            assert.equal(status.available, true);
            assert.equal(status.configured, false);
            await assert.rejects(state.sync.run({ connect: true }), /준비 중/);
            assert.deepEqual(state.auth, []);
        });
    }
});

test('최초 연결은 로컬 DB와 우선 적용된 누락 권수를 Drive에 업로드한다', async () => {
    const local = [
        { ...book(2, ' 두 번째 ', [2]), cleanTitleStr: 'derived', _bookStoreRevision: 8 },
        { ...book(1, '첫 번째', [9]), author: '작가', custom: { z: 1, a: 2 } }
    ];
    const state = harness({ books: local, missingVolsMap: { 1: [], 2: [5, 3, 5] } });
    await state.sync.run({ connect: true });
    assert.deepEqual(state.auth, [true]);
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].previous, null);
    assert.deepEqual(state.writes[0].payload.books, [
        { author: '작가', custom: { a: 2, z: 1 }, id: 1, missingVols: [], title: '첫 번째' },
        { id: 2, missingVols: [3, 5], title: '두 번째' }
    ]);
    assert.equal(state.writes[0].payload.hash, remoteFile(state.writes[0].payload.books).payload.hash);
    assert.deepEqual(state.books, local);
    assert.equal(state.applies.length, 0);
    const status = await state.sync.status();
    assert.equal(status.state, 'idle');
    assert.equal(status.enabled, true);
    assert.equal(status.accountEmail, 'reader@example.com');
    assert.ok(status.lastSyncedAt > 0);
    assert.deepEqual(state.alarms.get('google-book-sync'), { periodInMinutes: 5 });
});

test('빈 로컬 DB의 최초 연결은 원격 목록을 백업·리비전 확인 후 내려받는다', async () => {
    const remote = remoteFile([book(3, '원격 도서', [2, 4])]);
    const state = harness({ remote, missingVolsMap: { 8: [1] } });
    await state.sync.run({ connect: true });
    assert.deepEqual(state.books, remote.payload.books);
    assert.deepEqual(state.storage.missingVolsMap, { 3: [2, 4] });
    assert.deepEqual(state.backups, [{ bookList: [], missingVolsMap: { 8: [1] } }]);
    assert.equal(state.applies[0].revision, 10);
    assert.equal(state.pending, undefined);
    assert.deepEqual(state.publications, [{ type: 'reload', reason: 'google-sync', revision: 11 }]);
    assert.equal(state.storage.googleSyncState.baseHash, remote.payload.hash);
    assert.equal(state.writes.length, 0);
});

test('최초 연결에서 양쪽 DB가 다르면 자동 덮어쓰기 없이 충돌 상태로 보존한다', async () => {
    const books = [book(1, '로컬')];
    const remote = remoteFile([book(2, '원격')]);
    const state = harness({ books, remote });
    await state.sync.run({ connect: true });
    assert.deepEqual(state.books, books);
    assert.deepEqual(state.remote, remote);
    assert.equal(state.writes.length, 0);
    assert.equal(state.applies.length, 0);
    const status = await state.sync.status();
    assert.equal(status.state, 'conflict');
    assert.equal(status.conflict.localCount, 1);
    assert.equal(status.conflict.remoteCount, 1);
    assert.ok(status.conflict.token);
    assert.equal(status.conflict.etag, remote.etag);
});

test('같은 목록은 순서와 누락 권수 중복을 정규화하여 네트워크 쓰기 없이 연결한다', async () => {
    const remote = remoteFile([book(1, '첫째', [1, 3]), book(2, '둘째')]);
    const state = harness({ books: [book(2, '둘째'), book(1, ' 첫째 ', [3, 1, 3])], remote });
    await state.sync.run({ connect: true });
    assert.equal(state.writes.length, 0);
    assert.equal(state.applies.length, 0);
    assert.equal(state.storage.googleSyncState.baseHash, remote.payload.hash);
    assert.equal((await state.sync.status()).state, 'idle');
});

test('로컬만 바뀌면 마지막 원격 버전 조건으로 업로드한다', async () => {
    const remote = remoteFile([book(1, '이전 목록')]);
    const state = harness({
        books: [book(1, '새 로컬 목록')], remote,
        state: { enabled: true, accountId: 'account-1', baseHash: remote.payload.hash }
    });
    await state.sync.run();
    assert.deepEqual(state.auth, [false]);
    assert.equal(state.writes[0].previous.etag, remote.etag);
    assert.equal(state.writes[0].previous.fileId, remote.fileId);
    assert.equal(state.remote.payload.books[0].title, '새 로컬 목록');
    assert.equal(state.applies.length, 0);
    assert.equal(state.storage.googleSyncState.baseHash, state.remote.payload.hash);
});

test('원격 변경에 삭제가 포함되면 확인 후 내려받고 누락 권수 변경도 반영한다', async () => {
    const books = [book(1, '이전 도서', [1]), book(2, '삭제된 도서')];
    const remote = remoteFile([book(1, '수정된 도서', [3])], '"version-2"');
    const state = harness({
        books, remote, missingVolsMap: { 1: [1], 2: [] },
        state: { enabled: true, accountId: 'account-1', baseHash: remoteFile(books).payload.hash }
    });
    await state.sync.run();
    assert.deepEqual(state.books, books);
    assert.equal(state.applies.length, 0);
    const conflict = (await state.sync.status()).conflict;
    assert.equal(conflict.reason, 'deletion');
    assert.deepEqual(clone(conflict.remoteChanges), { added: 0, updated: 1, removed: 1 });
    await state.sync.run({ resolution: 'remote', conflictToken: conflict.token });
    assert.deepEqual(state.books, remote.payload.books);
    assert.deepEqual(state.storage.missingVolsMap, { 1: [3] });
    assert.deepEqual(state.backups[0], { bookList: books, missingVolsMap: { 1: [1], 2: [] } });
    assert.equal(state.writes.length, 0);
    assert.equal(state.storage.googleSyncState.baseHash, remote.payload.hash);
});

test('누락 권수 맵만 바뀌어도 로컬 변경으로 감지한다', async () => {
    const books = [book(1, '도서', [2])];
    const remote = remoteFile(books);
    const state = harness({
        books, remote, missingVolsMap: { 1: [] },
        state: { enabled: true, accountId: 'account-1', baseHash: remote.payload.hash }
    });
    await state.sync.run();
    assert.deepEqual(state.writes[0].payload.books[0].missingVols, []);
    assert.equal(state.applies.length, 0);
});

test('양쪽 변경 충돌은 오래된 선택 토큰을 거부하고 최신 선택만 적용한다', async t => {
    for (const resolution of ['local', 'remote']) {
        await t.test(resolution, async () => {
            const books = [book(1, '로컬 수정')];
            const remote = remoteFile([book(1, '원격 수정')]);
            const state = harness({
                books, remote,
                state: { enabled: true, accountId: 'account-1', baseHash: remoteFile([book()]).payload.hash }
            });
            await state.sync.run();
            const originalToken = state.storage.googleSyncState.conflict.token;
            await state.sync.run({ resolution, conflictToken: 'stale-token' });
            assert.equal(state.applies.length, 0);
            assert.equal(state.writes.length, 0);
            const nextToken = state.storage.googleSyncState.conflict.token;
            assert.equal(nextToken, originalToken);
            await state.sync.run({ resolution, conflictToken: nextToken });
            assert.equal((await state.sync.status()).state, 'idle');
            assert.equal(state.storage.googleSyncState.conflict, null);
            if (resolution === 'local') {
                assert.deepEqual(state.remote.payload.books, books);
                assert.deepEqual(state.books, books);
                assert.equal(state.applies.length, 0);
            } else {
                assert.deepEqual(state.books, remote.payload.books);
                assert.deepEqual(state.backups[0].bookList, books);
                assert.equal(state.writes.length, 0);
            }
        });
    }
});

test('충돌 화면을 연 뒤 로컬·원격 또는 원격 파일 버전이 바뀌면 다시 선택해야 한다', async t => {
    for (const change of ['local', 'remote', 'etag', 'fileId']) {
        await t.test(change, async () => {
            const state = harness({ books: [book(1, '로컬')], remote: remoteFile([book(2, '원격')]) });
            await state.sync.run({ connect: true });
            const token = state.storage.googleSyncState.conflict.token;
            if (change === 'local') state.books.push(book(3, '새 도서'));
            if (change === 'remote') state.remote = remoteFile([book(4, '새 원격 도서')]);
            if (change === 'etag') state.remote.etag = '"version-2"';
            if (change === 'fileId') state.remote.fileId = 'recreated-file';
            await state.sync.run({ resolution: 'remote', conflictToken: token });
            assert.equal((await state.sync.status()).state, 'conflict');
            assert.notEqual(state.storage.googleSyncState.conflict.token, token);
            assert.equal(state.applies.length, 0);
            assert.equal(state.writes.length, 0);
        });
    }
});

test('Drive 조건부 쓰기 실패는 기준 해시와 로컬 DB를 보존한다', async () => {
    const books = [book(1, '로컬 수정')];
    const remote = remoteFile([book(1, '이전 목록')]);
    const state = harness({
        books, remote,
        state: { enabled: true, accountId: 'account-1', baseHash: remote.payload.hash }
    });
    state.hooks.write = async () => {
        const error = new Error('다른 기기에서 DB가 변경되었습니다.');
        error.name = 'GoogleSyncConflictError';
        throw error;
    };
    await assert.rejects(state.sync.run(), { name: 'GoogleSyncConflictError' });
    assert.equal(state.storage.googleSyncState.baseHash, remote.payload.hash);
    assert.deepEqual(state.books, books);
    assert.deepEqual(state.remote, remote);
    assert.equal(state.writes.length, 1);
    assert.equal((await state.sync.status()).state, 'error');
});

test('DB 리비전이 반영 직전에 바뀌면 원격 목록으로 덮어쓰지 않는다', async () => {
    const books = [book(1, '기존 목록')];
    const state = harness({
        books, remote: remoteFile([book(1, '원격 목록')]),
        state: { enabled: true, accountId: 'account-1', baseHash: remoteFile(books).payload.hash }
    });
    state.hooks.apply = async () => { state.books.push(book(2, '동시 추가')); state.revision++; };
    await assert.rejects(state.sync.run(), { name: 'BookStoreConflictError' });
    assert.deepEqual(state.books, [...books, book(2, '동시 추가')]);
    assert.equal(state.backups.length, 0);
    assert.equal(state.pending, undefined);
    assert.equal(state.storage.googleSyncState.baseHash, remoteFile(books).payload.hash);
});

test('원격 반영 전에 누락 권수가 바뀌면 사용자 수정 내용을 유지한다', async () => {
    const books = [book(1, '도서', [1])];
    const baseHash = remoteFile(books).payload.hash;
    const state = harness({
        books, remote: remoteFile([book(1, '원격 변경', [2])]), missingVolsMap: { 1: [1] },
        state: { enabled: true, accountId: 'account-1', baseHash }
    });
    state.hooks.localRevision = async () => { state.storage.missingVolsMap = { 1: [7] }; };
    await assert.rejects(state.sync.run(), /누락 권수가 변경/);
    assert.deepEqual(state.books, books);
    assert.deepEqual(state.storage.missingVolsMap, { 1: [7] });
    assert.equal(state.applies.length, 0);
    assert.equal(state.storage.googleSyncState.baseHash, baseHash);
});

test('원격 파일의 형식·내용·해시가 잘못되면 로컬 DB를 유지한다', async t => {
    const cases = {
        format: file => { file.payload.format = 'unknown'; },
        version: file => { file.payload.version = 2; },
        hash: file => { file.payload.hash = 'incorrect'; },
        books: file => { file.payload.books = {}; },
        duplicateIds: file => { file.payload.books.push(clone(file.payload.books[0])); },
        title: file => { file.payload.books[0].title = ' '; },
        missingVolumes: file => { file.payload.books[0].missingVols = [-1]; }
    };
    for (const [name, mutate] of Object.entries(cases)) {
        await t.test(name, async () => {
            const books = [book(1, '로컬 보존')];
            const remote = remoteFile([book(2, '원격')]);
            mutate(remote);
            const state = harness({ books, remote });
            await assert.rejects(state.sync.run({ connect: true }));
            assert.deepEqual(state.books, books);
            assert.equal(state.applies.length, 0);
            assert.equal(state.writes.length, 0);
            assert.equal(state.storage.googleSyncState.baseHash, undefined);
        });
    }
});

test('저장된 연결 계정과 Google 계정이 다르면 DB 접근을 차단한다', async () => {
    const books = [book()];
    const state = harness({ books, state: { enabled: true, accountId: 'old-account' } });
    await assert.rejects(state.sync.run(), /계정이 변경/);
    assert.equal(state.reads, 0);
    assert.equal(state.writes.length, 0);
    assert.deepEqual(state.books, books);
    assert.equal(state.storage.googleSyncState.accountId, 'old-account');
});

test('Drive 읽기 중 연결을 끊으면 응답이 도착해도 로컬 DB에 반영하지 않는다', async () => {
    const read = deferred();
    const state = harness({ remote: remoteFile([book()]) });
    state.hooks.read = () => read.promise;
    const syncing = state.sync.run({ connect: true });
    await waitUntil(() => state.reads === 1);
    const stopped = assert.rejects(syncing, { name: 'GoogleSyncCancelledError' });
    const disconnecting = state.sync.disconnect();
    await waitUntil(() => state.storage.googleSyncState.enabled === false);
    read.resolve();
    await stopped;
    await disconnecting;
    assert.deepEqual(state.books, []);
    assert.equal(state.applies.length, 0);
    assert.equal(state.writes.length, 0);
    assert.equal(state.clearedTokens, 1);
    assert.equal(state.alarms.size, 0);
    assert.equal(state.storage.googleSyncState.enabled, false);
    assert.equal(state.storage.googleSyncState.state, 'disabled');
    assert.equal(state.storage.googleSyncState.accountId, null);
    assert.equal(state.storage.googleSyncState.baseHash, null);
    assert.equal(state.storage.googleSyncState.conflict, null);
});

test('동시 동기화 요청은 실행 하나를 공유한다', async () => {
    const read = deferred();
    const state = harness({ books: [book()] });
    state.hooks.read = () => read.promise;
    const first = state.sync.run({ connect: true });
    const second = state.sync.run();
    assert.equal(first, second);
    await waitUntil(() => state.reads === 1);
    assert.equal((await state.sync.status()).busy, true);
    read.resolve();
    await Promise.all([first, second]);
    assert.equal(state.auth.length, 1);
    assert.equal(state.writes.length, 1);
    assert.equal((await state.sync.status()).busy, false);
});

test('옵션 페이지 이외의 콘텐츠 스크립트와 확장 페이지는 동기화를 제어하지 못한다', async t => {
    for (const sender of [
        { id: storeId, url: 'https://example.com/' },
        { id: storeId, url: `chrome-extension://${storeId}/popup.html` },
        { id: storeId, url: `chrome-extension://${storeId}/options.html/other` },
        { id: 'other-extension', url: `chrome-extension://${storeId}/options.html` },
        { id: storeId }
    ]) {
        await t.test(sender.url || 'missing URL', async () => {
            const state = harness();
            const response = await state.message({ action: 'GOOGLE_SYNC_CONNECT' }, sender);
            assert.equal(response.ok, false);
            assert.match(response.error, /설정 화면/);
            assert.deepEqual(state.auth, []);
        });
    }
});

test('옵션 페이지의 상태 조회 및 연결 요청과 잘못된 충돌 선택을 처리한다', async () => {
    const state = harness({ books: [book()] });
    const sender = { id: storeId, url: `chrome-extension://${storeId}/options.html?tab=sync#google` };
    const status = await state.message({ action: 'GOOGLE_SYNC_STATUS' }, sender);
    assert.equal(status.ok, true);
    assert.equal(status.status.enabled, false);
    assert.deepEqual(state.auth, []);
    const connected = await state.message({ action: 'GOOGLE_SYNC_CONNECT' }, sender);
    assert.equal(connected.ok, true);
    assert.equal(connected.status.enabled, true);
    const invalid = await state.message({ action: 'GOOGLE_SYNC_RESOLVE', resolution: 'merge' }, sender);
    assert.equal(invalid.ok, false);
    assert.equal(state.auth.length, 1);
});

test('시작 시 주기 알람을 복원하고 DB 변경 알람은 중복 예약하지 않는다', async () => {
    const books = [book()];
    const remote = remoteFile(books);
    const state = harness({ books, remote, state: { enabled: true, accountId: 'account-1', baseHash: remote.payload.hash } });
    await state.sync.initialize();
    assert.deepEqual(state.alarms.get('google-book-sync'), { periodInMinutes: 5 });
    state.chrome.storage.onChanged.emit({ unrelatedSetting: { newValue: true } }, 'local');
    state.chrome.storage.onChanged.emit({ missingVolsMap: { newValue: {} } }, 'sync');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.alarms.has('google-book-sync-change'), false);
    state.chrome.storage.onChanged.emit({ bookStoreChange: { newValue: { revision: 11 } } }, 'local');
    await waitUntil(() => state.alarms.has('google-book-sync-change'));
    state.chrome.storage.onChanged.emit({ missingVolsMap: { newValue: { 1: [] } } }, 'local');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(state.alarmCreates.filter(alarm => alarm.name === 'google-book-sync-change'), [
        { name: 'google-book-sync-change', delayInMinutes: 0.5 }
    ]);
    state.chrome.alarms.onAlarm.emit({ name: 'other-feature' });
    assert.equal(state.auth.length, 1);
    state.chrome.alarms.onAlarm.emit({ name: 'google-book-sync-change' });
    await state.sync.run();
    assert.deepEqual(state.auth, [false, false]);
});

test('비활성 연결은 도서 변경이나 알람으로 다시 연결되지 않는다', async () => {
    const state = harness();
    state.chrome.storage.onChanged.emit({ missingVolsMap: { newValue: { 1: [3] } } }, 'local');
    state.chrome.alarms.onAlarm.emit({ name: 'google-book-sync' });
    await state.sync.run();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(state.auth, []);
    assert.equal(state.alarms.size, 0);
});

test('동기화 옵션은 기존 자동 동기화 동작을 기본값으로 제공한다', async () => {
    const state = harness();
    const status = await state.message({ action: 'GOOGLE_SYNC_STATUS' });
    assert.equal(status.ok, true);
    assert.deepEqual(clone(status.status.preferences), {
        autoSync: true,
        intervalMinutes: 5,
        syncOnStartup: true,
        syncOnChange: true
    });
    assert.deepEqual(state.auth, []);
});

test('연결 전에도 동기화 옵션을 부분 저장하고 연결 해제 후에도 유지한다', async () => {
    const state = harness({ books: [book()] });
    const first = await state.message({
        action: 'GOOGLE_SYNC_UPDATE_PREFERENCES',
        preferences: { autoSync: false, intervalMinutes: 30 }
    });
    assert.equal(first.ok, true);
    const updated = await state.message({
        action: 'GOOGLE_SYNC_UPDATE_PREFERENCES',
        preferences: { syncOnStartup: false, syncOnChange: false }
    });
    const preferences = { autoSync: false, intervalMinutes: 30, syncOnStartup: false, syncOnChange: false };
    assert.equal(updated.ok, true);
    assert.deepEqual(clone(updated.status.preferences), preferences);
    assert.deepEqual(state.storage.googleSyncPreferences, preferences);
    assert.deepEqual(state.storage.googleSyncState, {});
    assert.deepEqual(state.auth, []);
    assert.equal(state.alarms.size, 0);
    assert.equal((await state.message({ action: 'GOOGLE_SYNC_CONNECT' })).ok, true);
    assert.equal((await state.message({ action: 'GOOGLE_SYNC_DISCONNECT' })).ok, true);
    assert.deepEqual(state.storage.googleSyncPreferences, preferences);
    assert.deepEqual(clone((await state.sync.status()).preferences), preferences);
});

test('잘못된 동기화 옵션은 기존 설정과 알람을 변경하지 않는다', async t => {
    for (const preferences of [
        undefined,
        null,
        [],
        { autoSync: 'false' },
        { syncOnStartup: 1 },
        { syncOnChange: null },
        { intervalMinutes: '15' },
        { intervalMinutes: 0 },
        { intervalMinutes: 10 },
        { intervalMinutes: 5.5 },
        { intervalMinutes: 120 },
        { unknownOption: true },
        { autoSync: false, intervalMinutes: 10 }
    ]) {
        await t.test(JSON.stringify(preferences) || 'missing preferences', async () => {
            const saved = { autoSync: true, intervalMinutes: 15, syncOnStartup: false, syncOnChange: true };
            const state = harness({ preferences: saved, state: { enabled: true, accountId: 'account-1' } });
            await state.sync.initialize({ syncOnStart: false });
            const alarms = [...state.alarms.entries()];
            const response = await state.message({ action: 'GOOGLE_SYNC_UPDATE_PREFERENCES', preferences });
            assert.equal(response.ok, false);
            assert.deepEqual(state.storage.googleSyncPreferences, saved);
            assert.deepEqual([...state.alarms.entries()], alarms);
            assert.deepEqual(state.auth, []);
        });
    }
});

test('설정 페이지 이외의 요청은 동기화 옵션을 변경하지 못한다', async () => {
    const state = harness();
    const response = await state.message({
        action: 'GOOGLE_SYNC_UPDATE_PREFERENCES', preferences: { autoSync: false }
    }, { id: storeId, url: `chrome-extension://${storeId}/popup.html` });
    assert.equal(response.ok, false);
    assert.match(response.error, /설정 화면/);
    assert.equal(state.storage.googleSyncPreferences, undefined);
    assert.deepEqual(state.auth, []);
});

test('주기 변경은 알람에 반영되고 서비스 워커 재시작은 인증 없이 저장된 주기를 복원한다', async () => {
    const state = harness({ state: { enabled: true, accountId: 'account-1' } });
    await state.sync.initialize({ syncOnStart: false });
    for (const intervalMinutes of [15, 30, 60, 5]) {
        const response = await state.message({
            action: 'GOOGLE_SYNC_UPDATE_PREFERENCES', preferences: { intervalMinutes }
        });
        assert.equal(response.ok, true);
        assert.deepEqual(state.alarms.get('google-book-sync'), { periodInMinutes: intervalMinutes });
        const restarted = harness({ state: state.storage.googleSyncState, preferences: state.storage.googleSyncPreferences });
        await restarted.sync.initialize({ syncOnStart: false });
        assert.deepEqual(restarted.alarms.get('google-book-sync'), { periodInMinutes: intervalMinutes });
        assert.deepEqual(restarted.auth, []);
    }
    assert.deepEqual(state.auth, []);
});

test('자동 동기화를 끄면 주기 알람과 예약된 도서 변경 알람을 모두 취소한다', async () => {
    const state = harness({ state: { enabled: true, accountId: 'account-1' } });
    await state.sync.initialize({ syncOnStart: false });
    state.chrome.storage.onChanged.emit({ bookStoreChange: { newValue: { revision: 11 } } }, 'local');
    await waitUntil(() => state.alarms.has('google-book-sync-change'));
    const response = await state.message({
        action: 'GOOGLE_SYNC_UPDATE_PREFERENCES', preferences: { autoSync: false }
    });
    assert.equal(response.ok, true);
    assert.equal(state.alarms.size, 0);
    assert.equal(state.storage.googleSyncState.enabled, true);
    assert.deepEqual(state.auth, []);
});

test('자동 동기화를 끈 상태는 시작·도서 변경·남은 알람을 무시하고 수동 동기화는 허용한다', async () => {
    const books = [book()];
    const remote = remoteFile(books);
    const state = harness({
        books, remote,
        state: { enabled: true, accountId: 'account-1', baseHash: remote.payload.hash },
        preferences: { autoSync: false, intervalMinutes: 15, syncOnStartup: true, syncOnChange: true }
    });
    await state.sync.initialize();
    state.chrome.runtime.onStartup.emit();
    state.chrome.storage.onChanged.emit({ bookStoreChange: { newValue: { revision: 11 } } }, 'local');
    state.chrome.storage.onChanged.emit({ missingVolsMap: { newValue: { 1: [3] } } }, 'local');
    state.chrome.alarms.onAlarm.emit({ name: 'google-book-sync' });
    state.chrome.alarms.onAlarm.emit({ name: 'google-book-sync-change' });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(state.auth, []);
    assert.equal(state.reads, 0);
    assert.equal(state.alarms.size, 0);
    const response = await state.message({ action: 'GOOGLE_SYNC_NOW' });
    assert.equal(response.ok, true);
    assert.deepEqual(state.auth, [false]);
    assert.equal(state.reads, 1);
    assert.equal(state.alarms.size, 0);
});

test('시작 시 동기화를 끄더라도 정기 동기화는 계속 실행한다', async () => {
    const books = [book()];
    const remote = remoteFile(books);
    const state = harness({
        books, remote,
        state: { enabled: true, accountId: 'account-1', baseHash: remote.payload.hash },
        preferences: { autoSync: true, intervalMinutes: 15, syncOnStartup: false, syncOnChange: true }
    });
    await state.sync.initialize();
    state.chrome.runtime.onStartup.emit();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(state.auth, []);
    assert.deepEqual(state.alarms.get('google-book-sync'), { periodInMinutes: 15 });
    state.chrome.alarms.onAlarm.emit({ name: 'google-book-sync' });
    await waitUntil(() => state.reads === 1);
    await waitUntil(() => state.storage.googleSyncState.lastSyncedAt > 0);
    assert.deepEqual(state.auth, [false]);
});

test('변경 시 동기화를 끄면 변경 알람을 예약하지 않고 남은 변경 알람도 무시한다', async () => {
    const books = [book()];
    const remote = remoteFile(books);
    const state = harness({
        books, remote,
        state: { enabled: true, accountId: 'account-1', baseHash: remote.payload.hash },
        preferences: { autoSync: true, intervalMinutes: 30, syncOnStartup: true, syncOnChange: false }
    });
    await state.sync.initialize({ syncOnStart: false });
    state.chrome.storage.onChanged.emit({ bookStoreChange: { newValue: { revision: 11 } } }, 'local');
    state.chrome.storage.onChanged.emit({ missingVolsMap: { newValue: { 1: [3] } } }, 'local');
    state.chrome.alarms.onAlarm.emit({ name: 'google-book-sync-change' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(state.auth, []);
    assert.equal(state.alarms.has('google-book-sync-change'), false);
    assert.deepEqual(state.alarms.get('google-book-sync'), { periodInMinutes: 30 });
    state.chrome.alarms.onAlarm.emit({ name: 'google-book-sync' });
    await waitUntil(() => state.storage.googleSyncState.lastSyncedAt > 0);
    assert.deepEqual(state.auth, [false]);
    const response = await state.message({
        action: 'GOOGLE_SYNC_UPDATE_PREFERENCES', preferences: { syncOnChange: true }
    });
    assert.equal(response.ok, true);
    state.chrome.storage.onChanged.emit({ bookStoreChange: { newValue: { revision: 12 } } }, 'local');
    await waitUntil(() => state.alarms.has('google-book-sync-change'));
});

test('자동 동기화가 Drive를 읽는 중 자동 동기화를 끄면 원격 DB를 반영하지 않는다', async () => {
    const read = deferred();
    const state = harness({
        remote: remoteFile([book()]),
        state: { enabled: true, accountId: 'account-1' }
    });
    state.hooks.read = () => read.promise;
    const syncing = state.sync.run({ automaticTrigger: 'periodic' });
    await waitUntil(() => state.reads === 1);
    const stopped = assert.rejects(syncing, { name: 'GoogleSyncCancelledError' });
    const response = await state.message({
        action: 'GOOGLE_SYNC_UPDATE_PREFERENCES', preferences: { autoSync: false }
    });
    assert.equal(response.ok, true);
    read.resolve();
    await stopped;
    assert.deepEqual(state.books, []);
    assert.equal(state.applies.length, 0);
    assert.equal(state.writes.length, 0);
    assert.equal(state.storage.googleSyncState.enabled, true);
    assert.equal(state.alarms.size, 0);
});

test('DB 반영 후 저장소 실패가 발생하면 저널로 누락 권수와 동기화 기준을 복구한다', async () => {
    const remote = remoteFile([book(2, '원격', [4])]);
    const state = harness({ remote });
    state.hooks.storageSet = async values => {
        if (Object.hasOwn(values, 'missingVolsMap')) throw new Error('simulated storage failure');
    };
    await assert.rejects(state.sync.run({ connect: true }), /simulated storage failure/);
    assert.deepEqual(state.books, remote.payload.books);
    assert.ok(state.pending);
    assert.deepEqual(state.storage.missingVolsMap, {});
    const restarted = harness({
        books: state.books, revision: state.revision, pending: state.pending,
        missingVolsMap: state.storage.missingVolsMap,
        state: { ...state.storage.googleSyncState, enabled: false }
    });
    await restarted.sync.initialize();
    assert.deepEqual(restarted.storage.missingVolsMap, { 2: [4] });
    assert.equal(restarted.storage.googleSyncState.baseHash, remote.payload.hash);
    assert.equal(restarted.storage.googleSyncState.state, 'disabled');
    assert.equal(restarted.pending, undefined);
    assert.deepEqual(restarted.publications, [{ type: 'reload', reason: 'google-sync', revision: 11 }]);
    assert.deepEqual(restarted.auth, []);
});

test('저널 복구는 중단 이후 변경된 누락 권수와 다른 계정의 동기화 기준을 보존한다', async () => {
    const state = harness({
        books: [book(1), book(2)],
        state: { enabled: false, accountId: 'different-account', baseHash: 'other-account-hash' },
        missingVolsMap: { 1: [7], 2: [2], 3: [3], 4: [8] },
        pending: {
            key: 'google-sync-pending', revision: 11,
            previousMissingVolsMap: { 1: [1], 2: [2], 3: [3] },
            missingVolsMap: { 1: [4], 2: [5] },
            checkpoint: { accountId: 'account-1', baseHash: 'remote-hash', lastSyncedAt: 123 }
        }
    });
    await state.sync.initialize();
    assert.deepEqual(state.storage.missingVolsMap, { 1: [7], 2: [5], 4: [8] });
    assert.equal(state.storage.googleSyncState.accountId, 'different-account');
    assert.equal(state.storage.googleSyncState.baseHash, 'other-account-hash');
    assert.equal(state.pending, undefined);
});

test('서로 다른 확장 컨텍스트의 공유 잠금은 실패 후에도 다음 변경을 순서대로 실행한다', async () => {
    const locks = lockManager();
    const background = harness({ locks });
    const options = harness({ locks });
    const gate = deferred();
    const events = [];
    const first = background.withSyncLock(async () => {
        events.push('background-start');
        await gate.promise;
        events.push('background-end');
        throw new Error('simulated failure');
    });
    const failed = assert.rejects(first, /simulated failure/);
    const second = options.withSyncLock(async () => { events.push('options'); return 'saved'; });
    await waitUntil(() => events.length > 0);
    assert.deepEqual(events, ['background-start']);
    gate.resolve();
    await failed;
    assert.equal(await second, 'saved');
    assert.deepEqual(events, ['background-start', 'background-end', 'options']);
});

test('원격 DB와 누락 권수 저널 반영이 끝날 때까지 다른 화면의 복구를 잠근다', async () => {
    const state = harness({ remote: remoteFile([book(1, 'Google 목록', [3])]) });
    const writingMap = deferred();
    const releaseMap = deferred();
    state.hooks.storageSet = async values => {
        if (Object.hasOwn(values, 'missingVolsMap')) {
            writingMap.resolve();
            await releaseMap.promise;
        }
    };
    const syncing = state.sync.run({ connect: true });
    await writingMap.promise;
    let restored = false;
    const restoring = state.withSyncLock(async () => {
        assert.equal(state.pending, undefined);
        state.books = [book(2, '사용자 복구', [7])];
        state.storage.missingVolsMap = { 2: [7] };
        restored = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(restored, false);
    assert.equal(state.books[0].title, 'Google 목록');
    releaseMap.resolve();
    await Promise.all([syncing, restoring]);
    assert.deepEqual(state.books, [book(2, '사용자 복구', [7])]);
    assert.deepEqual(state.storage.missingVolsMap, { 2: [7] });
});

test('두 기기가 같은 버전을 동시에 수정하면 하나만 업로드하고 다른 기기의 목록은 충돌로 보존한다', async () => {
    const base = remoteFile([book(1, '공통 목록')]);
    const server = { file: clone(base) };
    const checkpoint = { enabled: true, accountId: 'account-1', baseHash: base.payload.hash, baseFileId: base.fileId };
    const first = harness({ server, books: [book(1, '첫 기기 수정')], state: checkpoint });
    const second = harness({ server, books: [book(1, '둘째 기기 수정')], state: checkpoint });
    const release = deferred();
    let waiting = 0;
    for (const device of [first, second]) device.hooks.write = async () => { waiting++; await release.promise; };
    const syncing = Promise.allSettled([first.sync.run(), second.sync.run()]);
    await waitUntil(() => waiting === 2);
    release.resolve();
    const results = await syncing;
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.name, 'GoogleSyncConflictError');
    assert.deepEqual(first.books, [book(1, '첫 기기 수정')]);
    assert.deepEqual(second.books, [book(1, '둘째 기기 수정')]);
    const winner = results[0].status === 'fulfilled' ? first : second;
    const loser = winner === first ? second : first;
    assert.deepEqual(server.file.payload.books, winner.books);
    assert.deepEqual(winner.remoteBackups[0].books, base.payload.books);
    await loser.sync.run();
    const conflict = (await loser.sync.status()).conflict;
    assert.equal(conflict.reason, 'both-changed');
    assert.equal(loser.applies.length, 0);
    assert.equal(loser.writes.length, 1);
    assert.equal(loser.storage.googleSyncState.baseHash, base.payload.hash);
    await loser.sync.run({ automaticTrigger: 'periodic' });
    assert.equal((await loser.sync.status()).conflict.token, conflict.token);
    assert.deepEqual(server.file.payload.books, winner.books);
});

test('오프라인 기기의 변경은 다른 기기의 최신 업로드와 충돌하며 기기 시각으로 덮어쓰지 않는다', async () => {
    const base = remoteFile([book(1, '공통 목록')]);
    const server = { file: clone(base) };
    const checkpoint = { enabled: true, accountId: 'account-1', baseHash: base.payload.hash };
    const online = harness({ server, books: [book(1, '온라인 수정')], state: checkpoint });
    const offline = harness({ server, books: [book(1, '오프라인 수정')], state: { ...checkpoint, lastSyncedAt: Date.now() + 86400000 } });
    await online.sync.run();
    await offline.sync.run();
    assert.equal((await offline.sync.status()).conflict.reason, 'both-changed');
    assert.deepEqual(server.file.payload.books, online.books);
    assert.equal(offline.writes.length, 0);
    assert.equal(offline.applies.length, 0);
});

test('도서 삭제는 일부 또는 전체 여부와 무관하게 양방향 모두 명시적 확인 후 적용한다', async t => {
    const original = [book(1), book(2, '두 번째')];
    for (const direction of ['upload', 'download']) {
        for (const kept of [[], [book(1)]]) {
            await t.test(`${direction}: ${kept.length}개 유지`, async () => {
                const base = remoteFile(original);
                const books = direction === 'upload' ? kept : original;
                const remote = direction === 'upload' ? base : remoteFile(kept, '"deleted"');
                const state = harness({ books, remote, state: { enabled: true, accountId: 'account-1', baseHash: base.payload.hash } });
                await state.sync.run();
                const conflict = (await state.sync.status()).conflict;
                assert.equal(conflict.reason, 'deletion');
                assert.equal(conflict.proposedDirection, direction);
                const change = direction === 'upload' ? conflict.localChanges : conflict.remoteChanges;
                assert.equal(change.removed, original.length - kept.length);
                assert.equal(state.writes.length, 0);
                assert.equal(state.applies.length, 0);
                await state.sync.run({ resolution: direction === 'upload' ? 'local' : 'remote', conflictToken: conflict.token });
                assert.deepEqual(state.books, kept);
                assert.deepEqual(state.remote.payload.books, kept);
            });
        }
    }
});

test('동일 건수의 과거 DB 복원도 확인하며 확인한 복원 이후의 일반 수정은 동기화한다', async () => {
    const base = remoteFile([{ ...book(), lastVol: '10' }]);
    const restored = [{ ...book(), lastVol: '3' }];
    const state = harness({
        books: restored, remote: base, replacement: { revision: 10 },
        state: { enabled: true, accountId: 'account-1', baseHash: base.payload.hash, reviewedLocalRevision: 4 }
    });
    await state.sync.run();
    const conflict = (await state.sync.status()).conflict;
    assert.equal(conflict.reason, 'local-restore');
    assert.deepEqual(clone(conflict.localChanges), { added: 0, updated: 1, removed: 0 });
    assert.equal(state.writes.length, 0);
    await state.sync.run({ resolution: 'local', conflictToken: conflict.token });
    assert.equal(state.storage.googleSyncState.reviewedLocalRevision, 10);
    assert.deepEqual(state.remoteBackups[0].books, base.payload.books);
    state.books[0].lastVol = '4';
    state.revision++;
    await state.sync.run();
    assert.equal(state.writes.length, 2);
    assert.equal(state.remote.payload.books[0].lastVol, '4');
    assert.equal((await state.sync.status()).conflict, null);
});

test('확인 중 한쪽이 기준 목록으로 돌아와도 남은 차이는 자동 적용하지 않는다', async t => {
    for (const reverted of ['local', 'remote']) {
        await t.test(reverted, async () => {
            const base = remoteFile([book()]);
            const state = harness({
                books: [book(1, '로컬 수정')], remote: remoteFile([book(1, '원격 수정')]),
                state: { enabled: true, accountId: 'account-1', baseHash: base.payload.hash }
            });
            await state.sync.run();
            const token = (await state.sync.status()).conflict.token;
            if (reverted === 'local') state.books = clone(base.payload.books);
            else state.remote = clone(base);
            await state.sync.run({ automaticTrigger: 'periodic' });
            assert.equal((await state.sync.status()).state, 'conflict');
            assert.notEqual((await state.sync.status()).conflict.token, token);
            assert.equal(state.writes.length, 0);
            assert.equal(state.applies.length, 0);
        });
    }
});

test('원격 파일이 삭제되면 빈 목록으로 내려받을 수 없고 명시적으로 다시 저장해야 한다', async () => {
    const base = remoteFile([book()]);
    const state = harness({ books: base.payload.books, state: { enabled: true, accountId: 'account-1', baseHash: base.payload.hash, baseFileId: base.fileId } });
    await state.sync.run();
    const conflict = (await state.sync.status()).conflict;
    assert.equal(conflict.reason, 'remote-missing');
    await assert.rejects(state.sync.run({ resolution: 'remote', conflictToken: conflict.token }), /파일이 없어/);
    assert.equal(state.writes.length, 0);
    assert.equal(state.applies.length, 0);
    assert.equal(state.storage.googleSyncState.baseHash, base.payload.hash);
    await state.sync.run({ resolution: 'local', conflictToken: conflict.token });
    assert.deepEqual(state.remote.payload.books, base.payload.books);
    assert.equal(state.storage.googleSyncState.baseFileId, state.remote.fileId);
});

test('같은 내용이어도 연결된 원격 파일이 다른 파일로 교체되면 확인한다', async () => {
    const base = remoteFile([book()]);
    const state = harness({ books: base.payload.books, remote: { ...base, fileId: 'new-db' }, state: {
        enabled: true, accountId: 'account-1', baseHash: base.payload.hash, baseFileId: base.fileId
    } });
    await state.sync.run();
    const conflict = (await state.sync.status()).conflict;
    assert.equal(conflict.reason, 'remote-replaced');
    assert.equal(state.applies.length, 0);
    await state.sync.run({ resolution: 'remote', conflictToken: conflict.token });
    assert.equal(state.storage.googleSyncState.baseFileId, 'new-db');
});

test('다운로드를 적용하기 직전 원격 버전이 바뀌면 로컬 목록을 유지한다', async () => {
    const base = remoteFile([book()]);
    const state = harness({ books: base.payload.books, remote: remoteFile([book(1, '원격 수정')]), state: {
        enabled: true, accountId: 'account-1', baseHash: base.payload.hash
    } });
    state.hooks.verify = async () => { state.remote = remoteFile([book(1, '더 최근 수정')], '"latest"'); };
    await assert.rejects(state.sync.run(), { name: 'GoogleSyncConflictError' });
    assert.deepEqual(state.books, base.payload.books);
    assert.equal(state.applies.length, 0);
    assert.equal(state.storage.googleSyncState.baseHash, base.payload.hash);
});

test('업로드 전 원격 복구본 저장 실패나 로컬 변경은 원격 덮어쓰기를 차단한다', async t => {
    for (const cause of ['backup-failure', 'local-edit', 'restore']) {
        await t.test(cause, async () => {
            const base = remoteFile([book()]);
            const state = harness({ books: [book(1, '로컬 수정')], remote: base, state: {
                enabled: true, accountId: 'account-1', baseHash: base.payload.hash
            } });
            state.hooks.backup = async () => {
                if (cause === 'backup-failure') throw new Error('복구본 저장 실패');
                if (cause === 'local-edit') state.books[0].title = '업로드 준비 중 수정';
                if (cause === 'restore') state.replacement = { revision: 11 };
            };
            await assert.rejects(state.sync.run());
            assert.deepEqual(state.remote, base);
            assert.equal(state.writes.length, 0);
            assert.equal(state.storage.googleSyncState.baseHash, base.payload.hash);
        });
    }
});

test('동일 내용의 재복원도 이전 충돌 선택으로 승인되지 않는다', async () => {
    const state = harness({ books: [book(1, '로컬 수정')], remote: remoteFile([book(1, '원격 수정')]) });
    await state.sync.run({ connect: true });
    const token = (await state.sync.status()).conflict.token;
    state.replacement = { revision: 11 };
    await state.sync.run({ resolution: 'local', conflictToken: token });
    const conflict = (await state.sync.status()).conflict;
    assert.notEqual(conflict.token, token);
    assert.equal(conflict.reason, 'local-restore');
    assert.equal(state.writes.length, 0);
});
