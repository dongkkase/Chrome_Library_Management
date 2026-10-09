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

test('제목 DOM: 사이트 스타일이 추출, 매칭, 등록 및 다운로드 제목을 오염시키지 않는다', {
    skip: !browserPath && 'CHROME_BIN에 Chromium 실행 파일을 지정하세요.'
}, async t => {
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'title-dom-extraction-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(directory)), temporaryRoot);
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    const commonSource = fs.readFileSync(path.join(root, 'common.js'), 'utf8');
    const uiSource = fs.readFileSync(path.join(root, 'book-ui.js'), 'utf8');
    const functions = [
        'getTitleTextContent', 'getChatingWikiListTitle', 'getPureLinkText',
        'normalizeTitleCorrectionKeyPart', 'getTitleCorrectionKey', 'normalizeStoredTitleCorrection',
        'getResolvedSiteTitle', 'getResolvedTitleMatchParts', 'getResolvedLinkTitle', 'getResolvedQuickActionTitle',
        'calculateLevenshtein', 'getSimilarity', 'findMatchingBook',
        'getCurrentRightClickedContext', 'captureRightClickedContext', 'extractTargetBookTitle',
        'syncSiteTitleColorBadges', 'getListRenderTargets', 'getDetailRenderTargets',
        'setManagedTitleStyle', 'clearManagedTitleStyles', 'removeBadge',
        'applyStyleToSingleLink', 'applyStyleToDetailElement'
    ].map(name => extractFunction(source, name)).join('\n');
    const script = `
        ${commonSource}
        ${uiSource}
        const testWindow = {
            location: { hostname: 'tcafe21.com', href: 'https://tcafe21.com/bbs/board.php' },
            getComputedStyle: window.getComputedStyle.bind(window)
        };
        const api = (function(window) {
            let siteTitleColorObserver = null;
            let globalDetailSelector = null;
            let lastRightClickedLink = null, lastRightClickedElement = null, lastRightClickedContext = null;
            const titleCorrections = {};
            const isExtensionContextValid = () => true;
            const isSupportSingleCharEnabled = false;
            const isShowListQuickBtn = false, isAllowedBoard = false;
            const isHideExclude = false, isHideComplete = false, isHideIncomplete = false;
            const isHideTranslate = false, isHideNew = false;
            const globalHideSelector = null;
            const hasSiteTranslationEdition = () => false;
            const messages = [];
            const sendRuntimeMessage = message => messages.push(message);
            const levRow0 = new Int32Array(256), levRow1 = new Int32Array(256);
            const registeredTitle = getTitleMatchParts('나이트런 나이트폴');
            const cachedBookList = [{
                id: 71, title: '나이트런 나이트폴', type: 'incomplete', resolution: '1771px', lastVol: '7',
                _regBodyOriginal: registeredTitle.baseOriginal,
                _regBodyNoSpace: registeredTitle.baseNoSpace,
                _editionKey: registeredTitle.editionKey,
                _editionState: registeredTitle.editionState,
                _matchKey: registeredTitle.matchKey
            }];
            const exactMatchCache = {};
            let similarityCache = {};
            const PRE_DEFINED_SITES = ['tcafe21.com', 'lamu.club'].map(url => ({
                url, shortcuts: { titleSelector: '.shortcut-title' }
            }));
            ${functions}
            return {
                getPureLinkText, getChatingWikiListTitle, cleanSiteTitle, getTitleMatchParts, findMatchingBook,
                applyStyleToSingleLink, applyStyleToDetailElement, getResolvedQuickActionTitle,
                captureRightClickedContext, getCurrentRightClickedContext, extractTargetBookTitle, messages,
                setDetailSelector: selector => { globalDetailSelector = selector; },
                reset: () => {
                    siteTitleColorObserver?.disconnect();
                    siteTitleColorObserver = null;
                    globalDetailSelector = null;
                    lastRightClickedLink = null;
                    lastRightClickedElement = null;
                    lastRightClickedContext = null;
                    similarityCache = {};
                    messages.length = 0;
                }
            };
        })(testWindow);
        ${runTitleDomExtractionTests.toString()}
        const results = runTitleDomExtractionTests(api, testWindow);
        document.body.replaceChildren();
        const output = document.createElement('pre');
        output.id = 'results';
        output.textContent = JSON.stringify(results);
        document.body.appendChild(output);
    `;
    fs.writeFileSync(path.join(directory, 'test.js'), script);
    const page = path.join(directory, 'test.html');
    fs.writeFileSync(page, '<!doctype html><html lang="ko"><meta charset="utf-8"><body><script src="test.js"></script></body></html>');
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
    assert.equal(results.length, 14, '필수 브라우저 테스트가 실행되지 않았습니다.');
    for (const result of results) {
        await t.test(result.name, () => assert.equal(result.ok, true, result.error));
    }
});

function runTitleDomExtractionTests(api, testWindow) {
    const results = [];
    const title = '나이트런 나이트폴 7권 [1771px]';
    const siteCss = 'table.list-pc tr.read-post .list-subject a .nm-mark,.list-mobile .list-item.read-post a .nm-mark{font-weight:normal!important}';
    let fixture;

    function assert(condition, message = '조건이 일치하지 않습니다.') {
        if (!condition) throw new Error(message);
    }

    function createTitle(tagName = 'a', titleText = title) {
        const element = document.createElement(tagName);
        element.innerHTML = `<style>${siteCss}</style><span class="nm-mark" style="color:#1e9fd8;font-weight:700">${titleText}</span>`;
        fixture.appendChild(element);
        return element;
    }

    function assertTitleData(data) {
        assert(data.originalText === title, `잘못 추출된 원본 제목: ${data.originalText}`);
        assert(data.pureTitle === '나이트런 나이트폴', `잘못 정리된 제목: ${data.pureTitle}`);
        assert(data.siteMatchKey === api.getTitleMatchParts('나이트런 나이트폴').matchKey, data.siteMatchKey);
        assert(data.siteRes === 1771, `해상도: ${data.siteRes}`);
        assert(data.siteVol === 7, `권수: ${data.siteVol}`);
    }

    function check(name, run) {
        api.reset();
        document.body.replaceChildren();
        fixture = document.createElement('section');
        document.body.appendChild(fixture);
        try {
            run();
            results.push({ name, ok: true });
        } catch (error) {
            results.push({ name, ok: false, error: error.stack });
        } finally {
            api.reset();
        }
    }

    for (const hostname of ['tcafe21.com', 'lamu.club']) {
        testWindow.location.hostname = hostname;
        check(`${hostname}: 스크린샷의 style이 포함된 제목은 일반 제목과 동일하게 추출 및 매칭`, () => {
            const element = createTitle();
            const originalHtml = element.innerHTML;
            const cleanElement = document.createElement('a');
            cleanElement.textContent = title;
            const extracted = api.getPureLinkText(element);
            assert(extracted === api.getPureLinkText(cleanElement), extracted);
            assert(api.cleanSiteTitle(extracted) === '나이트런 나이트폴');
            const matchParts = api.getTitleMatchParts(api.cleanSiteTitle(extracted));
            assert(matchParts.matchKey === api.getTitleMatchParts('나이트런 나이트폴').matchKey, matchParts.matchKey);
            assert(element.innerHTML === originalHtml, '추출 과정이 원본 스타일 또는 제목 DOM을 변경했습니다.');
            for (let volume = 1; volume <= 7; volume++) {
                const volumeTitle = title.replace('7권', `${volume}권`);
                const styledElement = createTitle('a', volumeTitle);
                cleanElement.textContent = volumeTitle;
                const styledParts = api.getTitleMatchParts(api.cleanSiteTitle(api.getPureLinkText(styledElement)));
                const cleanParts = api.getTitleMatchParts(api.cleanSiteTitle(api.getPureLinkText(cleanElement)));
                const styledMatch = api.findMatchingBook(styledParts);
                const cleanMatch = api.findMatchingBook(cleanParts);
                assert(styledMatch.book?.id === 71 && cleanMatch.book?.id === 71, `${volume}권의 등록 도서 매칭 실패`);
                assert(styledMatch.maxScore === 100 && cleanMatch.maxScore === 100, `${volume}권의 매칭률 불일치`);
            }
        });

        check(`${hostname}: 목록 제목의 권수와 해상도 및 빠른 등록 제목 유지`, () => {
            const element = createTitle();
            api.applyStyleToSingleLink(element);
            assertTitleData(element._bmData);
            assert(api.getResolvedQuickActionTitle(element._bmData, element).title === '나이트런 나이트폴');
            api.applyStyleToSingleLink(element);
            assertTitleData(element._bmData);
        });

        check(`${hostname}: 상세 제목도 스타일 제외 후 권수와 해상도 추출`, () => {
            const element = createTitle('h1');
            api.applyStyleToDetailElement(element);
            assertTitleData(element._bmDetailData);
        });

        check(`${hostname}: 우클릭 등록에 CSS 없는 원본 제목 전달`, () => {
            const element = createTitle();
            api.captureRightClickedContext({ target: element.querySelector('.nm-mark') });
            assert(api.getCurrentRightClickedContext().title === title);
            assert(api.messages.length === 1 && api.messages[0].title === title);
        });
    }

    check('스타일, 스크립트, 비표시 콘텐츠와 배지를 제외하고 중첩된 제목 텍스트 보존', () => {
        const element = document.createElement('a');
        element.innerHTML = '<style>title{color:red}</style><script type="application/json">{"title":"잘못된 제목"}</script>'
            + '<noscript>잘못된 대체 텍스트</noscript><template>잘못된 템플릿 제목</template>'
            + '<img alt="제목 아님"><!-- 잘못된 주석 --><span>나이트런 <em>나이트폴</em></span> 7권 [1771px]'
            + '<span class="count">99</span><span class="book-badge">1500px | 2권</span>'
            + '<span class="bm-site-color-badge">원본 색상</span><span class="comment-badge">댓글 30</span>'
            + '<span class="bm-quick-actions">복사 제외 미완 완결</span>';
        assert(api.getPureLinkText(element) === title, api.getPureLinkText(element));
    });

    for (const useStrong of [true, false]) {
        check(`채팅 위키: ${useStrong ? 'strong' : '제목 컨테이너'}의 비표시 텍스트와 메타데이터 제외`, () => {
            testWindow.location.hostname = 'chating.wiki';
            const element = document.createElement('a');
            element.className = 'cw-board-item';
            const titleHtml = `<style>${siteCss}</style><span>${title}</span>`;
            element.innerHTML = '<div class="cw-board-item__title">'
                + (useStrong ? `<strong>${titleHtml}</strong>` : titleHtml)
                + '<em class="cw-board-item__comments">999</em><span class="cw-board-item__tags">만화 720px</span>'
                + '<span class="book-badge">3권</span><span class="bm-quick-actions">미완</span></div>'
                + '<span class="cw-board-item__meta">작성자 2026.10.09</span>';
            fixture.appendChild(element);
            assert(api.getPureLinkText(element.querySelector('.cw-board-item__title span')) === title);
            assert(api.getChatingWikiListTitle(element) === title);
        });
    }

    for (const useConfiguredSelector of [true, false]) {
        check(`다운로드: ${useConfiguredSelector ? '설정된' : '사이트 기본'} 상세 제목에서 CSS와 버튼 제외`, () => {
            testWindow.location.hostname = 'tcafe21.com';
            const element = createTitle('h1');
            element.className = useConfiguredSelector ? 'detail-title' : 'shortcut-title';
            element.insertAdjacentHTML('beforeend', '<button>다운로드</button><a class="auto-dl-btn">빠른 다운로드</a>');
            if (useConfiguredSelector) api.setDetailSelector('.detail-title');
            const extracted = api.extractTargetBookTitle(element);
            assert(extracted.title === '나이트런 나이트폴', extracted.title);
            assert(extracted.sourceText === title, extracted.sourceText);
        });
    }

    check('다운로드: 목록 컨테이너 대체 추출에서도 CSS와 버튼 제외', () => {
        testWindow.location.hostname = 'example.test';
        const container = createTitle('div');
        container.className = 'list-item';
        container.insertAdjacentHTML('beforeend', '<button>검색</button><a class="auto-dl-btn">탭열기</a>');
        const extracted = api.extractTargetBookTitle(container.querySelector('.auto-dl-btn'));
        assert(extracted.title === '나이트런 나이트폴', extracted.title);
        assert(extracted.sourceText === title, extracted.sourceText);
    });

    return results;
}
