const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const commonSource = fs.readFileSync(path.join(root, 'common.js'), 'utf8');
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');

function section(startText, endText) {
    const start = optionsSource.indexOf(startText);
    const end = optionsSource.indexOf(endText, start);
    assert.ok(start >= 0 && end > start);
    return optionsSource.slice(start, end);
}

function createContext() {
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        ButtonUI: {
            start(button) {
                if (button.disabled) return null;
                button.disabled = true;
                return () => { button.disabled = false; };
            }
        }
    });
    vm.runInContext(commonSource, context);
    vm.runInContext(section('function getBookCategoryOptionsHtml(', 'let renderListGeneration ='), context);
    return context;
}

const books = [
    { id: 1, title: '별빛 도서관', categoryId: 'comic', type: 'incomplete', folderRule: '만화/연재', missingVols: [2] },
    { id: 2, title: '별빛 도서관', categoryId: 'epub', type: 'complete', folderRule: '도서/연재', missingVols: [] },
    { id: 3, title: '별빛 도서관', type: 'exclude', missingVols: [1] },
    { id: 4, title: '별빛도서관', categoryId: 'comic', type: 'complete', folderRule: '만화/완결', missingVols: [] },
    { id: 5, title: '다른 작품', categoryId: 'comic', type: 'exclude', missingVols: [] }
];
const ids = values => Array.from(values, value => value.id);

test('분류 필터는 제목 검색과 결합하고 구버전 항목은 미분류로 조회한다', () => {
    const api = createContext();
    assert.deepEqual(ids(api.getFilteredBookList(books, '별빛 도서관', 'epub')), [2]);
    assert.deepEqual(ids(api.getFilteredBookList(books, '별빛 도서관', 'comic')), [1, 4]);
    assert.deepEqual(ids(api.getFilteredBookList(books, '', 'uncategorized')), [3]);
    assert.deepEqual(ids(api.getFilteredBookList(books, '', 'all')), [1, 2, 3, 4, 5]);
});

test('중복은 같은 분류 안에서만 판단하고 특수 검색에도 분류 필터를 적용한다', () => {
    const api = createContext();
    assert.deepEqual(ids(api.getFilteredBookList(books, '#중복', 'all')), [1, 4]);
    assert.deepEqual(ids(api.getFilteredBookList(books, '#중복', 'epub')), []);
    assert.deepEqual(ids(api.getFilteredBookList(books, '#누락', 'comic')), [1]);
    assert.deepEqual(ids(api.getFilteredBookList(books, '#폴더규칙:연재', 'epub')), [2]);
});

function createBatchHarness(type, category, filter = '별빛 도서관', categoryFilter = 'comic') {
    const context = createContext();
    const state = { saved: null, messages: [], confirmations: [], writes: [] };
    const elements = {
        batchTypeSelect: { value: type },
        batchCategorySelect: { value: category },
        batchUpdateBtn: { disabled: false }
    };
    Object.assign(context, {
        document: { getElementById: id => elements[id] },
        bookCategoryFilter: categoryFilter,
        getCurrentBookFilter: () => filter,
        ensureBookStoreReady: async () => {},
        bookStoreGetAllWithRevision: async () => ({ bookList: books, revision: 17 }),
        storageLocalGet: async () => ({ missingVolsMap: {} }),
        confirm: message => { state.confirmations.push(message); return true; },
        showInfoToast: message => state.messages.push(message),
        saveWithUndo: async (saved, message, settings, previous, revision) => {
            state.saved = saved;
            assert.equal(previous, books);
            assert.equal(revision, 17);
            assert.deepEqual(Object.keys(settings), []);
        }
    });
    vm.runInContext(section("document.getElementById('batchUpdateBtn').onclick =", '// ============================================================================'), context);
    return { state, elements, run: () => elements.batchUpdateBtn.onclick() };
}

test('분류만 일괄 변경하면 타입과 다른 분류의 동명 항목은 유지한다', async () => {
    const { state, elements, run } = createBatchHarness('unchanged', 'scan');
    await run();
    assert.ok(state.confirmations[0].includes('2건'));
    assert.ok(state.confirmations[0].includes('도서(SCAN)'));
    assert.equal(state.saved[0].categoryId, 'scan');
    assert.equal(state.saved[0].type, 'incomplete');
    assert.equal(state.saved[3].categoryId, 'scan');
    assert.equal(state.saved[3].type, 'complete');
    assert.equal(state.saved[1], books[1]);
    assert.equal(state.saved[2], books[2]);
    assert.equal(state.saved[4], books[4]);
    assert.equal(elements.batchUpdateBtn.disabled, false);
});

test('타입만 변경하거나 두 값을 함께 변경하고 변경 안 함은 저장하지 않는다', async () => {
    const typeOnly = createBatchHarness('exclude', 'unchanged', '#누락');
    await typeOnly.run();
    assert.equal(typeOnly.state.saved[0].categoryId, 'comic');
    assert.equal(typeOnly.state.saved[0].type, 'exclude');
    assert.equal(typeOnly.state.saved[3], books[3]);
    const both = createBatchHarness('complete', 'video', '', 'uncategorized');
    await both.run();
    assert.equal(both.state.saved[2].categoryId, 'video');
    assert.equal(both.state.saved[2].type, 'complete');
    const none = createBatchHarness('unchanged', 'unchanged');
    await none.run();
    assert.equal(none.state.saved, null);
    assert.equal(none.state.confirmations.length, 0);
});

function createBulkHarness(existing, categoryId) {
    const context = createContext();
    const state = { saved: null, messages: [], writes: [] };
    const elements = {
        bulkInput: { value: '별빛 도서관 5권 1500px', addEventListener() {} },
        bulkPreview: { style: {}, innerHTML: '' },
        bulkTypeSelect: { value: 'incomplete' },
        bulkCategorySelect: { value: categoryId },
        saveBtn: { disabled: false }
    };
    Object.assign(context, {
        bulkInput: elements.bulkInput,
        bulkPreview: elements.bulkPreview,
        document: { getElementById: id => elements[id] },
        storageLocalSet: async values => { state.writes.push(values); },
        setTimeout: callback => callback(),
        ensureBookStoreReady: async () => {},
        bookStoreGetAllWithRevision: async () => ({ bookList: existing, revision: 11 }),
        saveWithUndo: async saved => { state.saved = saved; },
        showInfoToast: message => state.messages.push(message)
    });
    vm.runInContext(section("bulkInput.addEventListener('input'", 'document.body.onclick ='), context);
    return { state, run: () => elements.saveBtn.onclick() };
}

test('일괄 등록은 다른 분류의 동명 도서를 보존하고 같은 분류만 갱신한다', async () => {
    const existing = [books[0], books[1], books[2]];
    const update = createBulkHarness(existing, 'epub');
    await update.run();
    assert.equal(update.state.saved.length, 3);
    assert.equal(update.state.saved[0], books[0]);
    assert.equal(update.state.saved[1].id, 2);
    assert.equal(update.state.saved[1].lastVol, '5');
    assert.equal(update.state.saved[1].categoryId, 'epub');
    assert.equal(update.state.saved[2], books[2]);
    const insert = createBulkHarness(existing, 'pdf');
    await insert.run();
    assert.equal(insert.state.saved.length, 4);
    assert.equal(insert.state.saved[0].categoryId, 'pdf');
    assert.equal(insert.state.saved[0].id, undefined);
    assert.deepEqual(ids(insert.state.saved.slice(1)), [1, 2, 3]);
});

test('같은 분류의 중복 대상이 여러 개면 일괄 등록은 임의 갱신하지 않는다', async () => {
    const harness = createBulkHarness([books[0], books[3]], 'comic');
    await harness.run();
    assert.equal(harness.state.saved, null);
    assert.ok(harness.state.messages.some(message => message.includes('중복 항목')));
});
