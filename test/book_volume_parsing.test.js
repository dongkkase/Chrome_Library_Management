const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sources = Object.fromEntries(['common.js', 'download-book-update.js', 'background.js', 'options.js']
    .map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const quietConsole = { log() {}, error() {} };
const api = vm.runInNewContext(`${sources['common.js']}\n${sources['download-book-update.js']}
    ({ cleanSiteTitle, getBookVolume, DownloadBookUpdate });`, { console: quietConsole });
const plain = value => JSON.parse(JSON.stringify(value));
const cases = [
    ['[어느새] S급 병약 에스퍼가 광공을 길들임 1-4E (1-4)', 'S급 병약 에스퍼가 광공을 길들임', 4, [1, 2, 3, 4]],
    ['[유화과] 오후의 소네트 3E (1-3)', '오후의 소네트', 3, [1, 2, 3]],
    ['[이드] 어나더 선샤인 (Another Sunshine) 3E (1-3)', '어나더 선샤인', 3, [1, 2, 3]],
    ['[오토auto]19층 도서관 시리즈 (12)', '19층 도서관 시리즈', 12, []],
    ['[연희담]9회말 2아웃 러버 완외 (4+1)', '9회말 2아웃 러버', 4, []]
];

for (const [raw, title, volume, included] of cases) {
    test(`제목 및 모든 등록 경로의 권수: ${raw}`, () => {
        assert.equal(api.cleanSiteTitle(raw), title);
        for (const mode of ['site', 'context', 'bulk']) {
            assert.equal(api.getBookVolume(raw, mode), volume, mode);
        }
        const metadata = api.DownloadBookUpdate.parseTitle(raw);
        assert.equal(metadata.lastVolume, volume);
        assert.deepEqual(plain(metadata.volumes), included);
        assert.equal(metadata.complete, false);
    });
}

test('E 단권과 범위, 소문자, 전각 표기를 권수로 처리하고 명시된 범위를 보존한다', () => {
    for (const [suffix, volume, included] of [
        ['3E', 3, [3]], ['3e', 3, [3]], ['3 E', 3, [3]], ['３Ｅ', 3, [3]],
        ['1-4E', 4, [1, 2, 3, 4]], ['2～4E', 4, [2, 3, 4]],
        ['3E (1-3)', 3, [1, 2, 3]], ['3E (1-5)', 5, [1, 2, 3, 4, 5]],
        ['3E (12)', 3, [3]], ['3E (완결)', 3, [3]], ['3E [1500px]', 3, [3]]
    ]) {
        const raw = `예시 도서 ${suffix}`;
        assert.equal(api.cleanSiteTitle(raw), '예시 도서', raw);
        for (const mode of ['site', 'context', 'bulk']) assert.equal(api.getBookVolume(raw, mode), volume, raw);
        const metadata = api.DownloadBookUpdate.parseTitle(raw);
        assert.equal(metadata.lastVolume, volume, raw);
        assert.deepEqual(plain(metadata.volumes), included, raw);
    }
});

test('후행 해상도와 판본은 보존하며 괄호 권수보다 명시된 권수와 화수를 우선한다', () => {
    const raw = '예시 도서 3E (1-3) [1500px] (개정판)';
    assert.equal(api.cleanSiteTitle(raw), '예시 도서(개정판)');
    assert.equal(api.DownloadBookUpdate.parseTitle(raw).resolution, '1500px');
    for (const suffix of ['2권 (12)', '2화 (12)', '2권 3E', '2화 3E (1-3)', '2권 완외 (4+1)']) {
        const title = `예시 도서 ${suffix}`;
        for (const mode of ['site', 'context', 'bulk']) assert.equal(api.getBookVolume(title, mode), 2, suffix);
        assert.deepEqual(plain(api.DownloadBookUpdate.parseTitle(title).volumes), [2], suffix);
    }
});

test('제목 안의 숫자와 E 및 외전 단어는 유지한다', () => {
    for (const title of [
        '19층 도서관 시리즈', '9회말 2아웃 러버', '클래스 3E의 비밀',
        '모델3E', '3E 클래스', '예시 도서 외전', '완외라는 제목', '예시 도서 완외의 비밀'
    ]) {
        assert.equal(api.cleanSiteTitle(title), title);
        assert.equal(api.getBookVolume(title), 0, title);
        assert.equal(api.DownloadBookUpdate.parseTitle(title).lastVolume, 0, title);
    }
    assert.equal(api.cleanSiteTitle('예시 도서 완외'), '예시 도서');
    assert.equal(api.getBookVolume('예시 도서 완외'), 0);
    for (const title of ['Ⅰ의 이야기', '①의 이야기', '１２층 도서관', 'ＡＢＣ 이야기']) {
        assert.equal(api.cleanSiteTitle(`${title} ３Ｅ`), title);
        assert.equal(api.cleanSiteTitle(`${title} (12)`), title);
    }
});

test('단위 없는 연령과 연도, 용량, 잘못된 E 및 일반 덧셈 괄호는 새 권수로 추정하지 않는다', () => {
    for (const suffix of [
        '(15)', '(19)', '(2024)', '(0)', '(100001)', '(12MB)', '(4+1)',
        '0E', '100001E', '3E의 비밀', '3Ebook', '3E (등급)', '3.5E'
    ]) {
        const raw = `예시 도서 ${suffix}`;
        for (const mode of ['site', 'context', 'bulk']) assert.equal(api.getBookVolume(raw, mode), 0, raw);
        assert.equal(api.DownloadBookUpdate.parseTitle(raw).lastVolume, 0, raw);
    }
});

test('기존 권수, 화수, 범위, 총 권수 및 경로별 부 표기 지원을 유지한다', () => {
    for (const [raw, volume] of [
        ['예시 도서 7권', 7], ['예시 도서 7화', 7], ['예시 도서 2~7권', 7],
        ['예시 도서 2권-7권', 7], ['예시 도서 (총7권)', 7], ['예시 도서 7', 7],
        ['예시 도서 [1500px]', 0], ['예시 도서 1~1500px', 0]
    ]) {
        for (const mode of ['site', 'context', 'bulk']) assert.equal(api.getBookVolume(raw, mode), volume, `${raw}: ${mode}`);
    }
    assert.equal(api.getBookVolume('예시 도서 3부', 'bulk'), 3);
    assert.equal(api.getBookVolume('예시 도서 3부터 시작', 'bulk'), 0);
    assert.equal(api.getBookVolume('예시 도서 7 [1500px]', 'context'), 7);
});

test('포함 범위 없는 괄호 권수는 기존 누락과 최고 권수를 보존한다', () => {
    const existing = { id: 1, title: '예시 도서', type: 'incomplete', lastVol: '3', missingVols: [2] };
    for (const [suffix, expected] of [['(12)', '12'], ['완외 (4+1)', '4']]) {
        const metadata = api.DownloadBookUpdate.parseTitle(`예시 도서 ${suffix}`);
        const updated = api.DownloadBookUpdate.updateBook(existing, existing.title, metadata, [2]);
        assert.equal(updated.lastVol, expected);
        assert.deepEqual(plain(updated.missingVols), [2]);
        const newBook = api.DownloadBookUpdate.updateBook(null, existing.title, metadata);
        assert.equal(newBook.lastVol, expected);
        assert.deepEqual(plain(newBook.missingVols), []);
    }
    assert.equal(api.DownloadBookUpdate.updateBook({ ...existing, lastVol: '12' }, existing.title,
        api.DownloadBookUpdate.parseTitle('예시 도서 완외 (4+1)'), [2]), null);
    const filled = api.DownloadBookUpdate.updateBook(existing, existing.title,
        api.DownloadBookUpdate.parseTitle('예시 도서 3E (1-3)'), [2]);
    assert.deepEqual(plain(filled.missingVols), []);
    assert.equal(filled.type, 'incomplete');
});

function section(file, startText, endText) {
    const source = sources[file];
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}

test('일괄 등록 미리보기와 저장은 제보된 제목과 권수를 동일하게 사용한다', async () => {
    let preview;
    let pendingSave;
    let stored;
    const elements = {
        bulkInput: { value: '', addEventListener: (_name, callback) => { preview = callback; } },
        bulkPreview: { style: {}, innerHTML: '' },
        bulkTypeSelect: { value: 'incomplete' },
        saveBtn: { style: {}, innerText: '저장' }
    };
    const context = vm.createContext({ console: quietConsole });
    vm.runInContext(sources['common.js'], context);
    Object.assign(context, {
        bulkInput: elements.bulkInput, bulkPreview: elements.bulkPreview,
        document: { getElementById: id => elements[id] },
        chrome: { storage: { local: { set() {} } } },
        setTimeout: callback => { pendingSave = callback(); },
        ensureBookStoreReady: async () => {},
        bookStoreGetAllWithRevision: async () => ({ bookList: [], revision: 1 }),
        saveWithUndo: async books => { stored = books; },
        showInfoToast: message => assert.fail(message)
    });
    vm.runInContext(section('options.js', "bulkInput.addEventListener('input'", 'document.body.onclick ='), context);
    for (const [raw, title, volume] of cases) {
        elements.bulkInput.value = raw;
        await preview();
        assert.ok(elements.bulkPreview.innerHTML.includes(`>${title}</span>`), raw);
        assert.ok(elements.bulkPreview.innerHTML.includes(`>${volume}</span>`), raw);
    }
    elements.bulkInput.value = cases.map(([raw]) => raw).join('\n');
    await elements.saveBtn.onclick();
    await pendingSave;
    assert.equal(stored.length, cases.length);
    for (const [, title, volume] of cases) {
        assert.equal(stored.find(book => book.title === title)?.lastVol, String(volume), title);
    }
});

test('우클릭 등록은 제보된 제목과 권수를 저장 큐에 전달한다', async () => {
    let listener;
    let rawTitle;
    let queued;
    const context = vm.createContext({ console: quietConsole });
    vm.runInContext(sources['common.js'], context);
    Object.assign(context, {
        chrome: { contextMenus: { onClicked: { addListener: callback => { listener = callback; } } } },
        resolveContextMenuClickContext: async () => ({ title: rawTitle }),
        enqueueBookMutation: callback => callback(),
        processSaveQueue: async tasks => { queued = tasks; }
    });
    vm.runInContext(section('background.js', 'function sanitizeBookTitleForStorage(', 'function normalizeExactBookTitle('), context);
    vm.runInContext(section('background.js', 'chrome.contextMenus.onClicked.addListener(', 'function executeEverythingSearch('), context);
    for (const [raw, title, volume] of cases) {
        rawTitle = raw;
        await listener({ menuItemId: 'addIncomplete' }, { id: 1 });
        assert.equal(queued[0].cleanTitle, title);
        assert.equal(queued[0].lastVol, String(volume));
    }
});
