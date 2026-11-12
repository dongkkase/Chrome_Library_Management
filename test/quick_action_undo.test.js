const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.join(__dirname, '..');
const browserPath = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(candidate => candidate && fs.existsSync(candidate));

function extractFunction(file, name) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.notEqual(start, -1, name);
    const bodyStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = bodyStart; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(name);
}

test('퀵메뉴 되돌리기는 실제 IndexedDB와 토스트 버튼에서 동작한다', {
    skip: !browserPath && 'CHROME_BIN에 Chromium 실행 파일을 지정하세요.'
}, async t => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'quick-action-undo-'));
    let browser;
    let socket;
    t.after(async () => {
        socket?.close();
        if (browser && browser.exitCode === null) {
            const closed = once(browser, 'exit');
            browser.kill();
            await closed;
        }
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const backgroundFunctions = ['enqueueBookMutation', 'getBookStoreErrorMessage', 'handleQuickAction',
        'handleQuickActionUndo', 'processSaveQueue', 'deleteBookByMatchKey', 'sanitizeBookTitleForStorage'];
    const script = `
        const state = { storage: {}, messages: [], failRead: false };
        const chrome = {
            storage: {
                local: {
                    async get(defaults, callback) {
                        if (state.failRead) throw new Error('storage read failed');
                        const value = structuredClone({ ...defaults, ...state.storage });
                        if (callback) callback(value);
                        return value;
                    },
                    async set(patch) { Object.assign(state.storage, structuredClone(patch)); }
                },
                onChanged: { addListener() {} }
            }
        };
        ${fs.readFileSync(path.join(root, 'common.js'), 'utf8')}
        ${fs.readFileSync(path.join(root, 'db.js'), 'utf8')}
        let bookMutationQueue = Promise.resolve();
        const sendTabMessage = (tabId, message) => state.messages.push({ tabId, ...message });
        ${backgroundFunctions.map(name => extractFunction('background.js', name)).join('\n')}
        const ui = (() => {
            const timers = new Map(), requests = [], errors = [], motions = [];
            let timerId = 0;
            const setTimeout = (callback, duration) => { timers.set(++timerId, { callback, duration }); return timerId; };
            const clearTimeout = id => timers.delete(id);
            const LibraryMotion = {
                reveal: async () => { motions.push('reveal'); },
                conceal: async () => { motions.push('conceal'); },
                feedback: async () => { motions.push('feedback'); }
            };
            const requestRuntimeResponse = (message, callback) => requests.push({ message, callback });
            const showInfoToast = (message, isError) => errors.push({ message, isError });
            ${['showActionToast', 'escapeToastText', 'showToast'].map(name => extractFunction('content.js', name)).join('\n')}
            return { showToast, showActionToast, timers, requests, errors, motions,
                reset() { timers.clear(); requests.length = errors.length = motions.length = 0; document.body.replaceChildren(); }
            };
        })();
        ${runUndoTests.toString()}
        globalThis.undoTestResults = runUndoTests();
    `;
    fs.writeFileSync(path.join(directory, 'test.js'), script);
    const url = name => pathToFileURL(path.join(root, name)).href;
    const page = path.join(directory, 'test.html');
    fs.writeFileSync(page, `<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="${url('book-ui.css')}"><body><script>window.addEventListener('error', event => { document.body.textContent = event.error?.stack || event.message; });</script><script src="${url('dexie.min.js')}"></script><script src="test.js"></script></body></html>`);
    const profile = path.join(directory, 'profile');
    browser = spawn(browserPath, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-extensions',
        `--user-data-dir=${profile}`, '--remote-debugging-port=0', pathToFileURL(page).href
    ], { stdio: 'ignore', windowsHide: true });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let attempt = 0; !fs.existsSync(portFile) && attempt < 100; attempt++) await delay(100);
    assert.ok(fs.existsSync(portFile), '브라우저 디버깅 포트가 열리지 않았습니다.');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    let requestId = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        pending.get(message.id)?.(message);
        pending.delete(message.id);
    });
    const evaluate = expression => new Promise(resolve => {
        const id = ++requestId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    for (let attempt = 0; attempt < 100; attempt++) {
        const ready = await evaluate('typeof globalThis.undoTestResults !== "undefined"');
        if (ready.result?.result?.value) break;
        await delay(100);
    }
    const response = await Promise.race([
        evaluate('globalThis.undoTestResults'),
        delay(20000, null, { ref: false }).then(() => { throw new Error('브라우저 테스트 시간 초과'); })
    ]);
    assert.ok(!response.result?.exceptionDetails, JSON.stringify(response));
    const results = response.result?.result?.value;
    assert.ok(Array.isArray(results), JSON.stringify(response));
    assert.equal(results.length, 15);
    for (const result of results) await t.test(result.name, () => assert.equal(result.ok, true, result.error));
});

async function runUndoTests() {
    const results = [];
    const sender = { tab: { id: 7 } };
    const original = {
        id: 42, title: '테스트 작품', type: 'incomplete', categoryId: 'comic',
        lastVol: '8', resolution: '1500px', missingVols: [1],
        date: '2026-01-01T00:00:00.000Z', folderRule: '원본 폴더', custom: { note: '보존' }
    };
    const assert = (value, message = '조건이 일치하지 않습니다.') => { if (!value) throw new Error(message); };
    const equal = (actual, expected) => assert(JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify({ actual, expected }));
    async function rejects(run, pattern) {
        try { await run(); } catch (error) { assert(pattern.test(error.message), error.message); return; }
        throw new Error('실패해야 하는 작업이 성공했습니다.');
    }
    async function reset() {
        await ensureBookStoreReady();
        await db.books.clear();
        await db.meta.delete(BOOK_STORE_QUICK_UNDO_META_KEY);
        state.storage.missingVolsMap = { 42: [2, 5], 99: [3] };
        state.messages = [];
        state.failRead = false;
        ui.reset();
        await bookStorePut(original);
    }
    async function check(name, run) {
        try { await reset(); await run(); results.push({ name, ok: true }); }
        catch (error) { state.failRead = false; results.push({ name, ok: false, error: error.stack }); }
    }
    async function action(type, overrides = {}) {
        const result = await handleQuickAction({
            type, cleanTitle: original.title, bookId: original.id, categoryId: original.categoryId,
            lastVol: '12', resolution: '2400px', ...overrides
        }, sender);
        assert(result.ok, result.error);
        const message = state.messages.at(-1);
        assert(message.undoToken, '토스트에 복원 토큰이 없습니다.');
        return message;
    }
    const undo = message => handleQuickActionUndo({ undoToken: message.undoToken }, sender);

    for (const type of ['exclude', 'incomplete', 'complete']) {
        await check(`${type}: 상태·권수·해상도·누락·분류·날짜·추가 필드를 복원한다`, async () => {
            const message = await action(type);
            const saved = await bookStoreGet(42);
            assert(saved.type === type && saved.lastVol === '12' && saved.resolution === '2400px');
            await undo(message);
            equal(await bookStoreGet(42), original);
            equal(state.storage.missingVolsMap, { 42: [2, 5], 99: [3] });
            assert(state.storage.bookStoreChange.reason === 'quick-action-undo');
            assert(state.storage.bookStoreChange.type === 'upsert');
            assert(!('_quickUndoToken' in state.storage.bookStoreChange.book));
        });
    }
    await check('삭제를 원래 ID와 전체 도서 데이터로 복원한다', async () => {
        const message = await action('delete');
        assert(message.isDelete && !(await bookStoreGet(42)));
        await undo(message);
        equal(await bookStoreGet(42), original);
        equal(getBookMissingVols(await bookStoreGet(42), state.storage.missingVolsMap), [2, 5]);
    });
    await check('새 등록은 해당 항목만 제거하고 다른 분류는 보존한다', async () => {
        const message = await action('complete', { bookId: null, categoryId: 'epub' });
        assert(message.book.id !== 42);
        await undo(message);
        assert(!(await bookStoreGet(message.book.id)));
        equal(await bookStoreGet(42), original);
        assert(state.storage.bookStoreChange.type === 'delete');
    });
    await check('연속 작업은 최신 작업부터 되돌릴 수 있다', async () => {
        const first = await action('complete');
        const second = await action('exclude');
        await rejects(() => undo(first), /이후에 변경/);
        await undo(second);
        await undo(first);
        equal(await bookStoreGet(42), original);
    });
    await check('다른 도서 변경은 유지하며 복원 토큰은 한 번만 사용한다', async () => {
        const message = await action('exclude');
        await bookStorePut({ id: 99, title: '다른 도서', type: 'complete' });
        await rejects(() => handleQuickActionUndo({ undoToken: message.undoToken }, { tab: { id: 8 } }), /되돌릴 작업/);
        await undo(message);
        await rejects(() => undo(message), /되돌릴 작업/);
        assert((await bookStoreGet(99)).type === 'complete');
    });
    await check('누락 권수를 나중에 수정하면 오래된 복원이 덮어쓰지 않는다', async () => {
        const message = await action('complete');
        state.storage.missingVolsMap[42] = [5];
        await rejects(() => undo(message), /이후에 변경/);
        equal(state.storage.missingVolsMap[42], [5]);
        assert((await bookStoreGet(42)).type === 'complete');
    });
    await check('삭제 전부터 있던 동명 항목은 보존하며 삭제를 복원한다', async () => {
        await bookStorePut({ ...original, id: 43 });
        const message = await action('delete');
        await undo(message);
        equal(await bookStoreGet(42), original);
        assert(await bookStoreGet(43));
    });
    await check('삭제 후 같은 분류에 새로 등록한 항목을 중복 복원하지 않는다', async () => {
        const message = await action('delete');
        await bookStorePut({ ...original, id: 43 });
        await rejects(() => undo(message), /다시 등록/);
        assert(!(await bookStoreGet(42)));
        assert(await bookStoreGet(43));
    });
    await check('복원 정보 저장 실패는 실제 DB 변경도 롤백한다', async () => {
        state.failRead = true;
        const result = await handleQuickAction({ type: 'delete', bookId: 42, categoryId: 'comic', cleanTitle: original.title }, sender);
        state.failRead = false;
        assert(!result.ok);
        equal(await bookStoreGet(42), original);
        assert(!state.messages.some(message => message.action === 'SHOW_TOAST'));
    });
    await check('DB 연결을 다시 열어도 복원 정보가 유지된다', async () => {
        const message = await action('complete');
        db.close();
        await db.open();
        await undo(message);
        equal(await bookStoreGet(42), original);
    });
    await check('토스트 우측 버튼은 중복 클릭을 막고 성공 후 사라진다', async () => {
        const message = await action('complete');
        ui.showToast(message.book, false, message.undoToken);
        const toast = document.querySelector('.bm-action-toast');
        const button = toast.querySelector('button');
        assert(button.textContent === '되돌리기' && button.type === 'button');
        assert(button.getBoundingClientRect().left >= toast.firstElementChild.getBoundingClientRect().right);
        assert(getComputedStyle(toast).pointerEvents === 'auto');
        button.click();
        button.click();
        assert(button.disabled && ui.requests.length === 1 && ui.timers.size === 0);
        equal(ui.requests[0].message, { action: 'UNDO_QUICK_ACTION', undoToken: message.undoToken });
        ui.requests[0].callback(await undo(message));
        await Promise.resolve();
        assert(!toast.isConnected);
        equal(await bookStoreGet(42), original);
    });
    await check('마우스와 키보드 접근 중 타이머를 멈추며 실패 시 다시 누를 수 있다', async () => {
        ui.showToast(original, false, 'test-token');
        const toast = document.querySelector('.bm-action-toast');
        const button = toast.querySelector('button');
        assert([...ui.timers.values()][0].duration === 8000);
        toast.dispatchEvent(new MouseEvent('mouseenter'));
        assert(ui.timers.size === 0);
        toast.dispatchEvent(new MouseEvent('mouseleave'));
        assert(ui.timers.size === 1);
        button.focus();
        assert(ui.timers.size === 0);
        button.click();
        ui.requests[0].callback({ ok: false, error: '<img src=x onerror=alert(1)>' });
        assert(!button.disabled && toast.isConnected);
        assert(ui.errors[0].isError && !ui.errors[0].message.includes('<img'));
        assert(ui.motions.includes('feedback'));
    });
    await check('일반 토스트에는 버튼이 없고 긴 제목도 화면을 벗어나지 않는다', async () => {
        ui.showToast({ ...original, title: '<img src=x>' + '긴제목'.repeat(250) }, false, 'token');
        const toast = document.querySelector('.bm-action-toast');
        assert(!toast.querySelector('img'));
        assert(toast.getBoundingClientRect().width <= window.innerWidth - 32);
        ui.showActionToast('복사 완료');
        assert(!document.querySelector('.bm-action-toast:last-child button'));
    });
    return results;
}
