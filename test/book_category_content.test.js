const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const common = fs.readFileSync(path.join(root, 'common.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function extractFunction(name) {
    const match = new RegExp(`function ${name}\\(`).exec(content);
    assert.ok(match, `${name} 함수가 필요합니다.`);
    let depth = 0;
    for (let index = content.indexOf('{', match.index); index < content.length; index++) {
        if (content[index] === '{') depth++;
        if (content[index] === '}' && --depth === 0) return content.slice(match.index, index + 1);
    }
    throw new Error(`${name} 함수가 닫히지 않았습니다.`);
}

function createHarness(books = []) {
    const functions = [
        'getStoredBookData', 'createEnhancedBook', 'replaceBookCache',
        'createBookChangeImpact', 'addBookToImpact', 'areBookIdsEqual',
        'refreshExactMatchCache', 'isBookCompatibleWithTitleParts', 'getTitlePartsFromSimilarityCacheKey',
        'similarityResultReferencesImpact', 'invalidateRelatedSimilarityCache', 'upsertCachedBook',
        'deleteCachedBook', 'finalizeBookChangeImpact', 'applyBookStoreDelta', 'getBookChangeMatchKey',
        'calculateLevenshtein', 'getSimilarity', 'findMatchingBook',
        'normalizeTitleCorrectionKeyPart', 'getTitleCorrectionKey', 'normalizeStoredTitleCorrection',
        'getResolvedSiteTitle', 'getResolvedTitleMatchParts'
    ].map(extractFunction).join('\n');
    const api = vm.runInNewContext(`
        ${common}
        let currentBookList = [], cachedBookList = [], exactMatchCache = {}, similarityCache = {};
        let isDataLoaded = false;
        const currentStorageData = { missingVolsMap: {} };
        const titleProcessingCache = new Map();
        const titleCorrections = {};
        const levRow0 = new Int32Array(256), levRow1 = new Int32Array(256);
        const refreshRelatedBookElements = () => {};
        ${functions}
        ({
            replaceBookCache, titleCorrections, getResolvedSiteTitle, getResolvedTitleMatchParts,
            find: (title, category = null, id = null) => findMatchingBook(getTitleMatchParts(title), id, category),
            resolved: (title, category = null) => {
                const resolved = getResolvedSiteTitle(title, false, category);
                return findMatchingBook(getResolvedTitleMatchParts(resolved), resolved.bookId, category);
            },
            upsert: (book, optimistic = false) => {
                const result = upsertCachedBook(book, optimistic);
                finalizeBookChangeImpact(result.impact);
                return result;
            },
            remove: change => {
                const result = deleteCachedBook(change);
                finalizeBookChangeImpact(result.impact);
                return result;
            },
            key: book => getBookChangeMatchKey({book}),
            books: () => cachedBookList
        });
    `, { console, window: { location: { hostname: 'library.example' } } });
    api.replaceBookCache(books);
    return api;
}

test('분류 없는 게시물은 같은 제목의 만화와 EPUB 중 하나를 임의로 매칭하지 않는다', () => {
    const api = createHarness([
        { id: 1, title: '별빛 도서관', categoryId: 'comic', type: 'exclude' },
        { id: 2, title: '별빛 도서관', categoryId: 'epub', type: 'complete' }
    ]);
    const unknown = api.find('별빛 도서관');
    assert.equal(unknown.book, null);
    assert.equal(unknown.ambiguous, true);
    assert.deepEqual(Array.from(unknown.candidates, book => book.id), [1, 2]);
    assert.equal(api.find('별빛 도서관', 'comic').book.id, 1);
    assert.equal(api.find('별빛 도서관', 'epub').book.id, 2);
    assert.equal(api.find('별빛 도서관', 'pdf').book, null);
});

test('등록 분류가 다르면 기존 매칭 ID를 사용하지 않으며 명시적인 대상 선택은 지원한다', () => {
    const api = createHarness([
        { id: 1, title: '별빛 도서관', categoryId: 'comic' },
        { id: 2, title: '별빛 도서관', categoryId: 'pdf' }
    ]);
    assert.equal(api.find('별빛 도서관', 'pdf', 1).book.id, 2);
    assert.equal(api.find('별빛 도서관', null, 1).book.id, 1);
});

test('구형 도서는 미분류로 조회하고 분류별 판본 구분을 유지한다', () => {
    const api = createHarness([
        { id: 1, title: '별빛 도서관' },
        { id: 2, title: '별빛 도서관(신장판)', categoryId: 'comic' },
        { id: 3, title: '별빛 도서관(신장판)', categoryId: 'pdf' }
    ]);
    assert.equal(api.find('별빛 도서관', 'uncategorized').book.id, 1);
    assert.equal(api.find('별빛 도서관(신장판)', 'comic').book.id, 2);
    assert.equal(api.find('별빛 도서관(신장판)').book, null);
});

test('분류 변경 후 이전 분류와 새 분류의 매칭 캐시를 함께 갱신한다', () => {
    const api = createHarness([{ id: 1, title: '별빛 도서관', categoryId: 'comic' }]);
    assert.equal(api.find('별빛 도서관', 'comic').book.id, 1);
    assert.equal(api.find('별빛 도서관', 'epub').book, null);
    api.upsert({ id: 1, title: '별빛 도서관', categoryId: 'epub' });
    assert.equal(api.find('별빛 도서관', 'comic').book, null);
    assert.equal(api.find('별빛 도서관', 'epub').book.id, 1);
});

test('두 분류의 연속 등록 응답과 삭제는 각 분류의 낙관적 항목에만 적용한다', () => {
    const api = createHarness();
    api.upsert({ title: '별빛 도서관', categoryId: 'comic' }, true);
    api.upsert({ title: '별빛 도서관', categoryId: 'epub' }, true);
    api.upsert({ id: 22, title: '별빛 도서관', categoryId: 'epub' });
    api.upsert({ id: 11, title: '별빛 도서관', categoryId: 'comic' });
    assert.equal(api.books().length, 2);
    assert.equal(api.find('별빛 도서관', 'comic').book.id, 11);
    assert.equal(api.find('별빛 도서관', 'epub').book.id, 22);
    assert.notEqual(api.key(api.books()[0]), api.key(api.books()[1]));
    api.remove({ book: { title: '별빛 도서관', categoryId: 'comic' } });
    assert.equal(api.books().length, 1);
    assert.equal(api.find('별빛 도서관').book.id, 22);
});

test('분류별 제목 정정은 다른 분류를 변경하지 않고 분류 미상에서는 후보로 남긴다', () => {
    const api = createHarness([
        { id: 1, title: '별빛 도서관 정정', categoryId: 'comic' },
        { id: 2, title: '별빛 도서관', categoryId: 'pdf' }
    ]);
    api.titleCorrections['*::category=comic::별빛 도서관'] = {
        correctedTitle: '별빛 도서관 정정', categoryId: 'comic', bookId: 1
    };
    assert.equal(api.resolved('별빛 도서관', 'comic').book.id, 1);
    assert.equal(api.resolved('별빛 도서관', 'pdf').book.id, 2);
    const unknown = api.resolved('별빛 도서관');
    assert.equal(unknown.book, null);
    assert.equal(unknown.ambiguous, true);
});

test('기존 제목정정도 원문과 정정문이 서로 다른 분류에 있으면 후보 선택을 요구한다', () => {
    const api = createHarness([
        { id: 1, title: '별빛 도서관 정정', categoryId: 'comic' },
        { id: 2, title: '별빛 도서관', categoryId: 'epub' }
    ]);
    api.titleCorrections['*::별빛 도서관'] = { correctedTitle: '별빛 도서관 정정', bookId: 1 };
    assert.equal(api.resolved('별빛 도서관').ambiguous, true);
    assert.equal(api.resolved('별빛 도서관', 'epub').book.id, 2);
});

test('다른 분류로 이동한 도서의 이전 분류 제목정정은 적용하지 않는다', () => {
    const api = createHarness([{ id: 1, title: '별빛 도서관 정정', categoryId: 'pdf' }]);
    api.titleCorrections['*::category=comic::별빛 도서관'] = {
        correctedTitle: '별빛 도서관 정정', categoryId: 'comic', bookId: 1
    };
    const resolved = api.getResolvedSiteTitle('별빛 도서관', false, 'comic');
    assert.equal(resolved.isCorrected, false);
    assert.equal(resolved.bookId, null);
    assert.equal(api.resolved('별빛 도서관', 'comic').book, null);
});
