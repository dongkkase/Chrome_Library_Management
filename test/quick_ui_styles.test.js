const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
function section(startText, endText) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start, `${startText} 코드 구간이 있어야 한다.`);
    return source.slice(start, end);
}
const handlerSource = section('async function ensureQuickUiStyles(sender)', 'async function performRidiSearch(');
const errorSource = section('function getBookStoreErrorMessage(error)', 'async function handleMissingVolUpdate(');
const contentSource = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const contentStart = contentSource.indexOf('let quickUIStylesRequested = false;');
const contentEnd = contentSource.indexOf('function loadBookListWithLegacyFallback(', contentStart);
assert.ok(contentStart >= 0 && contentEnd > contentStart, '콘텐츠 스타일 요청 helper가 있어야 한다.');

function createContentHarness() {
    const calls = [];
    const ensure = vm.runInNewContext(`${contentSource.slice(contentStart, contentEnd)}\nensureQuickUIStyles;`, {
        requestRuntimeResponse(message, respond) {
            calls.push({ message: JSON.parse(JSON.stringify(message)), respond });
            return true;
        }
    });
    return { calls, ensure };
}

function createHarness(inject = () => Promise.resolve()) {
    const calls = [];
    let listener;
    vm.runInNewContext(`${errorSource}\n${handlerSource}`, {
        chrome: {
            runtime: { onMessage: { addListener(callback) { listener = callback; } } },
            scripting: {
                insertCSS(options) {
                    calls.push(JSON.parse(JSON.stringify(options)));
                    return inject(options);
                }
            }
        }
    });
    return {
        calls,
        dispatch(sender, extraMessage = {}) {
            let resolve;
            const result = { responseCount: 0 };
            result.response = new Promise(done => { resolve = done; });
            result.keepAlive = listener({ action: 'ENSURE_QUICK_UI_STYLES', ...extraMessage }, sender, response => {
                result.responseCount++;
                resolve(JSON.parse(JSON.stringify(response)));
            });
            return result;
        }
    };
}

test('송신 문서를 우선 대상으로 삼아 고정 파일만 USER origin으로 주입하고 완료 후 응답한다', async () => {
    let finish;
    const fixture = createHarness(() => new Promise(resolve => { finish = resolve; }));
    const request = fixture.dispatch({ tab: { id: 42 }, frameId: 7, documentId: 'sender-document' }, {
        target: { tabId: 999, allFrames: true },
        files: ['untrusted.css'],
        css: 'body { display:none }',
        origin: 'AUTHOR'
    });
    assert.equal(request.keepAlive, true);
    assert.equal(request.responseCount, 0);
    assert.deepEqual(fixture.calls, [{
        target: { tabId: 42, documentIds: ['sender-document'] },
        files: ['book-ui.css', 'category-ui.css'],
        origin: 'USER'
    }]);
    finish();
    assert.deepEqual(await request.response, { ok: true });
    assert.equal(request.responseCount, 1);
});

test('documentId가 없으면 송신 frame을 사용하며 frame 정보가 없거나 잘못되면 최상위 frame을 사용한다', async () => {
    for (const [frameId, expectedFrame] of [[5, 5], [undefined, 0], [-1, 0], ['5', 0]]) {
        const fixture = createHarness();
        const request = fixture.dispatch({ tab: { id: 0 }, frameId, documentId: '' });
        assert.equal(request.keepAlive, true);
        assert.deepEqual(await request.response, { ok: true });
        assert.deepEqual(fixture.calls[0].target, { tabId: 0, frameIds: [expectedFrame] });
    }
});

test('주입 실패와 탭 없는 요청은 오류 응답하고 유효하지 않은 요청에서 CSS를 주입하지 않는다', async () => {
    const failure = createHarness(() => Promise.reject(new Error('document no longer exists')));
    const failed = failure.dispatch({ tab: { id: 8 }, documentId: 'expired-document' });
    assert.equal(failed.keepAlive, true);
    assert.deepEqual(await failed.response, { ok: false, error: 'document no longer exists' });
    assert.equal(failed.responseCount, 1);
    assert.equal(failure.calls.length, 1, '문서가 바뀌었을 때 다른 frame으로 재시도하지 않는다.');

    for (const sender of [undefined, {}, { tab: {} }, { tab: { id: -1 } }, { tab: { id: '8' } }]) {
        const fixture = createHarness();
        const request = fixture.dispatch(sender);
        assert.equal(request.keepAlive, true);
        const response = await request.response;
        assert.equal(response.ok, false);
        assert.match(response.error, /탭/);
        assert.equal(request.responseCount, 1);
        assert.equal(fixture.calls.length, 0);
    }
});

test('여러 퀵 메뉴가 생성되어도 스타일 요청이 진행 중이면 한 번만 요청한다', () => {
    const { calls, ensure } = createContentHarness();
    ensure();
    ensure();
    ensure();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].message, { action: 'ENSURE_QUICK_UI_STYLES' });
});

test('스타일 적용 성공 후 추가 메뉴 생성에서도 다시 주입하지 않는다', () => {
    const { calls, ensure } = createContentHarness();
    ensure();
    calls[0].respond({ ok: true });
    ensure();
    ensure();
    assert.equal(calls.length, 1);
});

test('스타일 요청 실패나 응답 없음은 다음 메뉴 생성 시 재시도를 허용한다', () => {
    for (const response of [{ ok: false, error: 'failed' }, null, undefined]) {
        const { calls, ensure } = createContentHarness();
        ensure();
        calls[0].respond(response);
        ensure();
        assert.equal(calls.length, 2);
        ensure();
        assert.equal(calls.length, 2, '재시도 진행 중에도 중복 주입하지 않는다.');
        calls[1].respond({ ok: true });
        ensure();
        assert.equal(calls.length, 2);
    }
});
