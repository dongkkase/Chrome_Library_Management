const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sources = Object.fromEntries(['download-book-update.js', 'background.js', 'db.js', 'content.js', 'options.js', 'common.js']
    .map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const api = vm.runInNewContext(`${sources['common.js']}\n${sources['download-book-update.js']}\nDownloadBookUpdate;`);
const categories = vm.runInNewContext(`${sources['common.js']}\n({normalizeBookCategory, getBookCategoryLabel});`);
const plain = value => JSON.parse(JSON.stringify(value));
const book = extra => ({ id: 1, title: '예시 도서', type: 'incomplete', lastVol: '6', resolution: '1500px', folderRule: '만화', ...extra });
const update = (existing, title, missing = existing?.missingVols || []) => api.updateBook(existing, '예시 도서', api.parseTitle(title), missing);

function extract(file, name) {
    const source = sources[file];
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

test('6권에서 9권 다운로드 후 7권과 8권을 채워도 최고 권수가 내려가지 않는다', () => {
    const nine = update(book(), '예시 도서 9권 [1500px]');
    assert.equal(nine.lastVol, '9');
    assert.equal(nine.type, 'incomplete');
    assert.deepEqual(plain(nine.missingVols), [7, 8]);
    assert.equal(nine.folderRule, '만화');
    assert.equal(nine.resolution, '1500px');
    const seven = update(nine, '예시 도서 7권');
    assert.equal(seven.lastVol, '9');
    assert.deepEqual(plain(seven.missingVols), [8]);
    const eight = update(seven, '예시 도서 8권');
    assert.equal(eight.lastVol, '9');
    assert.deepEqual(plain(eight.missingVols), []);
    assert.equal(update(eight, '예시 도서 8권'), null);
});

test('완결 표시는 상태를 변경하되 이전 최고 권수는 유지한다', () => {
    const completed = update(book({ lastVol: '9', missingVols: [7, 8] }), '예시 도서 7권 (완결)');
    assert.equal(completed.type, 'complete');
    assert.equal(completed.lastVol, '9');
    assert.deepEqual(plain(completed.missingVols), [8]);
    const filled = update(completed, '예시 도서 8권');
    assert.equal(filled.type, 'complete');
    assert.equal(filled.lastVol, '9');
    assert.deepEqual(plain(filled.missingVols), []);
    assert.equal(update(filled, '예시 도서 9권'), null);
    assert.equal(update(filled, '예시 도서 10권').type, 'incomplete');
});

test('미등록 도서를 등록하며 단권과 전체 범위를 구분한다', () => {
    const single = update(null, '예시 도서 3권 [2000px]');
    assert.equal(single.title, '예시 도서');
    assert.equal(single.type, 'incomplete');
    assert.equal(single.lastVol, '3');
    assert.equal(single.resolution, '2000px');
    assert.deepEqual(plain(single.missingVols), [1, 2]);
    const complete = update(null, '예시 도서 1~9권 (완결)');
    assert.equal(complete.type, 'complete');
    assert.equal(complete.lastVol, '9');
    assert.deepEqual(plain(complete.missingVols), []);
});

test('권수 범위, 개별 목록, 총 권수 및 해상도를 구분한다', () => {
    const cases = [
        ['예시 도서 7~9권', [7, 8, 9]],
        ['예시 도서 7권~9권', [7, 8, 9]],
        ['예시 도서 7-9 [1500px]', [7, 8, 9]],
        ['예시 도서 7,9권', [7, 9]],
        ['예시 도서 7권, 9권', [7, 9]],
        ['예시 도서 7~9,11권', [7, 8, 9, 11]],
        ['예시 도서 (총3권) 완결', [1, 2, 3]],
        ['예시 도서 2권 (총3권)', [2]],
        ['예시 도서 9 [1500px] (완결)', [9]],
        ['예시 도서 [1500px]', []],
        ['예시 도서 9권 [1500px] 21,000MB', [9]],
        ['예시 도서 1000000000권', []]
    ];
    for (const [title, expected] of cases) assert.deepEqual(plain(api.parseTitle(title).volumes), expected, title);
});

test('범위에 포함된 누락만 해제하고 건너뛴 권수 및 다른 누락은 보존한다', () => {
    const next = update(book({ missingVols: [2, 5] }), '예시 도서 7~9권');
    assert.deepEqual(plain(next.missingVols), [2, 5]);
    const sparse = update(book({ missingVols: [2] }), '예시 도서 7,9권');
    assert.deepEqual(plain(sparse.missingVols), [2, 8]);
    const full = update(next, '예시 도서 1~9권 완결');
    assert.deepEqual(plain(full.missingVols), []);
});

test('권수 불명 시 임의 숫자를 저장하지 않고 완결만 반영한다', () => {
    assert.equal(update(book(), '예시 도서 [1500px]'), null);
    const completed = update(book({ missingVols: [2] }), '예시 도서 완결 [1500px]');
    assert.equal(completed.lastVol, '6');
    assert.equal(completed.type, 'complete');
    assert.deepEqual(plain(completed.missingVols), [2]);
    assert.equal(api.parseTitle('예시 도서 9권 미완결').complete, false);
    assert.equal(api.parseTitle('예시 도서 9권 완결 예정').complete, false);
});

function createStoreHarness(initialBook = book(), initialMissing = {}, preferences = {}) {
    let currentBook = initialBook;
    let revision = 0;
    let writes = 0;
    let failStorage = false;
    const settings = { enableShortcuts: true, autoUpdateDownloadBook: true, missingVolsMap: initialMissing, ...preferences };
    const markers = [];
    const toasts = [];
    const context = vm.createContext({
        URL, DownloadBookUpdate: api, customFiltersReady: Promise.resolve(),
        ensureBookStoreReady: async () => {},
        bookStoreWithSyncLock: callback => callback(),
        runBookStoreIndexTransaction: async (_mode, callback) => {
            const previousBook = currentBook;
            const previousRevision = revision;
            try { return await callback(); }
            catch (error) { currentBook = previousBook; revision = previousRevision; throw error; }
        },
        findStoredBookByTarget: async () => currentBook,
        toPublicBook: value => value,
        prepareBookForStore: value => ({ ...value }),
        attachBookStoreRevision: (value, nextRevision) => ({ ...value, _bookStoreRevision: nextRevision }),
        incrementBookStoreRevisionInTransaction: async () => ++revision,
        db: { books: { put: async value => { currentBook = { ...value, id: value.id || 1 }; writes++; return currentBook.id; } } },
        Dexie: { waitFor: value => value },
        chrome: { storage: { local: {
            get: async defaults => ({ ...defaults, ...settings }),
            set: async patch => {
                if (failStorage) throw new Error('storage failure');
                Object.assign(settings, patch);
            }
        } } },
        bookStorePublishChange: async value => markers.push(plain(value)),
        sendTabMessage: (_id, value) => toasts.push(plain(value))
    });
    vm.runInContext([
        extract('common.js', 'getBookMissingVols'),
        extract('db.js', 'bookStoreApplyDownloadUpdate'),
        extract('background.js', 'isShortcutDownloadSender'),
        extract('background.js', 'handleDownloadBookUpdate')
    ].join('\n'), context);
    return {
        settings, markers, toasts,
        update: (sourceTitle, hostname = 'lamu.club') => context.handleDownloadBookUpdate(
            { title: '예시 도서', sourceTitle, bookId: 1 }, { url: `https://${hostname}/bbs/board.php`, tab: { id: 1 } }),
        get currentBook() { return currentBook; },
        get writes() { return writes; },
        failStorage: () => { failStorage = true; }
    };
}

test('저장된 최신 도서와 누락 지도 기준으로 갱신하고 DB, 설정, 변경 알림에 반영한다', async () => {
    const harness = createStoreHarness(book({ missingVols: [4] }), { '1': [2], 'other': [3] });
    const result = await harness.update('예시 도서 9권');
    assert.equal(result.ok, true);
    assert.deepEqual(plain(harness.currentBook.missingVols), [2, 7, 8]);
    assert.deepEqual(plain(harness.settings.missingVolsMap), { '1': [2, 7, 8], 'other': [3] });
    assert.equal(harness.markers[0].book.lastVol, '9');
    assert.equal(harness.markers[0].reason, 'shortcut-download');
    await harness.update('예시 도서 7권');
    assert.equal(harness.currentBook.lastVol, '9');
    assert.deepEqual(plain(harness.settings.missingVolsMap['1']), [2, 8]);
    assert.equal(harness.toasts.length, 2);
    await harness.update('예시 도서 7권');
    assert.equal(harness.writes, 2);
    assert.equal(harness.markers.length, 2);
});

test('부모/하위 옵션 OFF 및 미지원/유사 도메인에서는 저장하지 않는다', async () => {
    for (const preferences of [{ enableShortcuts: false }, { autoUpdateDownloadBook: false }, { autoUpdateDownloadBook: undefined }]) {
        const harness = createStoreHarness(book(), {}, preferences);
        assert.equal((await harness.update('예시 도서 9권')).skipped, true);
        assert.equal(harness.writes, 0);
    }
    const harness = createStoreHarness();
    for (const domain of ['example.org', 'nottcafe21.com', 'lamu.club.example.org', 'chating.wiki.example.org', 'notchating.wiki']) {
        assert.equal((await harness.update('예시 도서 9권', domain)).skipped, true);
    }
    assert.equal(harness.writes, 0);
    for (const domain of ['tcafe21.com', 'lamu.club', 'chating.wiki', 'www.tcafe21.com', 'www.lamu.club', 'www.chating.wiki']) {
        const supported = createStoreHarness();
        assert.equal((await supported.update('예시 도서 9권', domain)).book.lastVol, '9');
        assert.deepEqual(plain(supported.currentBook.missingVols), [7, 8]);
        assert.equal(supported.writes, 1);
    }
});

test('미등록 도서는 새 ID로 등록하고 저장 실패는 성공 알림을 내보내지 않는다', async () => {
    const harness = createStoreHarness(null);
    await harness.update('예시 도서 1~9권 완결');
    assert.equal(harness.currentBook.id, 1);
    assert.equal(harness.currentBook.type, 'complete');
    assert.deepEqual(plain(harness.settings.missingVolsMap['1']), []);
    const failure = createStoreHarness();
    failure.failStorage();
    await assert.rejects(failure.update('예시 도서 9권'), /storage failure/);
    assert.equal(failure.currentBook.lastVol, '6');
    assert.equal(failure.markers.length, 0);
    assert.equal(failure.toasts.length, 0);
});

test('단축키 옵션을 끄면 두 하위 설정값은 보존하며 조작만 비활성화한다', () => {
    const elements = {
        enableShortcutsCheckbox: { checked: false },
        autoUpdateDownloadBookCheckbox: { checked: false, disabled: true },
        searchEverythingOnDownloadCheckbox: { checked: false, disabled: true }
    };
    const apply = vm.runInNewContext(`${extract('options.js', 'updateShortcutSettingsUI')}\nupdateShortcutSettingsUI;`, {
        document: { getElementById: id => elements[id] }
    });
    apply({ enableShortcuts: true, autoUpdateDownloadBook: true, searchEverythingOnDownload: true });
    assert.equal(elements.autoUpdateDownloadBookCheckbox.disabled, false);
    assert.equal(elements.searchEverythingOnDownloadCheckbox.disabled, false);
    apply({ enableShortcuts: false });
    assert.equal(elements.autoUpdateDownloadBookCheckbox.checked, true);
    assert.equal(elements.autoUpdateDownloadBookCheckbox.disabled, true);
    assert.equal(elements.searchEverythingOnDownloadCheckbox.checked, true);
    assert.equal(elements.searchEverythingOnDownloadCheckbox.disabled, true);
    apply({ enableShortcuts: true });
    assert.equal(elements.autoUpdateDownloadBookCheckbox.checked, true);
    assert.equal(elements.autoUpdateDownloadBookCheckbox.disabled, false);
    assert.equal(elements.searchEverythingOnDownloadCheckbox.checked, true);
    assert.equal(elements.searchEverythingOnDownloadCheckbox.disabled, false);
    apply({ searchEverythingOnDownload: false });
    assert.equal(elements.searchEverythingOnDownloadCheckbox.checked, false);
    assert.equal(elements.autoUpdateDownloadBookCheckbox.checked, true);
});

function createDownloadButtonHarness(existingBook = book(), sourceTitle = '예시 도서 9권', targetType = 'GIGAFILE', options = {}) {
    let shortcut = false;
    let button;
    let updateCallback;
    const messages = [];
    const errors = [];
    const context = {
        document: { createElement: () => ({ dataset: {}, style: {} }) },
        window: { prompt: () => options.choice === undefined ? '1' : options.choice },
        normalizeBookCategory: categories.normalizeBookCategory,
        getBookCategoryLabel: categories.getBookCategoryLabel,
        BookCategoryUI: { getRegistrationCategory: () => options.registrationCategory || 'uncategorized' },
        BookShortcuts: { isDownloadTrigger: () => shortcut },
        showInfoToast: (message, isError) => { if (isError) errors.push(message); },
        getResolvedSiteTitle: () => ({ title: '예시 도서', bookId: existingBook?.id ?? null }),
        getResolvedTitleMatchParts: () => ({ editionKey: '', matchKey: '예시도서' }),
        getTitleMatchParts: () => ({ editionKey: '', matchKey: '예시도서' }),
        findMatchingBook: () => options.candidates
            ? { book: null, ambiguous: true, candidates: options.candidates }
            : { book: existingBook },
        sendRuntimeMessage: message => messages.push(message),
        requestRuntimeResponse: (message, callback) => {
            messages.push(message);
            if (message.action === 'AUTO_UPDATE_DOWNLOAD_BOOK') updateCallback = callback;
            else callback({ ok: true });
        },
        setTimeout: () => {}
    };
    const createButton = vm.runInNewContext(`
        ${extract('content.js', 'sanitizeDownloadFolderSegment')}
        ${extract('content.js', 'buildDownloadFolder')}
        ${extract('content.js', 'selectBookCategoryCandidate')}
        ${extract('content.js', 'createButton')}
        createButton;
    `, context);
    createButton({ insertAdjacentElement: (_position, element) => { button = element; } },
        'https://download.example/9', '', targetType, '예시 도서', false, sourceTitle);
    return {
        messages, errors, getButton: () => button,
        click(isShortcut = true) {
            shortcut = isShortcut;
            try { button.onclick({ preventDefault() {} }); }
            finally { shortcut = false; }
        },
        respond: response => updateCallback(response)
    };
}

test('일반 클릭은 바로 다운로드하고 단축키는 갱신 응답 이후 다운로드와 검색을 실행한다', () => {
    const harness = createDownloadButtonHarness();
    harness.click(false);
    assert.deepEqual(harness.messages.map(message => message.action), ['DOWNLOAD_GIGAFILE']);
    harness.click();
    assert.deepEqual(harness.messages.map(message => message.action), ['DOWNLOAD_GIGAFILE', 'AUTO_UPDATE_DOWNLOAD_BOOK']);
    assert.equal(harness.messages[1].title, '예시 도서');
    assert.equal(harness.messages[1].sourceTitle, '예시 도서 9권');
    assert.equal(harness.messages[1].bookId, 1);
    harness.respond({ ok: true, book: update(book(), '예시 도서 9권') });
    assert.deepEqual(harness.messages.map(message => message.action), [
        'DOWNLOAD_GIGAFILE', 'AUTO_UPDATE_DOWNLOAD_BOOK', 'DOWNLOAD_GIGAFILE', 'SEARCH_EVERYTHING_ON_DOWNLOAD'
    ]);
    assert.equal(harness.messages[2].title, '(미완)예시 도서');
    assert.equal(harness.messages[3].title, '예시 도서');
});

test('미등록 신권의 첫 다운로드부터 미완 폴더명과 새 도서 ID를 적용한다', () => {
    for (const targetType of ['GIGAFILE', 'GOFILE', 'TRANSFERIT', 'BUZZHEAVIER']) {
        const harness = createDownloadButtonHarness(null, '예시 도서 9권', targetType);
        harness.click();
        const savedBook = { ...update(null, '예시 도서 9권'), id: 42 };
        harness.respond({ ok: true, book: savedBook });
        const download = harness.messages.find(message => message.action === `DOWNLOAD_${targetType}`);
        assert.equal(download.title, '(미완)예시 도서', targetType);
        assert.equal(download.downloadFolder, '(미완)예시 도서', targetType);
        assert.equal(download.bookId, 42, targetType);
    }
});

test('완결 도서의 신권으로 미완 전환 시 상위 폴더 규칙과 갱신 상태를 함께 적용한다', () => {
    const existing = book({ type: 'complete', folderRule: '만화/연재' });
    const harness = createDownloadButtonHarness(existing);
    harness.click();
    harness.respond({ ok: true, book: update(existing, '예시 도서 9권') });
    const download = harness.messages.find(message => message.action === 'DOWNLOAD_GIGAFILE');
    assert.equal(download.title, '(미완)예시 도서');
    assert.equal(download.downloadFolder, '만화/연재/(미완)예시 도서');
});

test('완결로 갱신한 다운로드에는 이전 미완 상태의 접두사를 붙이지 않는다', () => {
    const existing = book();
    const harness = createDownloadButtonHarness(existing, '예시 도서 9권 완결');
    harness.click();
    harness.respond({ ok: true, book: update(existing, '예시 도서 9권 완결') });
    const download = harness.messages.find(message => message.action === 'DOWNLOAD_GIGAFILE');
    assert.equal(download.title, '예시 도서');
    assert.equal(download.downloadFolder, '만화/예시 도서');
});

test('자동 갱신 OFF나 실패 시에는 기존 상태로 다운로드와 검색을 계속한다', () => {
    for (const response of [{ ok: true, skipped: true }, { ok: false }, null]) {
        const harness = createDownloadButtonHarness();
        harness.click();
        harness.respond(response);
        const downloads = harness.messages.filter(message => message.action === 'DOWNLOAD_GIGAFILE');
        assert.equal(downloads.length, 1);
        assert.equal(downloads[0].downloadFolder, '만화/(미완)예시 도서');
        assert.equal(harness.messages.at(-1).action, 'SEARCH_EVERYTHING_ON_DOWNLOAD');
        assert.equal(harness.errors.length, response?.ok === false ? 1 : 0);
    }
});

test('동명작 다운로드는 명시적으로 선택한 분류의 저장 제목과 ID로만 갱신한다', () => {
    const selected = book({ id: 8, title: '예시 도서의 긴 정정 제목', categoryId: 'pdf' });
    const harness = createDownloadButtonHarness(null, '예시 도서 9권', 'GIGAFILE', {
        candidates: [book({ categoryId: 'comic' }), selected], choice: '2', registrationCategory: 'comic'
    });
    harness.click();
    const updateMessage = harness.messages.find(message => message.action === 'AUTO_UPDATE_DOWNLOAD_BOOK');
    assert.equal(updateMessage.bookId, 8);
    assert.equal(updateMessage.categoryId, 'pdf');
    assert.equal(updateMessage.title, selected.title);
    assert.equal(updateMessage.sourceTitle, '예시 도서 9권');
});

test('동명작 다운로드 대상 선택을 취소하면 저장·다운로드를 수행하지 않고 버튼을 복구한다', () => {
    const harness = createDownloadButtonHarness(null, '예시 도서 9권', 'GIGAFILE', {
        candidates: [book({ categoryId: 'comic' }), book({ id: 2, categoryId: 'epub' })], choice: null
    });
    harness.click();
    assert.equal(harness.messages.length, 0);
    assert.equal(harness.getButton().style.pointerEvents, 'auto');
});

test('Buzzheavier 공유 주소는 정확한 호스트와 12자리 ID만 받아 HTTPS 주소로 정리한다', () => {
    const normalize = vm.runInNewContext(`${extract('content.js', 'normalizeBuzzheavierShareUrl')}\nnormalizeBuzzheavierShareUrl;`, { URL });
    for (const url of [
        'https://buzzheavier.com/pk6ep0d4zf24',
        'http://buzzheavier.com/pk6ep0d4zf24/',
        'https://www.buzzheavier.com:443/pk6ep0d4zf24/?source=test#download',
        'http://www.buzzheavier.com:80/pk6ep0d4zf24'
    ]) assert.equal(normalize(url), 'https://buzzheavier.com/pk6ep0d4zf24', url);
    assert.equal(normalize('https://BUZZHEAVIER.COM/AbCdEf123456'), 'https://buzzheavier.com/AbCdEf123456');
    for (const url of [
        'https://notbuzzheavier.com/pk6ep0d4zf24',
        'https://buzzheavier.com.example.org/pk6ep0d4zf24',
        'https://files.buzzheavier.com/pk6ep0d4zf24',
        'https://buzzheavier.com@evil.example/pk6ep0d4zf24',
        'https://user@buzzheavier.com/pk6ep0d4zf24',
        'https://buzzheavier.com:8443/pk6ep0d4zf24',
        'https://buzzheavier.com:80/pk6ep0d4zf24',
        'http://buzzheavier.com:443/pk6ep0d4zf24',
        'ftp://buzzheavier.com/pk6ep0d4zf24',
        'https://buzzheavier.com/',
        'https://buzzheavier.com/about',
        'https://buzzheavier.com/pk6ep0d4zf2',
        'https://buzzheavier.com/pk6ep0d4zf245',
        'https://buzzheavier.com/pk6ep0d4zf24/download',
        'https://buzzheavier.com/pk6ep0d4zf24%2F',
        'invalid URL'
    ]) assert.equal(normalize(url), '', url);
});

function createDirectDownloadRoutingHarness(url, mode, allowedDLs = ['buzzheavier']) {
    const buttons = [];
    const messages = [];
    const toasts = [];
    let downloadResponse;
    const input = { value: url, getAttribute: () => url };
    const container = {
        textContent: mode === 'special-text' ? `예시 도서 9권 ${url}` : '예시 도서 9권',
        parentElement: null,
        querySelectorAll: () => mode === 'input' ? [input] : []
    };
    const source = {
        href: mode === 'anchor' ? url : '',
        textContent: mode === 'label' ? url : mode === 'anchor' ? '파일 링크' : '탭열기',
        children: [],
        classList: { contains: () => false },
        parentElement: container,
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => container,
        insertAdjacentElement: (_position, button) => buttons.push(button)
    };
    const context = {
        URL,
        window: { location: { hostname: 'library.example' } },
        document: {
            title: '예시 도서 9권',
            createElement: () => ({ dataset: {}, style: {} }),
            querySelector: () => null,
            querySelectorAll: selector => selector === 'a'
                ? (['anchor', 'label'].includes(mode) ? [source] : [])
                : (['input', 'special-text'].includes(mode) ? [source] : [])
        },
        PRE_DEFINED_SITES: [],
        globalDetailSelector: '',
        isSupportSingleCharEnabled: false,
        getTitleTextContent: element => element.textContent,
        hasTranslationEditionMarker: () => false,
        getResolvedSiteTitle: () => ({ title: '예시 도서', bookId: 1 }),
        getResolvedTitleMatchParts: () => ({ editionKey: '', matchKey: '예시도서' }),
        getTitleMatchParts: () => ({ editionKey: '', matchKey: '예시도서' }),
        findMatchingBook: () => ({ book: book() }),
        BookShortcuts: { isDownloadTrigger: () => false },
        sendRuntimeMessage: message => messages.push(message),
        requestRuntimeResponse(message, callback) {
            messages.push(message);
            downloadResponse = callback;
        },
        showInfoToast: message => toasts.push(message),
        setTimeout() {}
    };
    const inject = vm.runInNewContext([
        extract('content.js', 'normalizeBuzzheavierShareUrl'),
        extract('content.js', 'sanitizeDownloadFolderSegment'),
        extract('content.js', 'buildDownloadFolder'),
        extract('content.js', 'injectDirectDownloadButtons'),
        'injectDirectDownloadButtons;'
    ].join('\n'), context);
    inject(allowedDLs);
    return {
        buttons, messages, toasts,
        click: () => buttons[0].onclick({ preventDefault() {} }),
        respond: response => downloadResponse(response)
    };
}

test('Buzzheavier 링크·표시 텍스트·발급 입력란에서 같은 다운로드 요청을 만든다', () => {
    for (const mode of ['anchor', 'label', 'input', 'special-text']) {
        const harness = createDirectDownloadRoutingHarness('https://www.buzzheavier.com:443/pk6ep0d4zf24/?source=gofile.io#download', mode,
            ['giga', 'gofile', 'transfer', 'buzzheavier']);
        assert.equal(harness.buttons.length, 1, mode);
        assert.equal(harness.buttons[0].dataset.downloadUrl, 'https://buzzheavier.com/pk6ep0d4zf24', mode);
        harness.click();
        assert.equal(harness.messages.length, 1, mode);
        assert.equal(harness.messages[0].action, 'DOWNLOAD_BUZZHEAVIER', mode);
        assert.equal(harness.messages[0].url, 'https://buzzheavier.com/pk6ep0d4zf24', mode);
        assert.equal(harness.messages[0].downloadFolder, '만화/(미완)예시 도서', mode);
        assert.ok(harness.toasts[0].includes('Buzzheavier'), mode);
    }
});

test('Buzzheavier 응답을 받으면 성공·오류·확인 요청 뒤 바로 버튼을 다시 사용할 수 있다', () => {
    for (const response of [{ ok: true }, { ok: false, code: 'verification-required' }, null]) {
        const harness = createDirectDownloadRoutingHarness('https://buzzheavier.com/pk6ep0d4zf24', 'anchor');
        harness.click();
        assert.equal(harness.buttons[0].style.pointerEvents, 'none');
        harness.respond(response);
        assert.equal(harness.buttons[0].style.pointerEvents, 'auto');
        assert.match(harness.buttons[0].innerHTML, /바로다운로드/);
    }
});

test('Buzzheavier 비허용·유사 도메인·잘못된 경로에는 다운로드 버튼을 만들지 않는다', () => {
    for (const mode of ['anchor', 'label', 'input', 'special-text']) {
        assert.equal(createDirectDownloadRoutingHarness('https://buzzheavier.com/pk6ep0d4zf24', mode, ['gofile']).buttons.length, 0, mode);
        for (const url of [
            'https://buzzheavier.com.evil.example/pk6ep0d4zf24',
            'https://evil.buzzheavier.com/pk6ep0d4zf24',
            'https://buzzheavier.com/about',
            'https://buzzheavier.com/pk6ep0d4zf24/download',
            'https://buzzheavier.com/pk6ep0d4zf245'
        ]) assert.equal(createDirectDownloadRoutingHarness(url, mode).buttons.length, 0, `${mode}: ${url}`);
    }
});

test('Buzzheavier를 함께 허용해도 기존 호스트의 링크·발급 입력란 라우팅을 유지한다', () => {
    for (const mode of ['anchor', 'input']) {
        for (const [url, action] of [
            ['https://10.gigafile.nu/1234-example', 'DOWNLOAD_GIGAFILE'],
            ['https://gofile.io/d/example', 'DOWNLOAD_GOFILE'],
            ['https://transfer.it/s/example', 'DOWNLOAD_TRANSFERIT'],
            ['https://hellkdis.net/s/example', 'OPEN_HELLKDIS_WITH_PW']
        ]) {
            const harness = createDirectDownloadRoutingHarness(url, mode, ['giga', 'gofile', 'transfer', 'hk', 'buzzheavier']);
            assert.equal(harness.buttons.length, 1, `${mode}: ${url}`);
            harness.click();
            assert.equal(harness.messages[0].action, action, `${mode}: ${url}`);
        }
    }
});

test('기존 다운로드 지원 사이트와 동적 링크·사용자 추가 사이트에 Buzzheavier를 허용한다', () => {
    const source = sources['content.js'];
    const start = source.indexOf('const PRE_DEFINED_SITES = [');
    const end = source.indexOf('\n];', start) + 3;
    assert.ok(start >= 0 && end > start);
    const calls = [];
    const heading = { textContent: 'https://buzzheavier.com/pk6ep0d4zf24', innerHTML: '' };
    const material = { dataset: {}, querySelector: () => heading };
    const sites = vm.runInNewContext(`${source.slice(start, end)}\nPRE_DEFINED_SITES;`, {
        document: { querySelectorAll: () => [{ closest: () => material }] },
        injectDirectDownloadButtons: allowed => calls.push(allowed)
    });
    for (const site of sites.filter(site => site.allowedDLs.length)) assert.ok(site.allowedDLs.includes('buzzheavier'), site.url);
    sites.find(site => site.url === 'chating.wiki').customJS();
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('buzzheavier'));
    const defaults = source.match(/else if \(matchedUserSite\) \{[\s\S]*?globalAllowedDLs = (\[[^\]]+\]);/);
    assert.ok(defaults);
    assert.ok(vm.runInNewContext(defaults[1]).includes('buzzheavier'));
});
