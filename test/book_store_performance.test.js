const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const sources = Object.fromEntries(
    ['common.js', 'db.js', 'background.js', 'content.js', 'options.js'].map(fileName => [
        fileName,
        fs.readFileSync(path.join(projectRoot, fileName), 'utf8')
    ])
);

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBalancedBlock(source, openingBraceIndex) {
    assert.notEqual(openingBraceIndex, -1, '블록 시작 중괄호를 찾을 수 없습니다.');

    let depth = 0;
    for (let index = openingBraceIndex; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}') depth--;
        if (depth === 0) return source.slice(openingBraceIndex, index + 1);
    }

    throw new Error('블록의 끝을 찾을 수 없습니다.');
}

function extractFunction(source, name) {
    const signature = new RegExp(`(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`);
    const match = signature.exec(source);
    assert.ok(match, `${name} 함수를 찾을 수 없습니다.`);

    const openingParenthesisIndex = source.indexOf('(', match.index);
    let parenthesisDepth = 0;
    let closingParenthesisIndex = -1;

    for (let index = openingParenthesisIndex; index < source.length; index++) {
        if (source[index] === '(') parenthesisDepth++;
        if (source[index] === ')') parenthesisDepth--;
        if (parenthesisDepth === 0) {
            closingParenthesisIndex = index;
            break;
        }
    }

    assert.notEqual(closingParenthesisIndex, -1, `${name} 함수 매개변수의 끝을 찾을 수 없습니다.`);
    const openingBraceIndex = source.indexOf('{', closingParenthesisIndex);
    return source.slice(match.index, openingBraceIndex) + extractBalancedBlock(source, openingBraceIndex);
}

function extractArrowListenerBody(source, listenerStart) {
    assert.notEqual(listenerStart, -1, '스토리지 변경 리스너를 찾을 수 없습니다.');

    const arrowIndex = source.indexOf('=>', listenerStart);
    const openingBraceIndex = source.indexOf('{', arrowIndex);
    return extractBalancedBlock(source, openingBraceIndex);
}

function extractBranch(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `${startNeedle} 분기를 찾을 수 없습니다.`);

    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.notEqual(end, -1, `${endNeedle} 분기 경계를 찾을 수 없습니다.`);
    return source.slice(start, end);
}

test('DB v5 도서 검색 키는 중복을 허용한다', () => {
    const versionFive = sources['db.js'].match(/db\.version\(5\)\.stores\(\{([\s\S]*?)\}\);/);
    assert.ok(versionFive, 'DB v5 스키마를 찾을 수 없습니다.');

    const booksSchema = versionFive[1].match(/books:\s*['"]([^'"]+)['"]/);
    assert.ok(booksSchema, 'DB v5 books 스키마를 찾을 수 없습니다.');
    assert.match(booksSchema[1], /(?:^|,\s*)cleanTitleStr(?:,|$)/);
    assert.doesNotMatch(booksSchema[1], /&cleanTitleStr/);
});

test('검색 인덱스 트랜잭션은 operation 전후에 signature를 재검증한다', async () => {
    const transactionSource = extractFunction(sources['db.js'], 'runBookStoreIndexTransaction');
    const beforeOperationAssertIndex = transactionSource.indexOf(
        'await assertBookStoreIndexSignatureInTransaction(indexSignature)'
    );
    const operationIndex = transactionSource.indexOf('const result = await operation()');
    const runtimeSignatureCheckIndex = transactionSource.indexOf(
        'const latestIndexSignature = getCurrentBookStoreIndexSignature()'
    );
    const afterOperationAssertIndex = transactionSource.indexOf(
        'await assertBookStoreIndexSignatureInTransaction(indexSignature)',
        beforeOperationAssertIndex + 1
    );

    assert.ok(beforeOperationAssertIndex >= 0);
    assert.ok(beforeOperationAssertIndex < operationIndex);
    assert.ok(operationIndex < runtimeSignatureCheckIndex);
    assert.ok(runtimeSignatureCheckIndex < afterOperationAssertIndex);

    const state = {
        runtimeSignature: 'signature-a',
        metaSignature: 'signature-a',
        operationCount: 0,
        refreshCount: 0,
        transactionCount: 0,
        assertions: []
    };
    const runBookStoreIndexTransaction = vm.runInNewContext(`
        ${extractFunction(sources['db.js'], 'createBookStoreIndexChangedError')}
        ${transactionSource}
        runBookStoreIndexTransaction;
    `, {
        ensureBookStoreIndexCurrent: async () => {},
        getCurrentBookStoreIndexSignature: () => state.runtimeSignature,
        assertBookStoreIndexSignatureInTransaction: async expectedSignature => {
            state.assertions.push({ expectedSignature, actualSignature: state.metaSignature });
            if (state.metaSignature !== expectedSignature) {
                const error = new Error('index changed');
                error.name = 'BookStoreIndexChangedError';
                error.expectedSignature = expectedSignature;
                error.currentSignature = state.metaSignature;
                throw error;
            }
        },
        refreshBookStoreTitleRulesFromStorage: async () => {
            state.refreshCount++;
            state.runtimeSignature = state.metaSignature;
        },
        db: {
            books: {},
            meta: {},
            transaction: async (...args) => {
                state.transactionCount++;
                return args[args.length - 1]();
            }
        }
    });

    const result = await runBookStoreIndexTransaction('rw', async () => {
        state.operationCount++;
        if (state.operationCount === 1) state.metaSignature = 'signature-b';
        return 'saved';
    });

    assert.equal(result, 'saved');
    assert.equal(state.transactionCount, 2);
    assert.equal(state.operationCount, 2);
    assert.equal(state.refreshCount, 1);
    assert.equal(state.assertions.length, 4);
    assert.equal(state.assertions[0].actualSignature, 'signature-a');
    assert.equal(state.assertions[1].actualSignature, 'signature-b');
    assert.equal(state.assertions[2].expectedSignature, 'signature-b');
    assert.equal(state.assertions[3].actualSignature, 'signature-b');
});

test('대량 저장은 중복 ID를 재발급하고 기존 누락 권수 데이터를 보존한다', () => {
    const bulkPreparation = [
        'getBookStoreMatchKey',
        'prepareBookForStore',
        'normalizeBulkBookId',
        'prepareBooksForBulkStore'
    ].map(name => extractFunction(sources['db.js'], name)).join('\n');
    const prepareBooksForBulkStore = vm.runInNewContext(`
        function getTitleMatchParts(title) {
            return { matchKey: String(title || '').replace(/\\s+/g, '') };
        }

        ${bulkPreparation}
        prepareBooksForBulkStore;
    `);
    const duplicateId = Date.now();
    const books = Array.from({ length: 10000 }, (_, index) => ({
        id: duplicateId,
        title: `도서 ${index + 1}`,
        type: 'incomplete',
        missingVols: index === 0 ? [2, 4] : []
    }));

    const preparedBooks = prepareBooksForBulkStore(books);
    const ids = preparedBooks.map(book => book.id);

    assert.equal(preparedBooks.length, books.length);
    assert.equal(new Set(ids).size, books.length);
    assert.equal(preparedBooks[0].id, duplicateId);
    assert.equal(JSON.stringify(preparedBooks[0].missingVols), '[2,4]');
    assert.ok(ids.every(id => Number.isFinite(id) && id > 0));
    assert.doesNotMatch(sources['options.js'], /Date\.now\(\)\s*\+\s*Math\.random\(\)/);
});

test('마이그레이션은 legacy와 기존 DB의 중복 제목을 유실 없이 병합한다', () => {
    const migrationFunctions = [
        'getBookStoreMatchKey',
        'prepareBookForStore',
        'normalizeBulkBookId',
        'prepareBooksForBulkStore',
        'getBookModifiedTime',
        'areMigrationMirrorBooks',
        'mergeBookMigrationSources'
    ].map(name => extractFunction(sources['db.js'], name)).join('\n');
    const migrationApi = vm.runInNewContext(`
        function getTitleMatchParts(title) {
            return {
                matchKey: String(title || '')
                    .replace(/[^a-zA-Z0-9가-힣]/g, '')
                    .toLowerCase()
            };
        }

        function toPublicBook(book) {
            if (!book || typeof book !== 'object') return null;
            const publicBook = { ...book };
            delete publicBook.cleanTitleStr;
            delete publicBook._bookStoreRevision;
            return publicBook;
        }

        ${migrationFunctions}
        ({ mergeBookMigrationSources, prepareBooksForBulkStore });
    `);
    const legacyBooks = [
        {
            id: 700,
            title: '중복 도서',
            type: 'incomplete',
            date: '2026-01-01T00:00:00.000Z',
            missingVols: [2]
        },
        {
            id: 700,
            title: '중복 도서',
            type: 'exclude',
            date: '2026-01-02T00:00:00.000Z',
            missingVols: [4]
        },
        { title: '레거시 전용', type: 'incomplete' }
    ];
    const existingBooks = [
        {
            id: 700,
            title: '중복 도서',
            type: 'complete',
            date: '2026-02-01T00:00:00.000Z'
        },
        { id: 900, title: '중복 도서', type: 'complete' },
        { id: 901, title: 'DB 전용', type: 'exclude' }
    ];

    const mergedBooks = migrationApi.mergeBookMigrationSources(legacyBooks, existingBooks);
    const preparedBooks = migrationApi.prepareBooksForBulkStore(mergedBooks);
    const duplicateTitleBooks = preparedBooks.filter(book => book.title === '중복 도서');

    assert.equal(preparedBooks.length, 5);
    assert.equal(duplicateTitleBooks.length, 3);
    assert.equal(new Set(preparedBooks.map(book => book.id)).size, preparedBooks.length);
    assert.equal(duplicateTitleBooks.some(book => book.type === 'exclude'), true);
    const mergedNewestBook = duplicateTitleBooks.find(book => book.type === 'complete' && book.id === 700);
    assert.ok(mergedNewestBook);
    assert.equal(JSON.stringify(mergedNewestBook.missingVols), '[2]');
    assert.equal(preparedBooks.some(book => book.title === '레거시 전용'), true);
    assert.equal(preparedBooks.some(book => book.title === 'DB 전용'), true);

    const idCollisionBooks = migrationApi.prepareBooksForBulkStore(
        migrationApi.mergeBookMigrationSources(
            [{ id: 77, title: '서로 다른 레거시 도서' }],
            [{ id: 77, title: '서로 다른 DB 도서' }]
        )
    );
    assert.equal(idCollisionBooks.length, 2);
    assert.equal(new Set(idCollisionBooks.map(book => book.id)).size, 2);

    const mirrorFields = {
        title: 'v4 미러 도서',
        type: 'complete',
        resolution: '1200px',
        lastVol: '10',
        date: '2026-03-01T00:00:00.000Z'
    };
    const mirrorBooks = migrationApi.prepareBooksForBulkStore(
        migrationApi.mergeBookMigrationSources(
            [
                { id: 50000, ...mirrorFields },
                { id: 50001, ...mirrorFields }
            ],
            [{ id: 1, ...mirrorFields }]
        )
    );
    assert.equal(mirrorBooks.length, 2);
    assert.equal(mirrorBooks.every(book => book.title === mirrorFields.title), true);
    assert.equal(new Set(mirrorBooks.map(book => book.id)).size, 2);
    assert.equal(mirrorBooks.some(book => book.id === 50000), true);
    assert.equal(mirrorBooks.some(book => book.id === 50001), true);

    const sameKeyDifferentTitleBooks = migrationApi.prepareBooksForBulkStore(
        migrationApi.mergeBookMigrationSources(
            [{ id: 60000, ...mirrorFields, title: 'A-B' }],
            [{ id: 2, ...mirrorFields, title: 'AB' }]
        )
    );
    assert.equal(sameKeyDifferentTitleBooks.length, 2);
    assert.equal(sameKeyDifferentTitleBooks.some(book => book.title === 'A-B'), true);
    assert.equal(sameKeyDifferentTitleBooks.some(book => book.title === 'AB'), true);

    const ensureBookStoreReady = extractFunction(sources['db.js'], 'ensureBookStoreReady');
    assert.match(ensureBookStoreReady, /const existingBooks\s*=\s*await db\.books\.toArray\s*\(\)/);
    assert.match(ensureBookStoreReady, /mergeBookMigrationSources\s*\(\s*legacyBooks\s*,\s*existingBooks\s*\)/);
    assert.ok(
        ensureBookStoreReady.indexOf('mergeBookMigrationSources') < ensureBookStoreReady.indexOf('db.books.clear()'),
        '두 저장소를 병합한 후에만 기존 DB를 교체해야 합니다.'
    );
});

test('전체 교체는 revision CAS로 중간 변경을 덮어쓰지 않는다', async () => {
    const state = {
        revision: 8,
        clearCount: 0,
        bulkPutCount: 0,
        storedBooks: []
    };
    const replaceAll = vm.runInNewContext(`
        ${extractFunction(sources['db.js'], 'normalizeBookStoreRevision')}
        ${extractFunction(sources['db.js'], 'createBookStoreConflictError')}
        ${extractFunction(sources['db.js'], 'bookStoreReplaceAll')}
        bookStoreReplaceAll;
    `, {
        ensureBookStoreReady: async () => {},
        runBookStoreIndexTransaction: async (_mode, operation) => operation(),
        prepareBooksForBulkStore: books => books.map(book => ({ ...book })),
        getBookStoreRevisionInTransaction: async () => state.revision,
        incrementBookStoreRevisionInTransaction: async () => {
            state.revision++;
            return state.revision;
        },
        db: {
            books: {
                clear: async () => {
                    state.clearCount++;
                    state.storedBooks = [];
                },
                bulkPut: async books => {
                    state.bulkPutCount++;
                    state.storedBooks = books;
                },
                count: async () => state.storedBooks.length
            },
            meta: {},
            transaction: async (...args) => args[args.length - 1]()
        }
    });

    await assert.rejects(
        replaceAll([{ id: 1, title: '스냅샷' }], 7),
        error => {
            assert.equal(error.name, 'BookStoreConflictError');
            assert.equal(error.expectedRevision, 7);
            assert.equal(error.currentRevision, 8);
            return true;
        }
    );
    assert.equal(state.clearCount, 0);
    assert.equal(state.bulkPutCount, 0);
    assert.equal(state.revision, 8);

    const result = await replaceAll([
        { id: 1, title: '스냅샷' },
        { id: 2, title: '새 도서' }
    ], 8);
    assert.equal(result.count, 2);
    assert.equal(result.revision, 9);
    assert.equal(state.clearCount, 1);
    assert.equal(state.bulkPutCount, 1);
    assert.equal(state.storedBooks.length, 2);
});

test('백그라운드 저장 큐는 여러 변경을 하나의 IndexedDB 트랜잭션으로 커밋한다', () => {
    const processSaveQueue = extractFunction(sources['background.js'], 'processSaveQueue');

    assert.doesNotMatch(processSaveQueue, /chrome\.storage\.local\.(?:get|set)/);
    assert.doesNotMatch(processSaveQueue, /bookStoreGetAll|bookStoreReplaceAll/);
    assert.doesNotMatch(processSaveQueue, /bookStoreFindByMatchKey|bookStorePut\s*\(/);
    assert.match(processSaveQueue, /bookStorePutManyByTarget\s*\(\s*mutationEntries\s*\)/);
    assert.match(processSaveQueue, /existingBook\s*\?\s*\{[\s\S]*title:\s*existingBook\.title/);
    assert.match(processSaveQueue, /mutationResult\.books\.map\s*\(book\s*=>\s*\(\{\s*type:\s*['"]upsert['"]/);
    assert.match(processSaveQueue, /type:\s*['"]batch['"][\s\S]*changes:\s*savedChanges/);
    assert.match(processSaveQueue, /revision:\s*mutationResult\.revision/);
    assert.match(processSaveQueue, /bookStorePublishChange\s*\(\s*markerPayload\s*\)/);
});

test('백그라운드 삭제는 전체 목록 대신 대상 조회와 삭제를 하나의 트랜잭션으로 처리한다', () => {
    const deleteBookByMatchKey = extractFunction(sources['background.js'], 'deleteBookByMatchKey');
    const handleQuickAction = extractFunction(sources['background.js'], 'handleQuickAction');

    assert.doesNotMatch(deleteBookByMatchKey, /chrome\.storage\.local\.(?:get|set)/);
    assert.doesNotMatch(deleteBookByMatchKey, /bookStoreGetAll|bookStoreReplaceAll/);
    assert.doesNotMatch(deleteBookByMatchKey, /bookStoreFindByMatchKey|bookStoreDelete\s*\(/);
    assert.match(deleteBookByMatchKey, /bookStoreDeleteByTarget\s*\(\s*\{/);
    assert.match(deleteBookByMatchKey, /id:\s*bookId[\s\S]*matchKey:/);
    assert.match(deleteBookByMatchKey, /bookStorePublishChange\s*\(\s*\{[\s\S]*type:\s*['"]delete['"]/);
    assert.match(handleQuickAction, /message\.type\s*===\s*['"]delete['"][\s\S]*return\s+enqueueBookMutation\s*\(/);
    assert.match(handleQuickAction, /deleteBookByMatchKey\s*\([\s\S]*message\.bookId/);
});

test('GET_BOOK_LIST는 목록과 revision을 같은 스냅샷으로 응답한다', () => {
    const getAllWithRevision = extractFunction(sources['db.js'], 'bookStoreGetAllWithRevision');
    const getBookListBranch = extractBranch(
        sources['background.js'],
        'else if (message.action === "GET_BOOK_LIST")',
        'else if (message.action === "GET_BOOK_STORE_REVISION")'
    );

    assert.match(getAllWithRevision, /db\.transaction\s*\(\s*['"]r['"]\s*,\s*db\.books\s*,\s*db\.meta/);
    assert.match(getAllWithRevision, /Promise\.all\s*\(\s*\[[\s\S]*db\.books\.toArray\s*\(\)[\s\S]*getBookStoreRevisionInTransaction\s*\(\)/);
    assert.match(getAllWithRevision, /bookList:\s*books\.map\s*\(\s*toPublicBook\s*\)[\s\S]*revision/);

    assert.match(getBookListBranch, /bookStoreGetAllWithRevision\s*\(\s*\)/);
    assert.match(getBookListBranch, /bookList:\s*result\.bookList/);
    assert.match(getBookListBranch, /revision:\s*result\.revision/);
    assert.match(getBookListBranch, /return\s+true/);
});

test('GET_BOOK_STORE_REVISION은 도서 목록 없이 현재 revision만 응답한다', () => {
    const getRevision = extractFunction(sources['db.js'], 'bookStoreGetRevision');
    const getRevisionBranch = extractBranch(
        sources['background.js'],
        'else if (message.action === "GET_BOOK_STORE_REVISION")',
        'else if (message.action === "CONTENT_UPDATE_BOOK")'
    );

    assert.match(getRevision, /ensureBookStoreReady\s*\(\s*\)/);
    assert.match(getRevision, /db\.transaction\s*\(\s*['"]r['"]\s*,\s*db\.meta/);
    assert.match(getRevision, /getBookStoreRevisionInTransaction\s*\(\s*\)/);
    assert.doesNotMatch(getRevision, /db\.books|bookStoreGetAll/);

    assert.match(getRevisionBranch, /bookStoreGetRevision\s*\(\s*\)\.then\s*\(revision\s*=>/);
    assert.match(getRevisionBranch, /sendResponse\s*\(\s*\{\s*ok:\s*true\s*,\s*revision\s*\}\s*\)/);
    assert.match(getRevisionBranch, /sendResponse\s*\(\s*\{\s*ok:\s*false\s*,\s*error:/);
    assert.doesNotMatch(getRevisionBranch, /bookList/);
    assert.match(getRevisionBranch, /return\s+true/);
});

test('QUICK_ACTION은 비동기 처리 완료를 sendResponse로 확인한다', () => {
    const quickActionBranch = extractBranch(
        sources['background.js'],
        'else if (message.action === "QUICK_ACTION")',
        'else if (message.action === "DOWNLOAD_GIGAFILE")'
    );
    const createQuickActions = extractFunction(sources['content.js'], 'createQuickActions');

    assert.match(quickActionBranch, /handleQuickAction\s*\(\s*message\s*,\s*sender\s*\)\.then/);
    assert.match(quickActionBranch, /sendResponse\s*\(\s*result/);
    assert.match(quickActionBranch, /sendResponse\s*\(\s*\{\s*ok:\s*false\s*,\s*error:/);
    assert.match(quickActionBranch, /return\s+true/);

    assert.match(createQuickActions, /requestRuntimeResponse\s*\(\s*\{\s*action:\s*"QUICK_ACTION"[\s\S]*\(response\)\s*=>/);
    assert.match(createQuickActions, /!response\s*\|\|\s*response\.ok\s*!==\s*true[\s\S]*recoverPendingOptimisticChanges\s*\(\s*true\s*\)/);
});

test('긴 도서 제목은 접두사만 같은 짧은 도서와 상태 처리 대상으로 매칭되지 않는다', () => {
    const commonContext = vm.createContext({
        console: {
            log() {},
            error() {}
        }
    });
    vm.runInContext(sources['common.js'], commonContext);

    const rawTitles = [
        '리버스 더 루나틱 테이커 1~7권 1800px (완결)',
        '리버스 더 루나틱 테이커 1\\~7권 1800px (완결)'
    ];
    const cleanedTitles = rawTitles.map(title => commonContext.cleanSiteTitle(title));
    assert.deepEqual(Array.from(cleanedTitles), [
        '리버스 더 루나틱 테이커',
        '리버스 더 루나틱 테이커'
    ]);
    const fullTitle = cleanedTitles[0];

    const shortBook = {
        id: 1,
        title: '리버스',
        type: 'incomplete',
        _regBodyOriginal: '리버스',
        _regBodyNoSpace: '리버스',
        _editionKey: '',
        _editionState: 'unknown',
        _matchKey: '리버스'
    };
    const matchingApi = vm.runInNewContext(`
        const levRow0 = new Int32Array(256);
        const levRow1 = new Int32Array(256);
        let cachedBookList = [initialShortBook];
        let exactMatchCache = {};
        let similarityCache = {};

        ${extractFunction(sources['content.js'], 'calculateLevenshtein')}
        ${extractFunction(sources['content.js'], 'getSimilarity')}
        ${extractFunction(sources['content.js'], 'findMatchingBook')}

        ({ getSimilarity, findMatchingBook });
    `, {
        initialShortBook: shortBook
    });

    assert.equal(matchingApi.getSimilarity('리버스', fullTitle), 75);
    const match = matchingApi.findMatchingBook(commonContext.getTitleMatchParts(fullTitle));
    assert.equal(match.book, null);
    assert.equal(match.maxScore, 0);

    assert.equal(
        matchingApi.getSimilarity('루나틱 테이커', '더 루나틱 테이커'),
        95
    );
    assert.equal(
        matchingApi.getSimilarity('루나틱 테이커', '리버스 루나틱 테이커'),
        85
    );
});

test('SHOW_TOAST 메시지는 알림만 표시하고 전체 도서 목록을 다시 읽지 않는다', () => {
    const toastBranch = extractBranch(
        sources['content.js'],
        'request.action === "SHOW_TOAST"',
        'request.action === "SHOW_INFO_TOAST"'
    );

    assert.match(toastBranch, /showToast\s*\(\s*request\.book/);
    assert.doesNotMatch(
        toastBranch,
        /safeStorageGet|loadBookListWithLegacyFallback|reloadBookListFromSource|replaceBookCache|initDataCache|debouncedApplyStyles/
    );
});

test('콘텐츠 재로드는 정본 요청 실패 시 legacy 목록으로 되돌리지 않는다', () => {
    const state = {
        runtimeResponse: null,
        legacyReads: 0
    };
    const loadBookListWithLegacyFallback = vm.runInNewContext(`
        ${extractFunction(sources['content.js'], 'normalizeBookStoreRevision')}
        ${extractFunction(sources['content.js'], 'loadBookListWithLegacyFallback')}
        loadBookListWithLegacyFallback;
    `, {
        requestRuntimeResponse: (_message, callback) => callback(state.runtimeResponse),
        safeStorageGet: (_defaults, callback) => {
            state.legacyReads++;
            callback({ bookList: [{ id: 1, title: 'legacy' }] });
            return true;
        }
    });

    let result = null;
    state.runtimeResponse = { ok: true, bookList: [{ id: 2, title: 'canonical' }], revision: '12' };
    loadBookListWithLegacyFallback((bookList, usedLegacy, revision) => {
        result = { bookList, usedLegacy, revision };
    });
    assert.equal(result.bookList[0].title, 'canonical');
    assert.equal(result.usedLegacy, false);
    assert.equal(result.revision, 12);
    assert.equal(state.legacyReads, 0);

    state.runtimeResponse = { ok: false, error: 'worker unavailable' };
    result = null;
    loadBookListWithLegacyFallback((bookList, usedLegacy, revision) => {
        result = { bookList, usedLegacy, revision };
    });
    assert.equal(result.bookList, null);
    assert.equal(result.usedLegacy, false);
    assert.equal(result.revision, null);
    assert.equal(state.legacyReads, 0);

    loadBookListWithLegacyFallback((bookList, usedLegacy) => {
        result = { bookList, usedLegacy };
    }, true);
    assert.equal(result.bookList[0].title, 'legacy');
    assert.equal(result.usedLegacy, true);
    assert.equal(state.legacyReads, 1);

    const initialLoad = extractFunction(sources['content.js'], 'loadInitialContentData');
    const canonicalReload = extractFunction(sources['content.js'], 'reloadBookListFromSource');
    assert.match(initialLoad, /loadBookListWithLegacyFallback\s*\([\s\S]*\},\s*true\s*\)/);
    assert.match(canonicalReload, /loadBookListWithLegacyFallback\s*\(/);
    assert.doesNotMatch(canonicalReload, /safeStorageGet|\},\s*true\s*\)/);
    assert.match(canonicalReload, /if\s*\(reloadSucceeded\)\s*\{[\s\S]*replaceBookCache\s*\(\s*bookList\s*\)/);
});

test('탭 복귀나 focus 시 revision이 다르면 marker 대신 정본 목록을 재로드한다', () => {
    const state = {
        response: { ok: true, revision: 42 },
        requestedAction: null,
        clearCount: 0,
        reloadCount: 0,
        storageReadCount: 0,
        markerApplyCount: 0
    };
    const api = vm.runInNewContext(`
        let markerTokenCheckInProgress = false;
        let lastBookStoreRevision = 41;

        ${extractFunction(sources['content.js'], 'normalizeBookStoreRevision')}
        ${extractFunction(sources['content.js'], 'checkBookStoreToken')}

        ({
            checkBookStoreToken,
            isCheckInProgress: () => markerTokenCheckInProgress
        });
    `, {
        isExtensionContextValid: () => true,
        requestRuntimeResponse: (message, callback) => {
            state.requestedAction = message.action;
            callback(state.response);
        },
        clearPendingOptimisticChanges: () => {
            state.clearCount++;
        },
        reloadBookListFromSource: () => {
            state.reloadCount++;
        },
        safeStorageGet: (_defaults, callback) => {
            state.storageReadCount++;
            callback({ bookStoreChange: null });
            return true;
        },
        getBookStoreToken: () => null,
        applyBookStoreMarker: () => {
            state.markerApplyCount++;
        }
    });

    api.checkBookStoreToken();
    assert.equal(state.requestedAction, 'GET_BOOK_STORE_REVISION');
    assert.equal(state.clearCount, 1);
    assert.equal(state.reloadCount, 1);
    assert.equal(state.storageReadCount, 0);
    assert.equal(state.markerApplyCount, 0);
    assert.equal(api.isCheckInProgress(), false);

    state.response = { ok: true, revision: 41 };
    api.checkBookStoreToken();
    assert.equal(state.reloadCount, 1);
    assert.equal(state.storageReadCount, 1);
    assert.equal(api.isCheckInProgress(), false);

    const visibilityListener = extractBranch(
        sources['content.js'],
        'document.addEventListener("visibilitychange"',
        'window.addEventListener("focus"'
    );
    const focusListener = extractBranch(
        sources['content.js'],
        'window.addEventListener("focus"',
        'try {'
    );
    assert.match(visibilityListener, /document\.hidden[\s\S]*isTabStale\s*=\s*true/);
    assert.match(visibilityListener, /!document\.hidden\s*&&\s*isTabStale[\s\S]*checkBookStoreToken\s*\(\s*\)/);
    assert.match(focusListener, /if\s*\(document\.hidden\)\s*return/);
    assert.match(focusListener, /isTabStale\s*=\s*false[\s\S]*checkBookStoreToken\s*\(\s*\)/);
});

test('revision 공백이나 역순 marker는 증분 적용하지 않고 정본을 확인한다', () => {
    const applyBookStoreMarker = extractFunction(sources['content.js'], 'applyBookStoreMarker');

    assert.match(applyBookStoreMarker, /markerRevision\s*<\s*lastBookStoreRevision\)\s*return/);
    assert.match(applyBookStoreMarker, /markerRevision\s*===\s*lastBookStoreRevision[\s\S]*settlePendingOptimisticMarker/);
    assert.match(applyBookStoreMarker, /markerRevision\s*>\s*lastBookStoreRevision\s*\+\s*1[\s\S]*reloadBookListFromSource/);
    assert.match(applyBookStoreMarker, /lastBookStoreRevision\s*=\s*markerRevision/);
});

test('콘텐츠 스토리지 리스너는 marker만 증분 처리하고 무관한 변경을 무시한다', () => {
    const contentSource = sources['content.js'];
    const listenerStart = contentSource.lastIndexOf('chrome.storage.onChanged.addListener');
    const listenerBody = extractArrowListenerBody(contentSource, listenerStart);
    const calls = {
        marker: 0,
        reload: 0,
        replace: 0,
        styles: 0,
        settings: 0
    };
    const context = {
        calls,
        BM_CONTENT_SETTING_KEYS: ['allowedSites'],
        BM_STORAGE_DEFAULTS: { allowedSites: [] },
        currentStorageData: {},
        cachedBookList: [],
        setDownloadUIEnabled: () => {},
        applyBookStoreMarker: () => calls.marker++,
        applyMissingVolUpdateToCache: () => null,
        finalizeBookChangeImpact: () => {},
        getBookMissingVols: () => [],
        debouncedApplyStyles: () => calls.styles++,
        replaceBookCache: () => calls.replace++,
        reloadBookListFromSource: () => calls.reload++,
        applyDataSettings: () => calls.settings++,
        updateQuickHidePanel: () => {},
        updateManagedStyleSheet: () => {},
        invalidateAllRenderedTitleData: () => {}
    };
    const listener = vm.runInNewContext(`(changes, namespace) => ${listenerBody}`, context);

    listener({ unrelatedSetting: { newValue: true } }, 'local');
    assert.deepEqual(calls, { marker: 0, reload: 0, replace: 0, styles: 0, settings: 0 });

    listener({ bookStoreChange: { newValue: { type: 'upsert', token: '1', book: { id: 1 } } } }, 'local');
    assert.deepEqual(calls, { marker: 1, reload: 0, replace: 0, styles: 0, settings: 0 });

    listener({ bookStoreChange: { newValue: { type: 'upsert', token: '2', book: { id: 2 } } } }, 'sync');
    assert.equal(calls.marker, 1);
});

test('10,000건 콘텐츠 캐시의 증분 upsert는 대상 객체만 변경하고 길이를 유지한다', () => {
    const functionNames = [
        'getStoredBookData',
        'createEnhancedBook',
        'createBookChangeImpact',
        'addBookToImpact',
        'areBookIdsEqual',
        'upsertCachedBook',
        'deleteCachedBook',
        'applyBookStoreDelta'
    ];
    const extractedFunctions = functionNames
        .map(name => extractFunction(sources['content.js'], name))
        .join('\n');

    const currentBooks = Array.from({ length: 10000 }, (_, index) => ({
        id: index + 1,
        title: `도서 ${index + 1}`,
        type: 'incomplete',
        resolution: '1200px',
        lastVol: '10'
    }));
    const cachedBooks = currentBooks.map(book => ({
        ...book,
        missingVols: [],
        _regBodyOriginal: book.title,
        _regBodyNoSpace: book.title.replace(/\s+/g, ''),
        _editionKey: '',
        _editionState: 'standard',
        _matchKey: book.title.replace(/\s+/g, '')
    }));
    const cachedReferences = [...cachedBooks];
    const currentReferences = [...currentBooks];
    const cachedSnapshots = cachedBooks.map(book => JSON.stringify(book));

    const api = vm.runInNewContext(`
        let currentBookList = initialCurrentBooks;
        let cachedBookList = initialCachedBooks;
        let titleProcessingCache = new Map();
        let currentStorageData = { missingVolsMap: {} };

        function getBookMissingVols() {
            return [];
        }

        function getTitleMatchParts(title) {
            const baseOriginal = String(title || '');
            const baseNoSpace = baseOriginal.replace(/\\s+/g, '');
            return {
                baseOriginal,
                baseNoSpace,
                editionKey: '',
                editionState: 'standard',
                matchKey: baseNoSpace
            };
        }

        ${extractedFunctions}

        ({
            applyBookStoreDelta,
            getCurrentBooks: () => currentBookList,
            getCachedBooks: () => cachedBookList
        });
    `, {
        initialCurrentBooks: currentBooks,
        initialCachedBooks: cachedBooks
    });

    const targetIndex = 4999;
    const targetId = targetIndex + 1;
    const result = api.applyBookStoreDelta({
        type: 'upsert',
        book: {
            ...currentBooks[targetIndex],
            type: 'complete'
        }
    });
    const nextCurrentBooks = api.getCurrentBooks();
    const nextCachedBooks = api.getCachedBooks();

    assert.equal(result.applied, true);
    assert.equal(nextCurrentBooks.length, 10000);
    assert.equal(nextCachedBooks.length, 10000);
    assert.equal(nextCachedBooks[targetIndex].type, 'complete');
    assert.equal(nextCurrentBooks[targetIndex].type, 'complete');
    assert.notStrictEqual(nextCurrentBooks[targetIndex], currentReferences[targetIndex]);

    const changedCachedIds = [];
    for (let index = 0; index < nextCachedBooks.length; index++) {
        assert.strictEqual(nextCachedBooks[index], cachedReferences[index]);
        if (JSON.stringify(nextCachedBooks[index]) !== cachedSnapshots[index]) {
            changedCachedIds.push(nextCachedBooks[index].id);
        }
        if (index !== targetIndex) assert.strictEqual(nextCurrentBooks[index], currentReferences[index]);
    }
    assert.deepEqual(changedCachedIds, [targetId]);
});

test('옵션 단건 수정과 삭제는 전체 replace 경로를 사용하지 않는다', () => {
    const optionsSource = sources['options.js'];
    const singleSave = extractFunction(optionsSource, 'saveSingleBookWithUndo');
    const singleDelete = extractFunction(optionsSource, 'deleteSingleBookWithUndo');
    const bulkSave = extractFunction(optionsSource, 'saveWithUndo');

    assert.match(singleSave, /bookStorePutByTarget\s*\(/);
    assert.match(singleSave, /bookStorePublishChange\s*\(\s*\{\s*type:\s*['"]upsert['"]/);
    assert.doesNotMatch(singleSave, /bookStoreReplaceAll|bookStoreGetAll|chrome\.storage/);

    assert.match(singleDelete, /bookStoreDelete\s*\(/);
    assert.match(singleDelete, /bookStorePublishChange\s*\(\s*\{\s*type:\s*['"]delete['"]/);
    assert.doesNotMatch(singleDelete, /bookStoreReplaceAll|bookStoreGetAll|chrome\.storage/);

    assert.match(bulkSave, /bookStoreGetAllWithRevision\s*\(\s*\)/);
    assert.match(bulkSave, /hydrateRestoredBookMissingVols\s*\(\s*newList/);
    assert.match(bulkSave, /bookStoreReplaceAll\s*\(\s*listToStore\s*,\s*replaceRevision\s*\)/);
    assert.match(bulkSave, /type:\s*['"]reload['"]/);
    assert.match(bulkSave, /revision:\s*replaceResult\.revision/);
    assert.doesNotMatch(bulkSave, /backupList|chrome\.storage\.local\.(?:get|set)\s*\(\s*\{\s*bookList/);

    const singleRowBranches = extractBranch(
        optionsSource,
        "if (id && e.target.classList.contains('btn-del'))",
        "else if (id && e.target.classList.contains('btn-title-correction-bulk'))"
    );
    assert.match(singleRowBranches, /deleteSingleBookWithUndo\s*\(/);
    assert.match(singleRowBranches, /saveSingleBookWithUndo\s*\(/);
    assert.doesNotMatch(singleRowBranches, /saveWithUndo\s*\(|bookStoreReplaceAll/);
    assert.doesNotMatch(optionsSource, /backupList/);
});

test('옵션 화면은 자기 marker를 무시하고 외부 marker만 다시 렌더한다', () => {
    const optionsSource = sources['options.js'];
    const listenerStart = optionsSource.lastIndexOf('chrome.storage.onChanged.addListener');
    const listenerBody = extractArrowListenerBody(optionsSource, listenerStart);
    const scheduleExternalRender = extractFunction(optionsSource, 'scheduleExternalBookListRender');

    assert.match(listenerBody, /changes\.bookStoreChange/);
    assert.match(listenerBody, /marker\.source\s*===\s*BOOK_STORE_CONTEXT_ID/);
    assert.match(listenerBody, /scheduleExternalBookListRender\s*\(\s*\)/);
    assert.doesNotMatch(listenerBody, /changes\.bookList/);
    assert.match(scheduleExternalRender, /clearTimeout\s*\(\s*externalBookListRenderTimer\s*\)/);
    assert.match(scheduleExternalRender, /setTimeout\s*\(/);
});
