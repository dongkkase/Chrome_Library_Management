const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const commonSource = fs.readFileSync(path.join(root, 'common.js'), 'utf8');

function section(startText, endText) {
    const start = optionsSource.indexOf(startText);
    const end = optionsSource.indexOf(endText, start);
    assert.ok(start >= 0 && end > start);
    return optionsSource.slice(start, end);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

const book = { id: 1, title: '별빛 도서관', categoryId: 'comic', type: 'incomplete', lastVol: '1' };

function createHarness(overrides = {}) {
    const state = { starts: 0, finishes: 0, messages: [] };
    const elements = {
        saveBtn: { disabled: false },
        bulkInput: { value: '별빛 도서관 3권', addEventListener() {} },
        bulkPreview: { style: { display: 'block' } },
        bulkTypeSelect: { value: 'complete' },
        bulkCategorySelect: { value: 'comic' },
        batchUpdateBtn: { disabled: false },
        batchTypeSelect: { value: 'complete' },
        batchCategorySelect: { value: 'unchanged' }
    };
    const context = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
    vm.runInContext(commonSource, context);
    Object.assign(context, {
        ButtonUI: {
            start(button) {
                if (button.disabled) return null;
                button.disabled = true;
                state.starts++;
                return () => { button.disabled = false; state.finishes++; };
            }
        },
        document: { body: {}, getElementById: id => elements[id] },
        bulkInput: elements.bulkInput,
        bulkPreview: elements.bulkPreview,
        bookCategoryFilter: 'all',
        getCurrentBookFilter: () => '',
        setTimeout: callback => callback(),
        ensureBookStoreReady: async () => {},
        bookStoreGet: async () => book,
        bookStoreGetAllWithRevision: async () => ({ bookList: [book], revision: 5 }),
        storageLocalGet: async () => ({ missingVolsMap: {} }),
        storageLocalSet: async () => {},
        showInfoToast: message => state.messages.push(message),
        confirm: () => true,
        ...overrides
    });
    vm.runInContext(section('function getBookCategoryOptionsHtml(', 'let renderListGeneration ='), context);
    return { state, elements, context };
}

function createRowClick(className) {
    const fields = {
        '.edit-title': { value: '수정한 제목' },
        '.edit-type': { value: 'complete' },
        '.edit-category': { value: 'epub' },
        '.edit-res': { value: '1500px' },
        '.edit-vol': { value: '3' },
        '.edit-folder-rule': { value: '소설' }
    };
    const row = { querySelector: selector => fields[selector] };
    const button = {
        disabled: false,
        dataset: { id: '1' },
        classList: { contains: name => name === className },
        closest: selector => selector === 'tr' ? row : null
    };
    const icon = { closest: selector => selector.includes(`button.${className}`) ? button : null };
    return { button, event: { target: icon } };
}

for (const [className, operation] of [['btn-save', 'saveSingleBookWithUndo'], ['btn-del', 'deleteSingleBookWithUndo']]) {
    test(`${className} 아이콘 클릭은 부모 버튼을 찾고 작업 완료까지 재실행을 막는다`, async () => {
        const pending = deferred();
        const entered = deferred();
        const calls = [];
        const fixture = createHarness({
            [operation]: async (...args) => { calls.push(args); entered.resolve(); await pending.promise; }
        });
        vm.runInContext(section('document.body.onclick =', 'async function loadReleaseHistory('), fixture.context);
        const { button, event } = createRowClick(className);
        const running = fixture.context.document.body.onclick(event);
        assert.equal(button.disabled, true);
        await entered.promise;
        await fixture.context.document.body.onclick(event);
        assert.equal(calls.length, 1);
        assert.equal(fixture.state.starts, 1);
        assert.equal(fixture.state.finishes, 0);
        if (className === 'btn-save') {
            assert.equal(calls[0][0].title, '수정한 제목');
            assert.equal(calls[0][0].categoryId, 'epub');
            assert.equal(calls[0][0].lastVol, '3');
        } else {
            assert.equal(calls[0][0], book);
        }
        pending.resolve();
        await running;
        assert.equal(button.disabled, false);
        assert.equal(fixture.state.finishes, 1);
    });
}

test('행 작업 실패 후 버튼을 복원하여 같은 아이콘으로 다시 시도할 수 있다', async () => {
    let calls = 0;
    const fixture = createHarness({
        saveSingleBookWithUndo: async () => {
            calls++;
            if (calls === 1) throw new Error('write failed');
        }
    });
    vm.runInContext(section('document.body.onclick =', 'async function loadReleaseHistory('), fixture.context);
    const { button, event } = createRowClick('btn-save');
    await fixture.context.document.body.onclick(event);
    assert.equal(button.disabled, false);
    assert.equal(fixture.state.finishes, 1);
    assert.equal(fixture.state.messages.length, 1);
    await fixture.context.document.body.onclick(event);
    assert.equal(calls, 2);
    assert.equal(button.disabled, false);
    assert.equal(fixture.state.finishes, 2);
});

test('검색 결과 일괄 변경은 저장 Promise가 끝날 때까지 버튼과 중복 실행 방지를 유지한다', async () => {
    const pending = deferred();
    const entered = deferred();
    let saves = 0;
    const fixture = createHarness({
        saveWithUndo: async saved => {
            saves++;
            assert.equal(saved[0].type, 'complete');
            entered.resolve();
            await pending.promise;
        }
    });
    vm.runInContext(section("document.getElementById('batchUpdateBtn').onclick =", '// ============================================================================'), fixture.context);
    const button = fixture.elements.batchUpdateBtn;
    let settled = false;
    const running = button.onclick().then(() => { settled = true; });
    await entered.promise;
    await button.onclick();
    assert.equal(button.disabled, true);
    assert.equal(settled, false);
    assert.equal(saves, 1);
    pending.resolve();
    await running;
    assert.equal(button.disabled, false);
    assert.equal(fixture.state.finishes, 1);
});

test('일괄 등록은 타입 설정 저장과 도서 저장을 모두 기다린 뒤 버튼과 입력란을 복원한다', async () => {
    const settingsPending = deferred();
    const settingsEntered = deferred();
    const savePending = deferred();
    const saveEntered = deferred();
    let writes = 0;
    let saves = 0;
    const fixture = createHarness({
        storageLocalSet: async values => {
            writes++;
            assert.equal(values.lastBulkType, 'complete');
            settingsEntered.resolve();
            await settingsPending.promise;
        },
        saveWithUndo: async saved => {
            saves++;
            assert.equal(saved[0].lastVol, '3');
            saveEntered.resolve();
            await savePending.promise;
        }
    });
    vm.runInContext(section("bulkInput.addEventListener('input'", 'document.body.onclick ='), fixture.context);
    const button = fixture.elements.saveBtn;
    let settled = false;
    const running = button.onclick().then(() => { settled = true; });
    await settingsEntered.promise;
    await button.onclick();
    assert.equal(writes, 1);
    assert.equal(saves, 0);
    assert.equal(button.disabled, true);
    assert.equal(settled, false);
    settingsPending.resolve();
    await saveEntered.promise;
    await button.onclick();
    assert.equal(saves, 1);
    assert.equal(button.disabled, true);
    assert.equal(settled, false);
    assert.notEqual(fixture.elements.bulkInput.value, '');
    savePending.resolve();
    await running;
    assert.equal(button.disabled, false);
    assert.equal(fixture.elements.bulkInput.value, '');
    assert.equal(fixture.elements.bulkPreview.style.display, 'none');
    assert.equal(fixture.state.finishes, 1);
});
