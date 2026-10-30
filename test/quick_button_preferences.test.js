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
    let depth = 0;
    for (let index = source.indexOf('{', start); index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`${name} 함수가 닫히지 않았습니다.`);
}

test('퀵 버튼 표시 설정과 아이콘 모드는 실제 DOM에서도 동작한다', {
    skip: !browserPath && 'CHROME_BIN에 Chromium 실행 파일을 지정하세요.'
}, async t => {
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'quick-button-preferences-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(directory)), temporaryRoot);
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const uiSource = fs.readFileSync(path.join(root, 'book-ui.js'), 'utf8');
    const commonSource = fs.readFileSync(path.join(root, 'common.js'), 'utf8');
    const categorySource = fs.readFileSync(path.join(root, 'category-ui.js'), 'utf8');
    const motionSource = fs.readFileSync(path.join(root, 'library-motion.js'), 'utf8');
    const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    const script = `
        const chrome = { runtime: { getURL: value => new URL(value, ${JSON.stringify(pathToFileURL(root + path.sep).href)}).href } };
        ${commonSource}
        ${motionSource}
        ${categorySource}
        ${uiSource}
        const api = (() => {
            let currentStorageData = {};
            const timers = [], messages = [], copied = [], toasts = [];
            const navigator = { clipboard: { writeText: async title => { copied.push(title); } } };
            const setTimeout = callback => { timers.push(callback); return timers.length; };
            const ensureQuickUIStyles = () => {};
            const getResolvedQuickActionTitle = data => ({ title: data.pureTitle, isCorrected: false });
            const escapeToastText = value => value;
            const showActionToast = (...args) => toasts.push(args);
            const showInfoToast = (...args) => toasts.push(args);
            const sendRuntimeMessage = message => messages.push(message);
            const isSupportSingleCharEnabled = false, isShowListQuickBtn = true, isAllowedBoard = true;
            const isHideExclude = false, isHideComplete = false, isHideIncomplete = false;
            const isHideTranslate = false, isHideNew = false, globalHideSelector = '';
            const syncSiteTitleColorBadges = () => {};
            const hasSiteTranslationEdition = () => false;
            const hasTranslationEditionMarker = () => false;
            const getChatingWikiListTitle = () => null;
            const getPureLinkText = () => '테스트 도서';
            const getResolvedSiteTitle = title => ({ title });
            const getResolvedTitleMatchParts = value => ({ baseOriginal: value.title, baseNoSpace: '테스트도서', matchKey: '테스트도서' });
            const getBookVolume = () => 0;
            const normalizeBookCategory = value => value || 'uncategorized';
            const findMatchingBook = () => ({ book: { id: 1, title: '테스트 도서', type: 'complete', lastVol: '1' }, candidates: [], maxScore: 100 });
            const clearManagedTitleStyles = () => {};
            const setManagedTitleStyle = (element, property, value) => element.style.setProperty(property, value);
            const removeBadge = () => {};
            ${extractFunction(contentSource, 'createRegistrationCategoryControl')}
            ${extractFunction(contentSource, 'createQuickActions')}
            ${extractFunction(contentSource, 'getListRenderTargets')}
            ${extractFunction(contentSource, 'getDetailRenderTargets')}
            ${extractFunction(contentSource, 'applyStyleToSingleLink')}
            ${extractFunction(contentSource, 'applyStyleToDetailElement')}
            return {
                create: (hasBook = true, matchCandidates = []) => createQuickActions({ pureTitle: '테스트 도서', matchCandidates }, hasBook),
                render: (element, detail) => detail ? applyStyleToDetailElement(element) : applyStyleToSingleLink(element),
                settings: value => { currentStorageData = value; },
                messages, copied, toasts,
                flushTimers: async () => {
                    await Promise.resolve();
                    await Promise.resolve();
                    while (timers.length) timers.shift()();
                },
                reset: () => {
                    currentStorageData = {};
                    timers.length = messages.length = copied.length = toasts.length = 0;
                }
            };
        })();
        ${runQuickButtonTests.toString()}
        runQuickButtonTests(api).then(results => {
            document.body.replaceChildren();
            const output = document.createElement('pre');
            output.id = 'results';
            output.textContent = JSON.stringify(results);
            document.body.appendChild(output);
        });
    `;
    fs.writeFileSync(path.join(directory, 'test.js'), script);
    const page = path.join(directory, 'test.html');
    const styles = ['book-ui.css', 'category-ui.css'].map(name => `<link rel="stylesheet" href="${pathToFileURL(path.join(root, name)).href}">`).join('');
    fs.writeFileSync(page, `<!doctype html><html lang="ko"><meta charset="utf-8">${styles}<body><script src="test.js"></script></body></html>`);
    const browser = spawnSync(browserPath, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-extensions',
        `--user-data-dir=${path.join(directory, 'profile')}`, '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(page).href
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(browser.error);
    assert.equal(browser.status, 0, browser.stderr);
    const match = browser.stdout.match(/<pre id="results">([\s\S]*?)<\/pre>/);
    assert.ok(match, `브라우저 테스트 결과가 없습니다: ${browser.stderr}\n${browser.stdout}`);
    const results = JSON.parse(match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    assert.equal(results.length, 12, '필수 브라우저 테스트가 모두 실행되어야 합니다.');
    for (const result of results) {
        await t.test(result.name, () => assert.equal(result.ok, true, result.error));
    }
});

async function runQuickButtonTests(api) {
    const results = [];
    function assert(condition, message = '조건이 일치하지 않습니다.') {
        if (!condition) throw new Error(message);
    }
    async function check(name, run) {
        api.reset();
        document.body.replaceChildren();
        try {
            await run();
            results.push({ name, ok: true });
        } catch (error) {
            results.push({ name, ok: false, error: error.stack || String(error) });
        }
    }
    function mount(hasBook = true, candidates = []) {
        const actions = api.create(hasBook, candidates);
        document.body.appendChild(actions);
        return actions;
    }
    function buttons(actions) {
        return Array.from(actions.querySelectorAll('.bm-quick-button'));
    }
    function actionButton(actions, action) {
        const definition = BookMatchUI.quickButtons.find(button => button.action === action);
        return buttons(actions).find(button => button.dataset.action === action
            || button.getAttribute('aria-label') === definition.label
            || button.textContent === definition.label);
    }
    function assertCompactSize(actions, mini) {
        const height = mini ? 18 : 24;
        const iconHeight = mini ? 12 : 14;
        for (const button of buttons(actions)) {
            assert(button.getBoundingClientRect().height === height, `${button.dataset.action}: 버튼 높이가 ${height}px가 아닙니다.`);
            assert(button.querySelector('img')?.getBoundingClientRect().height === iconHeight, `${button.dataset.action}: 아이콘 높이가 ${iconHeight}px가 아닙니다.`);
        }
        const categoryButton = actions.querySelector('.bm-registration-category .bm-category-button');
        assert(categoryButton?.getBoundingClientRect().height === height, `등록 분류 버튼 높이가 ${height}px가 아닙니다.`);
    }

    await check('설정 없는 기존 사용자는 모든 버튼과 텍스트 표시를 유지한다', () => {
        const actions = mount();
        assert(buttons(actions).length === 10, `버튼 수: ${buttons(actions).length}`);
        assert(actions.querySelector('.bm-registration-category'), '등록 분류가 없습니다.');
        assert(!actions.querySelector('img'), '기본값은 텍스트 표시여야 합니다.');
        for (const definition of BookMatchUI.quickButtons) {
            assert(actionButton(actions, definition.action)?.textContent === definition.label, definition.label);
        }
    });

    await check('지정한 버튼과 등록 분류만 숨기고 나머지 버튼을 유지한다', () => {
        api.settings({ quickButtonVisibility: { category: false, copy: false, search: false } });
        const actions = mount();
        assert(buttons(actions).length === 8, `버튼 수: ${buttons(actions).length}`);
        assert(!actions.querySelector('.bm-registration-category'), '등록 분류가 숨겨지지 않았습니다.');
        assert(!actionButton(actions, 'copy'), '복사 버튼이 숨겨지지 않았습니다.');
        assert(!actionButton(actions, 'search'), '구글검색 버튼이 숨겨지지 않았습니다.');
        assert(actionButton(actions, 'ridi_preview'), '설정하지 않은 버튼이 숨겨졌습니다.');
    });

    await check('모든 항목을 숨기면 실행 가능한 버튼이나 분류가 남지 않는다', () => {
        api.settings({ quickButtonVisibility: Object.fromEntries(['category', ...BookMatchUI.quickButtons.map(button => button.action)].map(action => [action, false])) });
        const actions = mount();
        assert(buttons(actions).length === 0, '숨긴 버튼이 남았습니다.');
        assert(!actions.querySelector('.bm-registration-category'), '숨긴 분류가 남았습니다.');
        assert(actions.hidden, '빈 퀵 메뉴가 숨겨지지 않았습니다.');
    });

    await check('미등록 도서의 조건부 버튼은 숨기며 매칭 후보가 있으면 표시한다', () => {
        for (const [hasBook, candidates, expectedCount] of [[false, [], 7], [false, [{ id: 1 }], 10], [true, [], 10]]) {
            const actions = mount(hasBook, candidates);
            assert(buttons(actions).length === expectedCount, `조건부 버튼 수: ${buttons(actions).length}`);
        }
    });

    await check('아이콘은 로컬 SVG를 사용하고 이름과 툴팁을 유지한다', async () => {
        api.settings({ quickButtonsCompact: true });
        const actions = mount();
        for (const definition of BookMatchUI.quickButtons) {
            const button = actionButton(actions, definition.action);
            assert(button, `${definition.label} 버튼이 없습니다.`);
            assert(button.getAttribute('aria-label') === definition.label, `${definition.label} 접근성 이름`);
            assert(button.title.includes(definition.label), `${definition.label} 툴팁`);
            const icon = button.querySelector('img');
            assert(icon && /\/images\/[^/]+\.svg$/.test(icon.src), `${definition.label} SVG 경로`);
            assert(icon.alt === '' || icon.getAttribute('aria-hidden') === 'true', `${definition.label} 중복 이미지 이름`);
            await icon.decode().catch(error => { throw new Error(`${definition.label} SVG 로드 실패: ${icon.src}: ${error}`); });
            assert(icon.naturalWidth > 0 && icon.naturalHeight > 0, `${definition.label} 이미지가 손상되었습니다.`);
            assert(button.getBoundingClientRect().width <= 44, `${definition.label} 아이콘 버튼이 너무 넓습니다.`);
        }
        assertCompactSize(actions, false);
    });

    await check('미니 모드는 등록 분류와 모든 퀵 버튼을 18px로 표시한다', () => {
        api.settings({ quickButtonsCompact: true, quickButtonsMini: true });
        const actions = mount();
        assert(actions.classList.contains('bm-quick-actions--mini'), '미니 모드가 적용되지 않았습니다.');
        assertCompactSize(actions, true);
        const categoryButton = actions.querySelector('.bm-registration-category .bm-category-button');
        assert(categoryButton.getAttribute('aria-label').includes('등록 분류'), '등록 분류 이름이 사라졌습니다.');
    });

    await check('아이콘 모드가 꺼져 있으면 저장된 미니 선택값은 화면에 적용하지 않는다', () => {
        const settings = { quickButtonsCompact: false, quickButtonsMini: true };
        assert(BookMatchUI.getQuickPreferences(settings).mini === false, '미니 모드가 독립적으로 켜졌습니다.');
        assert(BookMatchUI.getQuickSettingsSignature(settings) === BookMatchUI.getQuickSettingsSignature({}), '비활성 미니 설정이 렌더 캐시를 바꿉니다.');
        api.settings(settings);
        const actions = mount();
        assert(!actions.classList.contains('bm-quick-actions--mini'), '글자 버튼에 미니 모드가 적용되었습니다.');
        assert(!actions.querySelector('img') && actionButton(actions, 'copy').textContent === '복사', '글자 표시가 유지되지 않습니다.');
    });

    await check('아이콘 복사 피드백 후 원래 SVG와 이름을 복원한다', async () => {
        for (const mini of [false, true]) {
            api.settings({ quickButtonsCompact: true, quickButtonsMini: mini });
            const actions = mount();
            const button = actionButton(actions, 'copy');
            const source = button.querySelector('img')?.src;
            const count = api.copied.length;
            button.click();
            await Promise.resolve();
            await Promise.resolve();
            assert(button.getAttribute('aria-label') === '복사됨!', '복사 피드백이 표시되지 않았습니다.');
            assertCompactSize(actions, mini);
            await api.flushTimers();
            assert(api.copied.length === count + 1 && api.copied[count] === '테스트 도서', '복사가 실행되지 않았습니다.');
            assert(source && button.querySelector('img')?.src === source, '복사 피드백 후 SVG가 사라졌습니다.');
            assert(button.getAttribute('aria-label') === '복사', '복사 이름이 복원되지 않았습니다.');
            assert(!button.disabled, '복사 버튼이 비활성 상태로 남았습니다.');
            assertCompactSize(actions, mini);
        }
    });

    await check('리디 검색 대기 후 로고와 버튼 상태를 복원한다', async () => {
        for (const mini of [false, true]) {
            api.settings({ quickButtonsCompact: true, quickButtonsMini: mini });
            const actions = mount();
            const button = actionButton(actions, 'ridi_preview');
            const source = button.querySelector('img')?.src;
            button.click();
            assert(button.getAttribute('aria-busy') === 'true', '리디 검색 대기 상태가 없습니다.');
            assertCompactSize(actions, mini);
            await api.flushTimers();
            assert(api.messages.some(message => message.action === 'QUICK_ACTION' && message.type === 'ridi_preview' && message.cleanTitle === '테스트 도서'), '리디 검색 요청이 없습니다.');
            assert(source && button.querySelector('img')?.src === source, '리디 검색 후 로고가 사라졌습니다.');
            assert(button.getAttribute('aria-label') === '리디검색', '리디 이름이 복원되지 않았습니다.');
            assert(!button.disabled && button.style.pointerEvents !== 'none', '리디 버튼을 다시 사용할 수 없습니다.');
            assertCompactSize(actions, mini);
        }
    });

    await check('아이콘 모드에서도 검색 버튼은 제목을 한 번 전달한다', () => {
        api.settings({ quickButtonsCompact: true });
        const actions = mount();
        const button = actionButton(actions, 'search');
        let bubbled = false;
        actions.addEventListener('click', () => { bubbled = true; });
        button.querySelector('img').click();
        assert(api.messages.length === 1, `검색 요청 수: ${api.messages.length}`);
        assert(api.messages[0].type === 'search' && api.messages[0].cleanTitle === '테스트 도서', '검색 요청 내용이 다릅니다.');
        assert(!bubbled, '버튼 클릭이 게시물 링크로 전파되었습니다.');
    });

    await check('이미지 오류가 발생하면 이름을 표시하는 버튼으로 복구한다', () => {
        api.settings({ quickButtonsCompact: true });
        const actions = mount();
        const button = actionButton(actions, 'search');
        button.querySelector('img').dispatchEvent(new Event('error'));
        assert(!button.querySelector('img'), '손상된 이미지가 남았습니다.');
        assert(button.textContent === '구글검색' && button.getAttribute('aria-label') === '구글검색', '텍스트 버튼으로 복구하지 못했습니다.');
        button.click();
        assert(api.messages.length === 1 && api.messages[0].type === 'search', '복구 후 검색이 실행되지 않습니다.');
    });

    await check('이미 렌더링된 목록과 상세는 설정 변경을 반영하고 빈 줄을 남기지 않는다', () => {
        for (const detail of [false, true]) {
            api.settings({});
            const title = document.createElement(detail ? 'h2' : 'a');
            title.textContent = '테스트 도서';
            document.body.appendChild(title);
            api.render(title, detail);
            const original = title.querySelector('.bm-quick-actions');
            assert(original && buttons(original).length === 10, `${detail}: 초기 렌더링`);
            api.render(title, detail);
            assert(title.querySelector('.bm-quick-actions') === original, `${detail}: 변경 없는 메뉴를 다시 생성했습니다.`);

            api.settings({ quickButtonsCompact: true, quickButtonVisibility: { copy: false } });
            api.render(title, detail);
            const compact = title.querySelector('.bm-quick-actions');
            assert(compact !== original && buttons(compact).length === 9, `${detail}: 버튼 설정이 반영되지 않았습니다.`);
            assert(!actionButton(compact, 'copy') && actionButton(compact, 'search').querySelector('img'), `${detail}: 숨김/아이콘 표시 실패`);
            assertCompactSize(compact, false);

            api.settings({ quickButtonsCompact: true, quickButtonsMini: true, quickButtonVisibility: { copy: false } });
            api.render(title, detail);
            const mini = title.querySelector('.bm-quick-actions');
            assert(mini !== compact && !actionButton(mini, 'copy'), `${detail}: 미니 설정 변경이 반영되지 않았습니다.`);
            assertCompactSize(mini, true);
            api.render(title, detail);
            assert(title.querySelector('.bm-quick-actions') === mini, `${detail}: 미니 메뉴를 반복 생성했습니다.`);

            api.settings({ quickButtonsCompact: true, quickButtonsMini: false, quickButtonVisibility: { copy: false } });
            api.render(title, detail);
            const regular = title.querySelector('.bm-quick-actions');
            assert(regular !== mini, `${detail}: 미니 모드 해제가 반영되지 않았습니다.`);
            assertCompactSize(regular, false);

            api.settings({ quickButtonVisibility: Object.fromEntries(['category', ...BookMatchUI.quickButtons.map(button => button.action)].map(action => [action, false])) });
            api.render(title, detail);
            const empty = title.querySelector('.bm-quick-actions');
            assert(empty.hidden && !title.querySelector('.bm-badge-br'), `${detail}: 빈 메뉴의 줄바꿈이 남았습니다.`);
            const siteStyle = document.createElement('style');
            siteStyle.textContent = '.bm-quick-actions.list-actions { display: flex !important; margin-top: 5px !important; }';
            document.body.appendChild(siteStyle);
            assert(getComputedStyle(empty).display === 'none', `${detail}: 사이트 스타일이 빈 메뉴를 다시 표시했습니다.`);
            siteStyle.remove();
            api.render(title, detail);
            assert(title.querySelector('.bm-quick-actions') === empty, `${detail}: 빈 메뉴를 반복해서 재생성했습니다.`);

            api.settings({});
            api.render(title, detail);
            const restored = title.querySelector('.bm-quick-actions');
            assert(!restored.hidden && buttons(restored).length === 10 && title.querySelector('.bm-badge-br'), `${detail}: 기본 표시 복원 실패`);
            title.remove();
        }
    });
    return results;
}
