const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const commonSource = fs.readFileSync(path.join(projectRoot, 'common.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(projectRoot, 'db.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(projectRoot, 'background.js'), 'utf8');

function extractFunction(source, name) {
    const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
    assert.ok(match, `${name} 함수를 찾을 수 없습니다.`);
    const start = source.indexOf('{', match.index);
    let depth = 0;
    for (let index = start; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}') depth--;
        if (depth === 0) return source.slice(match.index, index + 1);
    }
    throw new Error(`${name} 함수의 끝을 찾을 수 없습니다.`);
}

function createStorageHarness() {
    const state = { books: new Map(), changes: [], messages: [], revision: 0, nextId: 1 };
    const context = vm.createContext({
        ensureBookStoreReady: async () => {},
        runBookStoreIndexTransaction: async (_mode, operation) => operation(),
        incrementBookStoreRevisionInTransaction: async () => ++state.revision,
        bookStorePublishChange: async change => state.changes.push(change),
        sendTabMessage: (tabId, message) => state.messages.push({ tabId, message }),
        getBookStoreErrorMessage: error => error.message,
        console: { log() {}, error() {} },
        db: {
            books: {
                get: async id => state.books.get(id),
                where: index => {
                    assert.equal(index, 'cleanTitleStr');
                    return {
                        equals: key => ({
                            last: async () => Array.from(state.books.values())
                                .filter(book => book.cleanTitleStr === key).at(-1)
                        })
                    };
                },
                put: async book => {
                    const id = book.id ?? state.nextId++;
                    state.books.set(id, { ...book, id });
                    return id;
                }
            }
        }
    });
    vm.runInContext(commonSource, context);
    vm.runInContext([
        'getBookStoreMatchKey',
        'prepareBookForStore',
        'toPublicBook',
        'attachBookStoreRevision',
        'isLowCoverageBookTargetMismatch',
        'findStoredBookByTarget',
        'bookStorePutManyByTarget'
    ].map(name => extractFunction(dbSource, name)).join('\n'), context);
    vm.runInContext(extractFunction(backgroundSource, 'processSaveQueue'), context);
    return { state, api: context };
}

for (const type of ['incomplete', 'complete', 'exclude']) {
    test(`${type} 저장은 제목 끝의 마침표와 공백을 제거한다`, () => {
        const { api } = createStorageHarness();
        for (const title of ['작품.', '작품...', '  작품.  ', '작품. \t.\n.\u00a0']) {
            const book = api.prepareBookForStore({ title, type });
            assert.equal(book.title, '작품');
            assert.equal(book.type, type);
        }
    });

    test(`${type} 빠른 등록은 정리된 제목을 저장하고 알림에 전달한다`, async () => {
        const { state, api } = createStorageHarness();
        const result = await api.processSaveQueue([{
            cleanTitle: '  Dr. 작품...  ',
            type,
            lastVol: '3',
            resolution: '1440',
            dateString: '2026-10-09',
            tabId: 7
        }]);

        assert.equal(result.ok, true);
        assert.equal(state.books.size, 1);
        assert.equal(state.books.get(result.book.id).title, 'Dr. 작품');
        assert.equal(result.book.title, 'Dr. 작품');
        assert.equal(result.book.type, type);
        assert.equal(result.book.lastVol, '3');
        assert.equal(state.changes[0].book.title, 'Dr. 작품');
        assert.equal(state.messages[0].message.book.title, 'Dr. 작품');
    });

    test(`${type} 상태 변경은 기존 제목 끝의 마침표를 제거하고 도서 ID와 정보를 유지한다`, async () => {
        const { state, api } = createStorageHarness();
        const existingBook = {
            id: 42,
            title: 'Dr. 원본 작품. . ',
            cleanTitleStr: api.getBookStoreMatchKey('Dr. 원본 작품. . '),
            type: 'incomplete',
            lastVol: '5',
            resolution: '1350',
            missingVols: [2, 4]
        };
        state.books.set(42, existingBook);
        const result = await api.processSaveQueue([{
            bookId: 42,
            cleanTitle: 'Dr. 원본 작품',
            type,
            dateString: '2026-10-09'
        }]);

        assert.equal(result.ok, true);
        assert.equal(state.books.size, 1);
        assert.equal(result.book.id, 42);
        assert.equal(result.book.title, 'Dr. 원본 작품');
        assert.equal(result.book.type, type);
        assert.equal(result.book.lastVol, '5');
        assert.equal(result.book.resolution, '1350');
        assert.deepEqual(result.book.missingVols, [2, 4]);
        assert.equal(existingBook.title, 'Dr. 원본 작품. . ');
    });
}

test('저장 제목은 중간 마침표와 다른 문장부호를 유지하고 원본 객체를 변경하지 않는다', () => {
    const { api } = createStorageHarness();
    const original = Object.freeze({
        title: '  Dr. Stone 2.5...  ',
        type: 'complete',
        cleanTitleStr: 'old-key',
        _temporary: true
    });
    const book = api.prepareBookForStore(original);

    assert.equal(book.title, 'Dr. Stone 2.5');
    assert.equal(original.title, '  Dr. Stone 2.5...  ');
    assert.equal(original.cleanTitleStr, 'old-key');
    assert.equal(original._temporary, true);
    assert.equal(book._temporary, undefined);
    for (const title of ['작품!', '작품?', '작품…', '작품。', 'Dr. Stone']) {
        assert.equal(api.prepareBookForStore({ title }).title, title);
    }
});

test('마침표와 공백만 있는 제목은 빈 제목으로 저장하지 않는다', async () => {
    const { state, api } = createStorageHarness();
    for (const title of ['.', '...', ' . \t.\n. ']) {
        assert.throws(() => api.prepareBookForStore({ title }), /도서 제목은 비워둘 수 없습니다/);
    }
    const result = await api.processSaveQueue([{ cleanTitle: ' . . ', type: 'exclude' }]);
    assert.equal(result.ok, false);
    assert.equal(state.books.size, 0);
    assert.equal(state.changes.length, 0);
});

test('저장 검색 키는 끝 마침표 제거 후의 제목과 판본을 기준으로 생성한다', () => {
    const { api } = createStorageHarness();
    const book = api.prepareBookForStore({ title: '작품 개정판...', cleanTitleStr: 'old-key' });

    assert.equal(book.title, '작품 개정판');
    assert.equal(book.cleanTitleStr, api.getTitleMatchParts('작품 개정판').matchKey);
    assert.equal(book.cleanTitleStr, '작품::개정판');
});

test('끝 마침표가 붙은 판본 제목을 다시 처리해도 기존 도서를 갱신한다', async () => {
    const { state, api } = createStorageHarness();
    const rawTitle = '작품 개정판. . ';
    assert.equal(api.getTitleMatchParts(rawTitle).matchKey, '작품::개정판');
    assert.equal(api.getBookStoreMatchKey(rawTitle), api.getBookStoreMatchKey('작품 개정판'));

    const firstResult = await api.processSaveQueue([{
        cleanTitle: rawTitle,
        type: 'incomplete',
        lastVol: '3',
        dateString: '2026-10-08'
    }]);
    assert.equal(firstResult.ok, true);
    assert.equal(firstResult.book.title, '작품 개정판');

    const secondResult = await api.processSaveQueue([{
        cleanTitle: rawTitle,
        type: 'complete',
        lastVol: '5',
        dateString: '2026-10-09'
    }]);
    assert.equal(secondResult.ok, true);
    assert.equal(state.books.size, 1);
    assert.equal(secondResult.book.id, firstResult.book.id);
    assert.equal(secondResult.book.title, '작품 개정판');
    assert.equal(secondResult.book.type, 'complete');
    assert.equal(secondResult.book.lastVol, '5');
    assert.equal(state.books.get(firstResult.book.id).cleanTitleStr, '작품::개정판');
});

test('이전 검색 인덱스는 제목을 유지하며 갱신하고 같은 설정에서는 재생성을 건너뛴다', async () => {
    const { state, api } = createStorageHarness();
    state.books.set(42, { id: 42, title: '작품 개정판.', cleanTitleStr: '작품개정판' });
    let indexMeta = { key: 'book-index-signature', signature: api.getEditionKeywordsSignature() };
    let transactionCount = 0;
    let reindexCount = 0;
    api.db.meta = {
        get: async key => {
            assert.equal(key, 'book-index-signature');
            return indexMeta;
        },
        put: async value => { indexMeta = value; }
    };
    api.db.transaction = async (...args) => {
        transactionCount++;
        return args.at(-1)();
    };
    api.db.books.toCollection = () => ({
        modify: async update => {
            reindexCount++;
            state.books.forEach(update);
        }
    });
    vm.runInContext(`
        const BOOK_STORE_INDEX_META_KEY = 'book-index-signature';
        let bookStoreIndexedSignature = null;
        ${[
            'waitForBookStoreTitleRules',
            'getCurrentBookStoreIndexSignature',
            'reindexBookStoreForSignature',
            'ensureBookStoreIndexCurrent'
        ].map(name => extractFunction(dbSource, name)).join('\n')}
    `, api);

    assert.notEqual(indexMeta.signature, api.getCurrentBookStoreIndexSignature());
    await api.ensureBookStoreIndexCurrent();
    assert.equal(transactionCount, 1);
    assert.equal(reindexCount, 1);
    assert.equal(indexMeta.signature, api.getCurrentBookStoreIndexSignature());
    assert.equal(state.books.get(42).title, '작품 개정판.');
    assert.equal(state.books.get(42).cleanTitleStr, '작품::개정판');

    await api.ensureBookStoreIndexCurrent();
    assert.equal(transactionCount, 1);
    assert.equal(reindexCount, 1);

    const result = await api.processSaveQueue([{ cleanTitle: '작품 개정판.', type: 'complete' }]);
    assert.equal(result.ok, true);
    assert.equal(result.book.id, 42);
    assert.equal(result.book.title, '작품 개정판');
    assert.equal(state.books.size, 1);
});
