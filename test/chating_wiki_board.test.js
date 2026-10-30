const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const browserPath = [
    process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(candidate => candidate && fs.existsSync(candidate));

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} 함수를 찾을 수 없습니다.`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}') depth--;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`${name} 함수의 끝을 찾을 수 없습니다.`);
}

test('채팅위키 게시판: 새 목록 구조와 기존 목록의 매칭 및 퀵메뉴', {
    skip: !browserPath && 'CHROME_BIN에 Chromium 실행 파일을 지정하세요.'
}, async t => {
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'chating-wiki-board-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(directory)), temporaryRoot);
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    const commonSource = fs.readFileSync(path.join(root, 'common.js'), 'utf8');
    const uiSource = fs.readFileSync(path.join(root, 'book-ui.js'), 'utf8');
    const configStart = source.indexOf('const PRE_DEFINED_SITES = [');
    const configEnd = source.indexOf('\nlet globalAllowedDLs', configStart);
    assert.ok(configStart >= 0 && configEnd > configStart, '실제 사이트 설정을 찾을 수 없습니다.');
    const siteConfigs = source.slice(configStart, configEnd);
    const functions = [
        'hasSiteTranslationEdition', 'getTitleTextContent', 'getChatingWikiListTitle', 'getPureLinkText',
        'normalizeTitleCorrectionKeyPart', 'getTitleCorrectionKey', 'normalizeStoredTitleCorrection',
        'getResolvedSiteTitle', 'getResolvedTitleMatchParts', 'getResolvedLinkTitle', 'getResolvedQuickActionTitle',
        'calculateLevenshtein', 'getSimilarity', 'findMatchingBook',
        'syncSiteTitleColorBadges', 'getListRenderTargets', 'getDetailRenderTargets', 'setManagedTitleStyle',
        'clearManagedTitleStyles', 'removeBadge', 'createQuickActions', 'applyStyleToSingleLink', 'applyStyleToDetailElement'
    ].map(name => extractFunction(source, name)).join('\n');
    const script = `
        const chrome = { runtime: { getURL: value => new URL(value, ${JSON.stringify(pathToFileURL(root + path.sep).href)}).href } };
        ${commonSource}
        ${uiSource}
        const api = (function(window) {
            ${siteConfigs}
            const config = PRE_DEFINED_SITES.find(site => site.url === 'chating.wiki');
            const globalHideSelector = config.hideSelector;
            const titleCorrections = {};
            let currentStorageData = {};
            const ensureQuickUIStyles = () => {};
            const isSupportSingleCharEnabled = false;
            const isShowListQuickBtn = true, isAllowedBoard = true;
            const isHideExclude = false, isHideComplete = false, isHideNew = false;
            let isHideIncomplete = false, isHideTranslate = false;
            const levRow0 = new Int32Array(256), levRow1 = new Int32Array(256);
            const exactMatchCache = {};
            let similarityCache = {};
            const cachedBookList = ['먼작귀', '나이트런 나이트폴', '먼작귀(번역판)'].map((title, index) => {
                const parts = getTitleMatchParts(title);
                return {
                    id: index + 1, title, type: 'incomplete', resolution: '1500px', lastVol: '5',
                    _regBodyOriginal: parts.baseOriginal, _regBodyNoSpace: parts.baseNoSpace,
                    _editionKey: parts.editionKey, _editionState: parts.editionState, _matchKey: parts.matchKey
                };
            });
            const messages = [];
            const sendRuntimeMessage = message => messages.push(message);
            ${functions}
            return {
                config, messages, getPureLinkText, getChatingWikiListTitle,
                hasSiteTranslationEdition, applyStyleToSingleLink, applyStyleToDetailElement,
                setQuickPreferences: settings => { currentStorageData = settings; },
                setHide: settings => {
                    isHideIncomplete = !!settings.incomplete;
                    isHideTranslate = !!settings.translate;
                },
                reset: () => {
                    isHideIncomplete = false;
                    isHideTranslate = false;
                    similarityCache = {};
                    currentStorageData = {};
                    messages.length = 0;
                }
            };
        })({
            location: { hostname: 'chating.wiki', href: 'https://chating.wiki/게시판/남성향/만화-웹툰' },
            getComputedStyle: window.getComputedStyle.bind(window)
        });
        ${runBoardTests.toString()}
        const results = runBoardTests(api);
        document.body.replaceChildren();
        const output = document.createElement('pre');
        output.id = 'results';
        output.textContent = JSON.stringify(results);
        document.body.appendChild(output);
    `;
    fs.writeFileSync(path.join(directory, 'test.js'), script);
    const page = path.join(directory, 'test.html');
    fs.writeFileSync(page, `<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'book-ui.css')).href}"><body><script src="test.js"></script></body></html>`);
    const browser = spawnSync(browserPath, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-extensions',
        `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', pathToFileURL(page).href
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(browser.error);
    assert.equal(browser.status, 0, browser.stderr);
    const match = browser.stdout.match(/<pre id="results">([\s\S]*?)<\/pre>/);
    assert.ok(match, `브라우저 테스트 결과가 없습니다: ${browser.stderr}\n${browser.stdout}`);
    const results = JSON.parse(match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    assert.equal(results.length, 12, '필수 브라우저 테스트가 실행되지 않았습니다.');
    for (const result of results) {
        await t.test(result.name, () => assert.equal(result.ok, true, result.error));
    }
});

function runBoardTests(api) {
    const results = [];
    const title = '먼작귀 (먼가 작고 귀여운 녀석 / 치이카와) 1권-5권 (1500px)';

    function assert(condition, message = '조건이 일치하지 않습니다.') {
        if (!condition) throw new Error(message);
    }

    function check(name, run) {
        api.reset();
        document.body.replaceChildren();
        try {
            run();
            results.push({ name, ok: true });
        } catch (error) {
            results.push({ name, ok: false, error: error.stack });
        }
    }

    function createRow(legacy = false, titleText = title) {
        const row = document.createElement(legacy ? 'a' : 'div');
        row.className = 'cw-board-item has-material is-secret-material has-selectable-title';
        row.setAttribute('role', 'row');
        row.dataset.postId = '180165';
        row.dataset.attributes = '펌|구작|만화|웹추출|1500px이상|미완결';
        const href = '/게시판/남성향/만화-웹툰/글/180165';
        const titleTag = legacy ? 'span' : 'a';
        const tags = '<span class="cw-board-item__tags"><i>펌</i><i>구작</i><i>만화</i><i>웹추출</i><i>1500px이상</i><i>미완결</i><span class="cw-board-item__material-tags"><i data-kind="cost">● 200P</i><i data-kind="expiry">● 28D 23:28:06</i></span></span>';
        const headline = `<span class="cw-board-item__headline"><strong><span class="cw-post-media" role="img" aria-label="이미지 · 링크"><span class="cw-post-media__icon is-image" aria-hidden="true"><svg viewBox="0 0 24 24"><title>이미지 아이콘</title><path d="M5 3h14"></path></svg></span></span>${titleText}</strong><em class="cw-board-item__comments" aria-label="댓글 0개">0</em></span>`;
        row.innerHTML = `<${titleTag} class="cw-board-item__title" ${legacy ? '' : `href="${href}" role="cell"`}>${headline}${legacy ? '' : tags}</${titleTag}>${legacy ? tags : ''}<span class="cw-board-item__meta"><span class="cw-board-item__recommend" role="cell">2/0</span><span class="cw-board-item__views" role="cell">31</span><time class="cw-board-item__time" role="cell" datetime="2026-10-19T02:33:30.562Z">31분 전</time></span>`;
        if (legacy) row.href = href;
        document.body.appendChild(row);
        return { row, link: legacy ? row : row.querySelector('.cw-board-item__title') };
    }

    function clickSearch(row, expectedTitle) {
        const button = Array.from(row.querySelectorAll('.bm-quick-actions button'))
            .find(candidate => candidate.textContent === '구글검색');
        assert(button, '검색 퀵버튼이 없습니다.');
        const previousCount = api.messages.length;
        button.click();
        assert(api.messages.length === previousCount + 1, '퀵버튼의 메시지가 전송되지 않았습니다.');
        const message = api.messages[previousCount];
        assert(message.action === 'QUICK_ACTION' && message.type === 'search', JSON.stringify(message));
        assert(message.cleanTitle === expectedTitle, `잘못 전송된 제목: ${message.cleanTitle}`);
    }

    check('사이트 선택자는 새 제목 링크와 기존 게시물 링크를 각각 한 번 선택', () => {
        const current = createRow();
        const legacy = createRow(true);
        const selected = Array.from(document.querySelectorAll(api.config.selector));
        assert(selected.length === 2, `선택된 요소: ${selected.length}`);
        assert(selected[0] === current.link && selected[1] === legacy.link, '게시물 제목 링크가 선택되지 않았습니다.');
        assert(selected.every(link => link.tagName === 'A'), '목록 처리 대상으로 링크가 아닌 요소가 선택되었습니다.');
    });

    for (const legacy of [false, true]) {
        const label = legacy ? '기존 구조' : '새 구조';
        check(`${label}: 댓글, 속성, 자료 정보, 아이콘을 제외한 원본 제목 추출`, () => {
            const { row, link } = createRow(legacy);
            const before = row.innerHTML;
            assert(api.getPureLinkText(link) === title, api.getPureLinkText(link));
            assert(api.getChatingWikiListTitle(row.querySelector('strong')) === title);
            assert(row.innerHTML === before, '제목 추출이 원본 DOM을 변경했습니다.');
        });

        check(`${label}: 일치 도서 뱃지와 퀵메뉴 위치 및 반복 렌더링 유지`, () => {
            const { row, link } = createRow(legacy);
            const metadata = row.querySelector('.cw-board-item__meta');
            const metadataBefore = metadata.outerHTML;
            api.applyStyleToSingleLink(link);
            assert(link._bmData.originalText === title && link._bmData.pureTitle === '먼작귀');
            assert(link._bmData.siteRes === 1500 && link._bmData.siteVol === 5);
            assert(link._bmData.matchedBookId === 1, `도서 ID: ${link._bmData.matchedBookId}`);
            const badge = row.querySelector('.book-badge');
            const actions = row.querySelector('.bm-quick-actions.list-actions');
            assert(badge?.parentElement === row.querySelector('.cw-board-item__title'), '뱃지 위치가 잘못되었습니다.');
            assert(badge.textContent.includes('(100%)'), badge.textContent);
            assert(actions?.parentElement === row.querySelector('.cw-board-item__tags'), '퀵메뉴 위치가 잘못되었습니다.');
            assert(row.querySelector('strong').dataset.bmTitleStyled === 'true', '제목 스타일이 적용되지 않았습니다.');
            clickSearch(row, '먼작귀');
            for (let index = 0; index < 3; index++) api.applyStyleToSingleLink(link);
            assert(row.querySelectorAll('.book-badge').length === 1, '뱃지가 중복되었습니다.');
            assert(row.querySelectorAll('.bm-quick-actions').length === 1, '퀵메뉴가 중복되었습니다.');
            assert(row.querySelector('.book-badge') === badge && row.querySelector('.bm-quick-actions') === actions, '변경 없는 제목을 반복 렌더링했습니다.');
            assert(link._bmData.originalText === title && link._bmData.raw === title, '렌더링된 UI가 제목 캐시를 오염시켰습니다.');
            assert(metadata.outerHTML === metadataBefore, '조회수와 작성시간이 변경되었습니다.');
        });
    }

    check('새 구조: 미등록 게시물에도 퀵메뉴를 표시하고 실제 제목 전송', () => {
        const { row, link } = createRow(false, '테스트 미등록 도서 1권 (1500px)');
        api.applyStyleToSingleLink(link);
        assert(link._bmData.matchedBookId === null && !row.querySelector('.book-badge'));
        assert(row.querySelectorAll('.bm-quick-actions').length === 1);
        clickSearch(row, '테스트 미등록 도서');
    });

    check('새 구조: 동적으로 바뀐 제목을 퀵버튼과 재매칭에 즉시 반영', () => {
        const { row, link } = createRow();
        api.applyStyleToSingleLink(link);
        row.querySelector('strong').textContent = '나이트런 나이트폴 5권 (1500px)';
        clickSearch(row, '나이트런 나이트폴');
        api.applyStyleToSingleLink(link);
        assert(link._bmData.matchedBookId === 2, `도서 ID: ${link._bmData.matchedBookId}`);
        assert(link._bmData.originalText === '나이트런 나이트폴 5권 (1500px)');
        assert(row.querySelectorAll('.book-badge').length === 1 && row.querySelectorAll('.bm-quick-actions').length === 1);
        clickSearch(row, '나이트런 나이트폴');
    });

    check('새 구조: 숨김 설정은 메타정보를 포함한 게시물 행 전체에 적용 및 해제', () => {
        const { row, link } = createRow();
        const metadata = row.querySelector('.cw-board-item__meta');
        api.setHide({ incomplete: true });
        api.applyStyleToSingleLink(link);
        assert(row.style.display === 'none' && row.style.getPropertyPriority('display') === 'important', '행 전체가 숨겨지지 않았습니다.');
        assert(getComputedStyle(row).display === 'none' && metadata.getClientRects().length === 0, '메타정보가 화면에 남아 있습니다.');
        assert(link.dataset.bmShouldHide === 'true');
        api.setHide({});
        api.applyStyleToSingleLink(link);
        assert(row.style.display === '' && getComputedStyle(row).display !== 'none');
        assert(metadata.getClientRects().length > 0 && link.dataset.bmShouldHide === 'false', '숨김 해제 후 메타정보가 복원되지 않았습니다.');
    });

    check('새 구조: 행의 번역 속성으로 판본 매칭, 퀵메뉴 제목 및 번역 숨김 적용', () => {
        const { row, link } = createRow();
        assert(!api.hasSiteTranslationEdition(link));
        row.dataset.attributes += '|번역';
        api.setHide({ translate: true });
        api.applyStyleToSingleLink(link);
        assert(api.hasSiteTranslationEdition(link) && link._bmData.hasSiteTranslationEdition);
        assert(link._bmData.matchedBookId === 3 && link._bmData.pureTitle === '먼작귀(번역판)');
        assert(row.style.display === 'none', '번역 게시물이 숨겨지지 않았습니다.');
        clickSearch(row, '먼작귀(번역판)');
        api.setHide({});
        api.applyStyleToSingleLink(link);
        assert(row.style.display === '', '번역 숨김 설정 해제가 반영되지 않았습니다.');
    });

    check('새 구조: strong이 없는 제목도 댓글, 태그와 미디어 설명 제외', () => {
        const { row, link } = createRow();
        const strong = row.querySelector('strong');
        strong.replaceWith(...strong.childNodes);
        assert(api.getPureLinkText(link) === title, api.getPureLinkText(link));
        api.applyStyleToSingleLink(link);
        assert(link._bmData.matchedBookId === 1);
        clickSearch(row, '먼작귀');
    });

    check('새 구조: 퀵 버튼 설정 변경은 제목과 매칭을 유지하며 목록 메뉴에 반영', () => {
        const { row, link } = createRow();
        api.applyStyleToSingleLink(link);
        const original = row.querySelector('.bm-quick-actions');
        const matchedId = link._bmData.matchedBookId;
        api.setQuickPreferences({ quickButtonsCompact: true, quickButtonVisibility: { search: false } });
        api.applyStyleToSingleLink(link);
        const compact = row.querySelector('.bm-quick-actions');
        assert(compact !== original && !compact.querySelector('[data-action="search"]'), '숨김 설정이 기존 메뉴에 반영되지 않았습니다.');
        assert(compact.querySelector('[data-action="copy"] img'), '아이콘 표시가 반영되지 않았습니다.');
        assert(link._bmData.matchedBookId === matchedId && link._bmData.originalText === title, '옵션 변경이 제목이나 매칭을 바꿨습니다.');
        api.applyStyleToSingleLink(link);
        assert(row.querySelector('.bm-quick-actions') === compact, '같은 설정에서 메뉴를 반복 생성했습니다.');
        api.setQuickPreferences({ quickButtonVisibility: Object.fromEntries(['category', ...BookMatchUI.quickButtons.map(button => button.action)].map(action => [action, false])) });
        api.applyStyleToSingleLink(link);
        const hidden = row.querySelector('.bm-quick-actions');
        assert(hidden.hidden && getComputedStyle(hidden).display === 'none', '빈 퀵 메뉴가 화면에 남았습니다.');
        assert(row.querySelectorAll('.book-badge').length === 1, '도서 배지가 사라지거나 중복되었습니다.');
        api.setQuickPreferences({});
        api.applyStyleToSingleLink(link);
        clickSearch(row, '먼작귀');
    });

    check('상세 구조: 속성 영역의 퀵 메뉴는 설정 변경을 반영하고 기본 표시로 복원', () => {
        const header = document.createElement('div');
        header.className = 'cw-article-header';
        const heading = document.createElement('h1');
        heading.textContent = title;
        const attributes = document.createElement('div');
        attributes.className = 'cw-article-attributes';
        header.append(heading, attributes);
        document.body.appendChild(header);
        api.applyStyleToDetailElement(heading);
        const original = attributes.querySelector('.bm-quick-actions');
        assert(original && heading.querySelectorAll('.bm-quick-actions').length === 0, '상세 메뉴가 속성 영역에 생성되지 않았습니다.');
        api.setQuickPreferences({ quickButtonsCompact: true, quickButtonVisibility: { copy: false } });
        api.applyStyleToDetailElement(heading);
        const compact = attributes.querySelector('.bm-quick-actions');
        assert(compact !== original && !compact.querySelector('[data-action="copy"]'), '상세 메뉴 숨김이 반영되지 않았습니다.');
        assert(compact.querySelector('[data-action="search"] img'), '상세 메뉴 아이콘 모드가 반영되지 않았습니다.');
        api.applyStyleToDetailElement(heading);
        assert(attributes.querySelector('.bm-quick-actions') === compact, '변경 없는 상세 메뉴를 다시 생성했습니다.');
        api.setQuickPreferences({});
        api.applyStyleToDetailElement(heading);
        const restored = attributes.querySelector('.bm-quick-actions');
        assert(restored.querySelector('[data-action="copy"]').textContent === '복사', '상세 메뉴 기본 표시가 복원되지 않았습니다.');
        assert(header.querySelectorAll('.bm-quick-actions').length === 1 && heading.querySelectorAll('.book-badge').length === 1, '상세 메뉴나 배지가 중복되었습니다.');
    });

    return results;
}
