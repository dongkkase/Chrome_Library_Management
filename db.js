// db.js
var db = new Dexie('BookManagerDB');

db.version(4).stores({
    books: '++id, &cleanTitleStr, title, type, resolution, lastVol, date',
    snapshots: '++id, timestamp, dateStr'
});

// 동일한 정규화 제목을 가진 항목도 보관할 수 있도록 cleanTitleStr의 unique 제약을 제거합니다.
db.version(5).stores({
    books: '++id, cleanTitleStr, title, type, resolution, lastVol, date',
    snapshots: '++id, timestamp, dateStr',
    meta: 'key'
});

const BOOK_STORE_MIGRATION_KEY = 'bookStoreMigratedV5';
const BOOK_STORE_MIGRATION_SENTINEL = 'legacy-book-list-v5';
const BOOK_STORE_INDEX_META_KEY = 'book-index-signature';
const BOOK_STORE_REVISION_META_KEY = 'book-store-revision';
const BOOK_STORE_CHANGE_KEY = 'bookStoreChange';
const BOOK_STORE_CONTEXT_ID = `book-store-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let bookStoreReadyPromise = null;
let bookStoreIndexedSignature = null;

function getBookStoreMatchKey(title) {
    if (typeof getTitleMatchParts === 'function') {
        return getTitleMatchParts(title || '').matchKey;
    }

    return String(title || '')
        .replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '');
}

async function waitForBookStoreTitleRules() {
    if (typeof customFiltersReady !== 'undefined' && customFiltersReady) {
        await customFiltersReady;
    }
}

function getCurrentBookStoreIndexSignature() {
    if (typeof getEditionKeywordsSignature === 'function') {
        return getEditionKeywordsSignature();
    }
    return '';
}

async function reindexBookStoreForSignature(indexSignature) {
    await db.transaction('rw', db.books, db.meta, async () => {
        const indexMeta = await db.meta.get(BOOK_STORE_INDEX_META_KEY);
        if (indexMeta && indexMeta.signature === indexSignature) return;

        await db.books.toCollection().modify(book => {
            book.cleanTitleStr = getBookStoreMatchKey(book.title || '');
        });
        await db.meta.put({
            key: BOOK_STORE_INDEX_META_KEY,
            signature: indexSignature,
            completedAt: Date.now()
        });
    });
    bookStoreIndexedSignature = indexSignature;
}

async function ensureBookStoreIndexCurrent() {
    await waitForBookStoreTitleRules();
    const indexSignature = getCurrentBookStoreIndexSignature();
    if (bookStoreIndexedSignature === indexSignature) return;
    await reindexBookStoreForSignature(indexSignature);
}

function createBookStoreIndexChangedError(expectedSignature, currentSignature) {
    const error = new Error('도서 검색 설정이 변경되었습니다. 작업을 다시 시도합니다.');
    error.name = 'BookStoreIndexChangedError';
    error.expectedSignature = expectedSignature;
    error.currentSignature = currentSignature;
    return error;
}

async function assertBookStoreIndexSignatureInTransaction(expectedSignature) {
    const indexMeta = await db.meta.get(BOOK_STORE_INDEX_META_KEY);
    const currentSignature = indexMeta && typeof indexMeta.signature === 'string'
        ? indexMeta.signature
        : '';
    if (currentSignature !== expectedSignature) {
        throw createBookStoreIndexChangedError(expectedSignature, currentSignature);
    }
}

async function refreshBookStoreTitleRulesFromStorage() {
    if (typeof setEditionKeywords !== 'function') return;

    const defaultKeywords = typeof getDefaultEditionKeywords === 'function'
        ? getDefaultEditionKeywords()
        : [];
    const data = await chrome.storage.local.get({ editionKeywords: defaultKeywords });
    setEditionKeywords(data.editionKeywords);
    bookStoreIndexedSignature = null;
}

async function runBookStoreIndexTransaction(mode, operation) {
    let lastIndexError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        await ensureBookStoreIndexCurrent();
        const indexSignature = getCurrentBookStoreIndexSignature();
        try {
            return await db.transaction(mode, db.books, db.meta, async () => {
                await assertBookStoreIndexSignatureInTransaction(indexSignature);
                const result = await operation();
                const latestIndexSignature = getCurrentBookStoreIndexSignature();
                if (latestIndexSignature !== indexSignature) {
                    throw createBookStoreIndexChangedError(indexSignature, latestIndexSignature);
                }
                await assertBookStoreIndexSignatureInTransaction(indexSignature);
                return result;
            });
        } catch (error) {
            if (!error || error.name !== 'BookStoreIndexChangedError') throw error;
            lastIndexError = error;
            await refreshBookStoreTitleRulesFromStorage();
        }
    }
    throw lastIndexError || new Error('도서 검색 설정을 동기화하지 못했습니다.');
}

function prepareBookForStore(book) {
    if (!book || typeof book !== 'object') {
        throw new TypeError('저장할 도서 데이터가 올바르지 않습니다.');
    }

    const storedBook = { ...book };
    delete storedBook.cleanTitleStr;
    Object.keys(storedBook).forEach(key => {
        if (key.startsWith('_')) delete storedBook[key];
    });

    if (storedBook.id === undefined || storedBook.id === null || storedBook.id === '') {
        delete storedBook.id;
    }

    storedBook.title = String(storedBook.title || '').trim();
    if (!storedBook.title) {
        throw new TypeError('도서 제목은 비워둘 수 없습니다.');
    }

    storedBook.cleanTitleStr = getBookStoreMatchKey(storedBook.title);
    return storedBook;
}

function normalizeBulkBookId(id) {
    const numericId = typeof id === 'number'
        ? id
        : typeof id === 'string' && id.trim()
            ? Number(id)
            : NaN;

    if (!Number.isFinite(numericId) || numericId <= 0 || numericId > Number.MAX_SAFE_INTEGER) {
        return null;
    }
    return numericId;
}

function prepareBooksForBulkStore(books) {
    const preparedBooks = books.map(prepareBookForStore);
    const normalizedIds = preparedBooks.map(book => normalizeBulkBookId(book.id));
    const maxExistingId = normalizedIds.reduce((maxId, id) => {
        return id === null ? maxId : Math.max(maxId, Math.ceil(id));
    }, Date.now());
    const usedIds = new Set();
    let nextGeneratedId = maxExistingId;

    preparedBooks.forEach((book, index) => {
        const normalizedId = normalizedIds[index];
        if (normalizedId !== null && !usedIds.has(normalizedId)) {
            book.id = normalizedId;
            usedIds.add(normalizedId);
            return;
        }

        do {
            nextGeneratedId++;
            if (!Number.isSafeInteger(nextGeneratedId)) {
                throw new RangeError('도서 ID를 안전하게 생성할 수 없습니다.');
            }
        } while (usedIds.has(nextGeneratedId));

        book.id = nextGeneratedId;
        usedIds.add(nextGeneratedId);
    });

    return preparedBooks;
}

function getBookModifiedTime(book) {
    const timestamp = Date.parse(book && book.date ? book.date : '');
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function areMigrationMirrorBooks(firstBook, secondBook) {
    if (!firstBook || !secondBook) return false;
    if (String(firstBook.title || '').trim() !== String(secondBook.title || '').trim()) {
        return false;
    }
    if (getBookStoreMatchKey(firstBook.title || '') !== getBookStoreMatchKey(secondBook.title || '')) {
        return false;
    }

    const getComparableFields = book => [
        String(book.type || 'unknown'),
        String(book.resolution || ''),
        String(book.lastVol || ''),
        String(book.date || '')
    ];
    const firstFields = getComparableFields(firstBook);
    const secondFields = getComparableFields(secondBook);
    return firstFields.every((value, index) => value === secondFields[index]);
}

function hydrateBookMissingVolsFromMap(book, missingVolsMap) {
    if (!book || typeof book !== 'object' || Array.isArray(book.missingVols)) return book;
    if (!missingVolsMap || typeof missingVolsMap !== 'object') return book;

    const mappedMissingVols = missingVolsMap[String(book.id)];
    return Array.isArray(mappedMissingVols)
        ? { ...book, missingVols: [...mappedMissingVols] }
        : book;
}

function mergeBookMigrationSources(legacyBooks, existingBooks) {
    const mergedBooks = legacyBooks
        .filter(book => book && typeof book === 'object' && String(book.title || '').trim())
        .map(book => ({ ...book }));
    const idIndexes = new Map();
    const matchKeyIndexes = new Map();
    const matchedLegacyIndexes = new Set();

    const indexBook = (book, index) => {
        const normalizedId = normalizeBulkBookId(book.id);
        if (normalizedId !== null) {
            const idKey = String(normalizedId);
            if (!idIndexes.has(idKey)) idIndexes.set(idKey, []);
            idIndexes.get(idKey).push(index);
        }
        const matchKey = getBookStoreMatchKey(book.title || '');
        if (matchKey) {
            if (!matchKeyIndexes.has(matchKey)) matchKeyIndexes.set(matchKey, []);
            matchKeyIndexes.get(matchKey).push(index);
        }
    };
    mergedBooks.forEach(indexBook);

    existingBooks.forEach(rawBook => {
        const existingBook = toPublicBook(rawBook);
        if (!existingBook || !String(existingBook.title || '').trim()) return;

        const normalizedId = normalizeBulkBookId(existingBook.id);
        const matchKey = getBookStoreMatchKey(existingBook.title || '');
        const idCandidates = normalizedId === null ? [] : (idIndexes.get(String(normalizedId)) || []);
        let existingIndex = idCandidates.find(index => {
            if (matchedLegacyIndexes.has(index)) return false;
            return !!matchKey
                && getBookStoreMatchKey(mergedBooks[index] && mergedBooks[index].title) === matchKey;
        });

        if (existingIndex === undefined && matchKey) {
            const matchCandidates = matchKeyIndexes.get(matchKey) || [];
            existingIndex = matchCandidates.find(index => {
                if (matchedLegacyIndexes.has(index)) return false;
                const legacyId = normalizeBulkBookId(mergedBooks[index] && mergedBooks[index].id);
                return normalizedId === null
                    || legacyId === null
                    || areMigrationMirrorBooks(mergedBooks[index], existingBook);
            });
        }

        if (existingIndex === undefined) {
            mergedBooks.push(existingBook);
            return;
        }

        matchedLegacyIndexes.add(existingIndex);
        const legacyBook = mergedBooks[existingIndex];
        const legacyId = normalizeBulkBookId(legacyBook.id);
        const existingId = normalizeBulkBookId(existingBook.id);
        const preservedId = legacyId !== null
            ? legacyId
            : existingId !== null
                ? existingId
                : legacyBook.id ?? existingBook.id;
        mergedBooks[existingIndex] = getBookModifiedTime(existingBook) > getBookModifiedTime(legacyBook)
            ? { ...legacyBook, ...existingBook, id: preservedId }
            : { ...existingBook, ...legacyBook, id: preservedId };
    });

    return mergedBooks;
}

function normalizeBookStoreRevision(value) {
    const revision = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
            ? Number(value)
            : NaN;
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

async function getBookStoreRevisionInTransaction() {
    const revisionMeta = await db.meta.get(BOOK_STORE_REVISION_META_KEY);
    const revision = normalizeBookStoreRevision(revisionMeta && revisionMeta.revision);
    return revision === null ? 0 : revision;
}

async function ensureBookStoreRevisionMeta() {
    return db.transaction('rw', db.meta, async () => {
        const revisionMeta = await db.meta.get(BOOK_STORE_REVISION_META_KEY);
        const revision = normalizeBookStoreRevision(revisionMeta && revisionMeta.revision);
        if (revision !== null) return revision;

        await db.meta.put({
            key: BOOK_STORE_REVISION_META_KEY,
            revision: 0,
            updatedAt: Date.now()
        });
        return 0;
    });
}

async function incrementBookStoreRevisionInTransaction() {
    const currentRevision = await getBookStoreRevisionInTransaction();
    if (currentRevision >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError('도서 저장소 revision을 더 이상 증가시킬 수 없습니다.');
    }

    const revision = currentRevision + 1;
    await db.meta.put({
        key: BOOK_STORE_REVISION_META_KEY,
        revision,
        updatedAt: Date.now()
    });
    return revision;
}

function createBookStoreConflictError(expectedRevision, currentRevision) {
    const error = new Error(`도서 목록이 변경되었습니다. expected=${expectedRevision}, current=${currentRevision}`);
    error.name = 'BookStoreConflictError';
    error.expectedRevision = expectedRevision;
    error.currentRevision = currentRevision;
    return error;
}

function toPublicBook(book) {
    if (!book || typeof book !== 'object') return null;

    const publicBook = { ...book };
    delete publicBook.cleanTitleStr;
    delete publicBook._bookStoreRevision;
    return publicBook;
}

function attachBookStoreRevision(book, revision) {
    const publicBook = toPublicBook(book);
    if (!publicBook) return null;

    publicBook._bookStoreRevision = revision;
    return publicBook;
}

function toPublicChange(change) {
    if (!change || typeof change !== 'object') return change;

    const publicChange = { ...change };
    delete publicChange._bookStoreRevision;

    if (change.book) {
        publicChange.book = toPublicBook(change.book);
        return publicChange;
    }

    if (Object.prototype.hasOwnProperty.call(change, 'cleanTitleStr')) {
        return toPublicBook(change);
    }

    return publicChange;
}

async function ensureBookStoreReady() {
    if (bookStoreReadyPromise) return bookStoreReadyPromise;

    bookStoreReadyPromise = (async () => {
        await waitForBookStoreTitleRules();
        await db.open();

        const migrationState = await chrome.storage.local.get({
            [BOOK_STORE_MIGRATION_KEY]: false
        });
        const existingSentinel = await db.meta.get(BOOK_STORE_MIGRATION_SENTINEL);
        if (existingSentinel && existingSentinel.complete) {
            if (!migrationState[BOOK_STORE_MIGRATION_KEY]) {
                await chrome.storage.local.set({ [BOOK_STORE_MIGRATION_KEY]: true });
            }
            await ensureBookStoreRevisionMeta();
            await ensureBookStoreIndexCurrent();
            return;
        }

        const legacyData = await chrome.storage.local.get({ bookList: [], missingVolsMap: {} });
        const legacyBooks = Array.isArray(legacyData.bookList)
            ? legacyData.bookList.map(book => {
                return hydrateBookMissingVolsFromMap(book, legacyData.missingVolsMap);
            })
            : [];

        await db.transaction('rw', db.books, db.meta, async () => {
            const migrationSentinel = await db.meta.get(BOOK_STORE_MIGRATION_SENTINEL);
            if (migrationSentinel && migrationSentinel.complete) return;

            const existingBooks = await db.books.toArray();
            const mergedBooks = mergeBookMigrationSources(legacyBooks, existingBooks);
            const migratedBooks = prepareBooksForBulkStore(mergedBooks);
            await db.books.clear();
            if (migratedBooks.length > 0) await db.books.bulkPut(migratedBooks);
            const storedCount = await db.books.count();
            if (storedCount !== migratedBooks.length) {
                throw new Error('도서 목록 마이그레이션 건수가 일치하지 않습니다.');
            }
            await db.meta.put({
                key: BOOK_STORE_MIGRATION_SENTINEL,
                complete: true,
                legacyCount: legacyBooks.length,
                existingCount: existingBooks.length,
                migratedCount: migratedBooks.length,
                completedAt: Date.now()
            });
            await db.meta.put({
                key: BOOK_STORE_INDEX_META_KEY,
                signature: getCurrentBookStoreIndexSignature(),
                completedAt: Date.now()
            });
            const revisionMeta = await db.meta.get(BOOK_STORE_REVISION_META_KEY);
            if (normalizeBookStoreRevision(revisionMeta && revisionMeta.revision) === null) {
                await db.meta.put({
                    key: BOOK_STORE_REVISION_META_KEY,
                    revision: 0,
                    updatedAt: Date.now()
                });
            }
        });

        await ensureBookStoreRevisionMeta();
        await chrome.storage.local.set({ [BOOK_STORE_MIGRATION_KEY]: true });
        bookStoreIndexedSignature = getCurrentBookStoreIndexSignature();
    })().catch(error => {
        bookStoreReadyPromise = null;
        throw error;
    });

    return bookStoreReadyPromise;
}

async function bookStoreGetAll() {
    const result = await bookStoreGetAllWithRevision();
    return result.bookList;
}

async function bookStoreGetAllWithRevision() {
    await ensureBookStoreReady();

    return db.transaction('r', db.books, db.meta, async () => {
        const [books, revision] = await Promise.all([
            db.books.toArray(),
            getBookStoreRevisionInTransaction()
        ]);
        return {
            bookList: books.map(toPublicBook),
            revision
        };
    });
}

async function bookStoreGetRevision() {
    await ensureBookStoreReady();
    return db.transaction('r', db.meta, () => getBookStoreRevisionInTransaction());
}

async function bookStoreGet(id) {
    await ensureBookStoreReady();
    if (id === undefined || id === null) return null;

    let book = await db.books.get(id);
    if (!book && typeof id === 'string' && id.trim() && Number.isFinite(Number(id))) {
        book = await db.books.get(Number(id));
    }
    return toPublicBook(book);
}

async function bookStoreFindByMatchKey(matchKey) {
    await ensureBookStoreReady();
    const normalizedMatchKey = String(matchKey || '');
    if (!normalizedMatchKey) return null;

    const book = await runBookStoreIndexTransaction('r', () => {
        return db.books.where('cleanTitleStr').equals(normalizedMatchKey).last();
    });
    return toPublicBook(book);
}

async function findStoredBookByTarget(target) {
    const requestedId = target && target.id !== undefined ? target.id : null;
    let book = requestedId === null ? null : await db.books.get(requestedId);
    if (!book && typeof requestedId === 'string' && requestedId.trim() && Number.isFinite(Number(requestedId))) {
        book = await db.books.get(Number(requestedId));
    }

    const matchKey = target && target.title
        ? getBookStoreMatchKey(target.title)
        : String(target && target.matchKey ? target.matchKey : '');
    if (!book && matchKey) {
        book = await db.books.where('cleanTitleStr').equals(matchKey).last();
    }
    return book || null;
}

async function bookStorePutByTarget(target, updateBook) {
    const result = await bookStorePutManyByTarget([{ target, updateBook }]);
    return result.books[0] || null;
}

async function bookStorePutManyByTarget(entries) {
    await ensureBookStoreReady();
    if (!Array.isArray(entries)) {
        throw new TypeError('도서 변경 목록이 올바르지 않습니다.');
    }

    const normalizedEntries = entries.map(entry => {
        if (!entry || typeof entry !== 'object' || typeof entry.updateBook !== 'function') {
            throw new TypeError('도서 변경 함수가 필요합니다.');
        }
        return {
            target: entry.target && typeof entry.target === 'object' ? entry.target : {},
            updateBook: entry.updateBook
        };
    });

    if (normalizedEntries.length === 0) {
        const revision = await db.transaction('r', db.meta, () => {
            return getBookStoreRevisionInTransaction();
        });
        return { books: [], revision };
    }

    const mutationResult = await runBookStoreIndexTransaction('rw', async () => {
        const storedBooks = [];
        for (const entry of normalizedEntries) {
            const existingStoredBook = await findStoredBookByTarget(entry.target);
            const existingBook = toPublicBook(existingStoredBook);
            const nextBook = entry.updateBook(existingBook);
            if (!nextBook || typeof nextBook !== 'object' || typeof nextBook.then === 'function') {
                throw new TypeError('도서 변경 결과가 올바르지 않습니다.');
            }

            const storedBook = prepareBookForStore(nextBook);
            if (existingStoredBook) storedBook.id = existingStoredBook.id;
            const id = await db.books.put(storedBook);
            storedBooks.push({ ...storedBook, id });
        }

        const revision = await incrementBookStoreRevisionInTransaction();
        return { storedBooks, revision };
    });

    return {
        books: mutationResult.storedBooks.map(book => {
            return attachBookStoreRevision(book, mutationResult.revision);
        }),
        revision: mutationResult.revision
    };
}

async function bookStoreDeleteByTarget(target) {
    await ensureBookStoreReady();

    const mutationResult = await runBookStoreIndexTransaction('rw', async () => {
        const existingBook = await findStoredBookByTarget(target || {});
        if (!existingBook) return null;

        await db.books.delete(existingBook.id);
        const revision = await incrementBookStoreRevisionInTransaction();
        return { book: existingBook, revision };
    });
    if (!mutationResult) return null;
    return attachBookStoreRevision(mutationResult.book, mutationResult.revision);
}

async function bookStorePut(book) {
    await ensureBookStoreReady();

    const mutationResult = await runBookStoreIndexTransaction('rw', async () => {
        const storedBook = prepareBookForStore(book);
        const id = await db.books.put(storedBook);
        const revision = await incrementBookStoreRevisionInTransaction();
        return { storedBook, id, revision };
    });
    return attachBookStoreRevision(
        { ...mutationResult.storedBook, id: mutationResult.id },
        mutationResult.revision
    );
}

async function bookStoreDelete(id) {
    if (id === undefined || id === null) return null;
    return bookStoreDeleteByTarget({ id });
}

async function bookStoreReplaceAll(books, expectedRevision = null) {
    await ensureBookStoreReady();

    const normalizedExpectedRevision = expectedRevision === null || expectedRevision === undefined
        ? null
        : normalizeBookStoreRevision(expectedRevision);
    if (expectedRevision !== null && expectedRevision !== undefined && normalizedExpectedRevision === null) {
        throw new TypeError('expectedRevision이 올바르지 않습니다.');
    }

    const sourceBooks = Array.isArray(books) ? books : [];
    const result = await runBookStoreIndexTransaction('rw', async () => {
        const currentRevision = await getBookStoreRevisionInTransaction();
        if (normalizedExpectedRevision !== null && currentRevision !== normalizedExpectedRevision) {
            throw createBookStoreConflictError(normalizedExpectedRevision, currentRevision);
        }

        const nextBooks = prepareBooksForBulkStore(sourceBooks);
        await db.books.clear();
        if (nextBooks.length > 0) await db.books.bulkPut(nextBooks);
        const storedCount = await db.books.count();
        if (storedCount !== nextBooks.length) {
            throw new Error('교체한 도서 목록 건수가 일치하지 않습니다.');
        }
        const revision = await incrementBookStoreRevisionInTransaction();
        return { count: nextBooks.length, revision };
    });

    return result;
}

async function bookStoreReindexAll() {
    await ensureBookStoreReady();
    await waitForBookStoreTitleRules();
    bookStoreIndexedSignature = null;
    await ensureBookStoreIndexCurrent();
}

async function bookStorePublishChange(change, legacyType, legacyPayload = {}) {
    let changePayload;
    if (change && typeof change === 'object' && !Array.isArray(change)) {
        changePayload = change;
    } else {
        changePayload = {
            ...(legacyPayload && typeof legacyPayload === 'object' ? legacyPayload : {}),
            type: legacyType
        };
    }

    const explicitRevision = normalizeBookStoreRevision(changePayload.revision);
    const inferredRevisions = [];
    const collectRevision = value => {
        const revision = normalizeBookStoreRevision(value && value._bookStoreRevision);
        if (revision !== null) inferredRevisions.push(revision);
    };
    collectRevision(changePayload.book);
    if (Array.isArray(changePayload.books)) changePayload.books.forEach(collectRevision);
    if (Array.isArray(changePayload.changes)) {
        changePayload.changes.forEach(item => {
            collectRevision(item);
            collectRevision(item && item.book);
        });
    }
    const markerRevision = explicitRevision !== null
        ? explicitRevision
        : inferredRevisions.length > 0
            ? Math.max(...inferredRevisions)
            : null;

    const marker = {
        ...changePayload,
        source: BOOK_STORE_CONTEXT_ID,
        token: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: String(changePayload.type || 'reload')
    };
    delete marker._bookStoreRevision;
    delete marker.revision;
    if (markerRevision !== null) marker.revision = markerRevision;

    if (changePayload.book) marker.book = toPublicBook(changePayload.book);
    if (Array.isArray(changePayload.books)) marker.books = changePayload.books.map(toPublicBook);
    if (Array.isArray(changePayload.changes)) {
        marker.changes = changePayload.changes.map(toPublicChange);
    }

    await chrome.storage.local.set({ [BOOK_STORE_CHANGE_KEY]: marker });
    return marker;
}
