const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'google-drive.js'), 'utf8');
const file = { id: 'remote-file', etag: '"version-1"' };
const listed = { items: [{ id: file.id }] };
const accountData = { user: { permissionId: 'account-1', emailAddress: 'reader@example.com' } };

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(responses, settings = {}) {
    const calls = [];
    const authCalls = [];
    const removedTokens = [];
    const timeouts = [];
    const tokens = [...(settings.tokens || ['initial-token'])];
    const chrome = {
        runtime: {},
        identity: {
            getAuthToken: (options, callback) => {
                authCalls.push(options);
                if (settings.authFailure) chrome.runtime.lastError = { message: 'private error detail' };
                callback(tokens.shift());
                delete chrome.runtime.lastError;
            },
            removeCachedAuthToken: (options, callback) => {
                removedTokens.push(options.token);
                callback();
            }
        }
    };
    const context = vm.createContext({
        chrome,
        crypto,
        URLSearchParams,
        AbortController,
        setTimeout: (callback, delay) => {
            timeouts.push(delay);
            return setTimeout(callback, settings.immediateTimeout ? 0 : delay);
        },
        clearTimeout,
        fetch: async (url, options) => {
            calls.push({ url: new URL(url), options });
            assert.ok(responses.length, `Unexpected request: ${url}`);
            const response = responses.shift();
            return typeof response === 'function' ? response(url, options) : response;
        }
    });
    vm.runInContext(source, context);
    return { drive: context.GoogleBookDrive, calls, authCalls, removedTokens, timeouts, remaining: responses };
}

test('Google 연결만 인증 UI를 허용하고 Drive 앱 데이터 권한만 요청한다', async () => {
    const state = harness([json(accountData)]);
    const client = await state.drive.create(true);
    const account = await client.account();
    assert.equal(account.id, 'account-1');
    assert.equal(account.email, 'reader@example.com');
    assert.equal(state.authCalls[0].interactive, true);
    assert.deepEqual(Array.from(state.authCalls[0].scopes), ['https://www.googleapis.com/auth/drive.appdata']);
    assert.equal(state.calls[0].options.headers.Authorization, 'Bearer initial-token');
    assert.equal(state.calls[0].url.pathname, '/drive/v2/about');
    assert.equal(state.calls[0].url.searchParams.get('fields'), 'user(permissionId,emailAddress)');
    assert.equal(state.calls[0].options.redirect, 'error');
    assert.equal(state.calls[0].options.credentials, 'omit');
});

test('자동 인증 실패는 토큰이나 원래 인증 오류를 노출하지 않는다', async () => {
    const state = harness([], { authFailure: true });
    await assert.rejects(state.drive.create(), error => {
        assert.equal(error.name, 'GoogleSyncAuthError');
        assert.doesNotMatch(error.message, /private|initial-token/);
        return true;
    });
    assert.equal(state.authCalls[0].interactive, false);
    assert.equal(state.calls.length, 0);
});

test('401은 토큰 캐시를 지우고 비대화형으로 한 번만 재시도한다', async () => {
    const state = harness([json({}, 401), json(accountData)], { tokens: ['expired-token', { token: 'fresh-token' }] });
    const client = await state.drive.create(true);
    await client.account();
    assert.deepEqual(state.authCalls.map(call => call.interactive), [true, false]);
    assert.deepEqual(state.removedTokens, ['expired-token']);
    assert.deepEqual(state.calls.map(call => call.options.headers.Authorization), ['Bearer expired-token', 'Bearer fresh-token']);
});

test('반복된 401은 추가 로그인 또는 무한 재시도 없이 실패한다', async () => {
    const state = harness([json({}, 401), json({}, 401)], { tokens: ['old', 'new'] });
    const client = await state.drive.create();
    await assert.rejects(client.account(), { name: 'GoogleSyncAuthError' });
    assert.equal(state.calls.length, 2);
    assert.equal(state.authCalls.length, 2);
});

test('토큰 갱신 중 Google 계정이 바뀌면 요청을 재전송하지 않는다', async () => {
    const state = harness([
        json(accountData), json({}, 401), json({ user: { permissionId: 'different-account' } })
    ], { tokens: ['old', 'new'] });
    const client = await state.drive.create();
    await client.account();
    await assert.rejects(client.read(), { name: 'GoogleSyncAccountChangedError' });
    assert.equal(state.calls.length, 3);
    assert.equal(state.calls[2].url.pathname, '/drive/v2/about');
});

test('빈 첫 페이지에서도 다음 페이지를 확인하여 DB를 읽는다', async () => {
    const payload = { books: [{ title: '테스트' }] };
    const state = harness([
        json({ items: [], nextPageToken: 'page-two' }), json(listed), json(file), json(payload), json(file), json(listed)
    ]);
    const client = await state.drive.create();
    const remote = await client.read();
    assert.equal(remote.fileId, file.id);
    assert.equal(remote.etag, file.etag);
    assert.deepEqual(remote.payload, payload);
    assert.equal(state.calls[1].url.searchParams.get('pageToken'), 'page-two');
    assert.equal(state.calls[0].url.searchParams.get('spaces'), 'appDataFolder');
    assert.equal(state.calls[0].url.searchParams.get('q'), "title = 'book-manager-db-v1.json' and trashed = false");
    assert.ok(state.calls.every(call => call.options.cache === 'no-store'));
});

test('다운로드 도중 ETag가 변경되면 서로 다른 버전의 본문과 메타데이터를 반환하지 않는다', async () => {
    const state = harness([json(listed), json(file), json({ books: [] }), json({ ...file, etag: '"version-2"' })]);
    const client = await state.drive.create();
    await assert.rejects(client.read(), { name: 'GoogleSyncConflictError' });
});

test('반영 직전 재검사는 같은 파일 ID와 ETag를 GET 요청만으로 확인한다', async () => {
    const state = harness([json(listed), json(file)]);
    const client = await state.drive.create();
    await client.assertUnchanged({ fileId: file.id, etag: file.etag, payload: { books: [] } });
    assert.equal(state.remaining.length, 0);
    assert.equal(state.calls[0].url.pathname, '/drive/v2/files');
    assert.equal(state.calls[1].url.pathname, '/drive/v2/files/remote-file');
    assert.equal(state.calls[1].url.searchParams.get('fields'), 'id,etag');
    assert.ok(state.calls.every(call => !call.options.method || call.options.method === 'GET'));
    assert.ok(state.calls.every(call => call.options.body === undefined));
});

test('내용이 같아도 읽은 뒤 ETag가 바뀌면 반영 직전 재검사가 충돌한다', async () => {
    const payload = { books: [{ title: '같은 책' }] };
    const state = harness([
        json(listed), json(file), json(payload), json(file), json(listed),
        json(listed), json({ ...file, etag: '"version-2"' })
    ]);
    const client = await state.drive.create();
    const remote = await client.read();
    assert.deepEqual(remote.payload, payload);
    await assert.rejects(client.assertUnchanged(remote), { name: 'GoogleSyncConflictError' });
    assert.equal(state.remaining.length, 0);
    assert.ok(state.calls.every(call => !call.options.method || call.options.method === 'GET'));
});

test('반영 직전 파일이 삭제되거나 같은 이름의 다른 파일로 교체되면 중단한다', async t => {
    for (const [name, response] of [
        ['deleted', { items: [] }],
        ['replaced', { items: [{ id: 'replacement-file' }] }]
    ]) {
        await t.test(name, async () => {
            const state = harness([json(response)]);
            const client = await state.drive.create();
            await assert.rejects(client.assertUnchanged({ fileId: file.id, etag: file.etag }), { name: 'GoogleSyncConflictError' });
            assert.equal(state.calls.length, 1);
            assert.equal(state.calls[0].options.body, undefined);
        });
    }
});

test('재검사 목록 조회 뒤 메타데이터가 사라지거나 다른 파일을 가리키면 중단한다', async t => {
    for (const [name, response] of [
        ['deleted', json({}, 404)],
        ['wrong ID', json({ id: 'replacement-file', etag: file.etag })]
    ]) {
        await t.test(name, async () => {
            const state = harness([json(listed), response]);
            const client = await state.drive.create();
            await assert.rejects(client.assertUnchanged({ fileId: file.id, etag: file.etag }), { name: 'GoogleSyncConflictError' });
            assert.equal(state.calls.length, 2);
        });
    }
});

test('반영 직전 재검사는 뒤 페이지의 중복 DB도 발견하고 중단한다', async () => {
    const state = harness([
        json({ ...listed, nextPageToken: 'two' }), json({ items: [{ id: 'other-file' }] })
    ]);
    const client = await state.drive.create();
    await assert.rejects(client.assertUnchanged({ fileId: file.id, etag: file.etag }), { name: 'GoogleSyncDuplicateError' });
    assert.equal(state.calls.length, 2);
    assert.ok(state.calls.every(call => !call.options.method || call.options.method === 'GET'));
});

test('빈 Drive 재검사는 파일이 여전히 없을 때만 통과한다', async t => {
    await t.test('still missing', async () => {
        const state = harness([json({ items: [] })]);
        const client = await state.drive.create();
        await client.assertUnchanged(null);
        assert.equal(state.calls.length, 1);
        assert.equal(state.calls[0].options.body, undefined);
    });
    await t.test('created by another device', async () => {
        const state = harness([json({ items: [] }), json(listed)]);
        const client = await state.drive.create();
        const remote = await client.read();
        assert.equal(remote, null);
        await assert.rejects(client.assertUnchanged(remote), { name: 'GoogleSyncConflictError' });
        assert.equal(state.calls.length, 2);
        assert.ok(state.calls.every(call => !call.options.method || call.options.method === 'GET'));
    });
});

test('반영 직전 재검사는 유효한 파일 ID와 강한 ETag가 없으면 요청하지 않는다', async () => {
    for (const remote of [
        undefined,
        {},
        { fileId: '../remote-file', etag: file.etag },
        { fileId: file.id },
        { fileId: file.id, etag: 'W/"version-1"' },
        { fileId: file.id, etag: '*' }
    ]) {
        const state = harness([]);
        const client = await state.drive.create();
        await assert.rejects(client.assertUnchanged(remote), { name: 'GoogleSyncError' });
        assert.equal(state.calls.length, 0);
    }
});

test('페이지 사이에 중복 DB가 있으면 어떤 DB도 선택하지 않는다', async () => {
    const state = harness([
        json({ ...listed, nextPageToken: 'two' }), json({ items: [{ id: 'other-file' }] })
    ]);
    const client = await state.drive.create();
    await assert.rejects(client.read(), { name: 'GoogleSyncDuplicateError' });
    assert.equal(state.calls.length, 2);
});

test('다운로드 후 중복 DB를 발견하면 읽은 본문도 반환하지 않는다', async () => {
    const state = harness([
        json(listed), json(file), json({ books: [] }), json(file),
        json({ items: [{ id: file.id }, { id: 'other-file' }] })
    ]);
    const client = await state.drive.create();
    await assert.rejects(client.read(), { name: 'GoogleSyncDuplicateError' });
});

test('잘못된 파일 목록 응답은 빈 Google Drive로 취급하지 않는다', async () => {
    for (const data of [null, [], 42, 'invalid', { items: null }]) {
        const state = harness([json(data)]);
        const client = await state.drive.create();
        await assert.rejects(client.write({ books: [] }, null), /목록을 끝까지/);
        assert.equal(state.calls.length, 1);
    }
});

test('불완전하거나 순환하는 파일 목록을 빈 DB로 판단하지 않는다', async t => {
    await t.test('incompleteSearch', async () => {
        const state = harness([json({ items: [], incompleteSearch: true })]);
        const client = await state.drive.create();
        await assert.rejects(client.read(), /목록을 끝까지/);
    });
    await t.test('repeated page token', async () => {
        const state = harness([json({ nextPageToken: 'loop' }), json({ nextPageToken: 'loop' })]);
        const client = await state.drive.create();
        await assert.rejects(client.read(), /목록을 끝까지/);
        assert.equal(state.calls.length, 2);
    });
});

test('기존 DB 업로드는 읽은 ETag를 If-Match로 전달한다', async () => {
    const payload = { books: [{ title: '새 책' }] };
    const updated = { ...file, etag: '"version-2"' };
    const state = harness([json(listed), json(updated)]);
    const client = await state.drive.create();
    const remote = await client.write(payload, { fileId: file.id, etag: file.etag });
    const upload = state.calls[1];
    assert.equal(upload.options.method, 'PUT');
    assert.equal(upload.url.pathname, '/upload/drive/v2/files/remote-file');
    assert.equal(upload.url.searchParams.get('uploadType'), 'media');
    assert.equal(upload.options.headers['If-Match'], file.etag);
    assert.deepEqual(JSON.parse(upload.options.body), payload);
    assert.equal(remote.etag, updated.etag);
});

test('412 충돌은 조건 없는 덮어쓰기 재시도로 이어지지 않는다', async () => {
    const state = harness([json(listed), json({}, 412)]);
    const client = await state.drive.create();
    await assert.rejects(client.write({ books: [] }, { fileId: file.id, etag: file.etag }), { name: 'GoogleSyncConflictError' });
    assert.equal(state.calls.length, 2);
});

test('ETag가 없거나 약한 ETag이면 네트워크 쓰기를 시작하지 않는다', async () => {
    for (const etag of [undefined, '', 'W/"version-1"', '*', '"one"\r\nOther: value']) {
        const state = harness([]);
        const client = await state.drive.create();
        await assert.rejects(client.write({ books: [] }, { fileId: file.id, etag }), /파일 버전을 확인/);
        assert.equal(state.calls.length, 0);
    }
});

test('최초 업로드 전에 다른 기기가 DB를 생성했으면 새 파일을 만들지 않는다', async () => {
    const state = harness([json(listed)]);
    const client = await state.drive.create();
    await assert.rejects(client.write({ books: [] }, null), { name: 'GoogleSyncConflictError' });
    assert.equal(state.calls.length, 1);
});

test('최초 업로드는 appDataFolder에 multipart로 저장하고 이름의 유일성을 재검사한다', async () => {
    const payload = { books: [{ title: '책' }] };
    const state = harness([json({ items: [] }), json(file), json(listed)]);
    const client = await state.drive.create();
    const remote = await client.write(payload, null);
    assert.equal(remote.fileId, file.id);
    const upload = state.calls[1];
    assert.equal(upload.options.method, 'POST');
    assert.equal(upload.url.searchParams.get('uploadType'), 'multipart');
    assert.match(upload.options.headers['Content-Type'], /^multipart\/related; boundary=book_manager_/);
    assert.match(upload.options.body, /"parents":\[\{"id":"appDataFolder"\}\]/);
    assert.match(upload.options.body, /"title":"book-manager-db-v1.json"/);
    assert.ok(upload.options.body.includes(JSON.stringify(payload)));
    assert.equal(state.calls[2].url.pathname, '/drive/v2/files');
});

test('동시 최초 업로드로 중복 파일이 생기면 성공 처리하거나 임의로 삭제하지 않는다', async () => {
    const state = harness([
        json({ items: [] }), json(file), json({ items: [{ id: file.id }, { id: 'other-file' }] })
    ]);
    const client = await state.drive.create();
    await assert.rejects(client.write({ books: [] }, null), { name: 'GoogleSyncDuplicateError' });
    assert.equal(state.calls.length, 3);
    assert.ok(state.calls.every(call => call.options.method !== 'DELETE'));
});

test('HTTP 오류의 원문과 토큰을 오류 메시지에 노출하지 않는다', async () => {
    const state = harness([json({ message: 'server secret initial-token' }, 403)]);
    const client = await state.drive.create();
    await assert.rejects(client.read(), error => {
        assert.equal(error.status, 403);
        assert.doesNotMatch(error.message, /secret|initial-token/);
        assert.ok(error.message.length < 200);
        return true;
    });
});

test('요청이 멈추면 25초 이내의 타이머로 중단한다', async () => {
    const state = harness([
        (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('private network detail')));
        })
    ], { immediateTimeout: true });
    const client = await state.drive.create();
    await assert.rejects(client.read(), /요청 시간이 초과/);
    assert.equal(state.timeouts[0], 25000);
    assert.equal(state.calls[0].options.signal.aborted, true);
});

test('잘못된 JSON 다운로드는 동기화 데이터로 반환하지 않는다', async () => {
    const state = harness([json(listed), json(file), new Response('not valid JSON')]);
    const client = await state.drive.create();
    await assert.rejects(client.read(), /DB 파일을 읽을 수 없습니다/);
});
