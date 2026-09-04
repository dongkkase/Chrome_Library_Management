const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const commonSource = fs.readFileSync(path.join(projectRoot, 'common.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(projectRoot, 'background.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(projectRoot, 'content.js'), 'utf8');
const chatingWikiLinkText = '[스에히로 마치] 질투는 여우빛 (단권)0만화구작BL웹추출720px● 100P● 28D 20:36:49복사제외미완완결구글검색리디검색에브리띵검색💫58612Lv.870/09609.03';

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

function createEverythingSearchHarness() {
    const scriptCalls = [];
    const tabCalls = [];
    const context = vm.createContext({
        console: {
            log() {},
            error() {}
        },
        chrome: {
            scripting: {
                executeScript(options) {
                    scriptCalls.push(options);
                    return Promise.resolve();
                }
            },
            tabs: {
                create(options) {
                    tabCalls.push(options);
                    return Promise.resolve();
                }
            }
        }
    });

    vm.runInContext(commonSource, context);
    vm.runInContext(`
        ${extractFunction(backgroundSource, 'stripEditionTagsForEverythingSearch')}
        ${extractFunction(backgroundSource, 'executeEverythingSearch')}
    `, context);

    return {
        stripEditionTagsForEverythingSearch: context.stripEditionTagsForEverythingSearch,
        executeEverythingSearch: context.executeEverythingSearch,
        setEditionKeywords: context.setEditionKeywords,
        cleanSiteTitle: context.cleanSiteTitle,
        scriptCalls,
        tabCalls
    };
}

function createContextMenuResolver(requestedContext, cachedContext = null) {
    const context = vm.createContext({
        URL,
        requestRightClickedContext: async () => requestedContext,
        doesRightClickedContextMatch: value => !!value,
        rememberRightClickedContext: (tabId, frameId, value) => value,
        getCachedRightClickedContext: () => cachedContext
    });

    vm.runInContext(`
        ${extractFunction(backgroundSource, 'isChatingWikiUrl')}
        ${extractFunction(backgroundSource, 'resolveContextMenuClickContext')}
    `, context);
    return context.resolveContextMenuClickContext;
}

function createChatingWikiTitleHarness() {
    const context = vm.createContext({
        window: {
            location: {
                hostname: 'chating.wiki'
            }
        }
    });

    vm.runInContext(`
        ${extractFunction(contentSource, 'getChatingWikiListTitle')}
        ${extractFunction(contentSource, 'getPureLinkText')}
    `, context);
    return context.getPureLinkText;
}

function createRightClickedContextCacheHarness() {
    const context = vm.createContext({});
    vm.runInContext(`
        const rightClickedContexts = new Map();
        const RIGHT_CLICK_CONTEXT_MAX_AGE_MS = 30 * 1000;
        ${extractFunction(backgroundSource, 'getRightClickedContextKey')}
        ${extractFunction(backgroundSource, 'normalizeRightClickedContext')}
        ${extractFunction(backgroundSource, 'rememberRightClickedContext')}
        ${extractFunction(backgroundSource, 'doesRightClickedContextMatch')}
        ${extractFunction(backgroundSource, 'getCachedRightClickedContext')}
    `, context);
    return context;
}

function createRightClickedContextRequestHarness(response, lastError = null) {
    const calls = [];
    const context = vm.createContext({
        chrome: {
            runtime: { lastError },
            tabs: {
                sendMessage(tabId, message, options, callback) {
                    calls.push({ tabId, message, options });
                    callback(response);
                }
            }
        }
    });
    vm.runInContext(`
        ${extractFunction(backgroundSource, 'normalizeRightClickedContext')}
        ${extractFunction(backgroundSource, 'requestRightClickedContext')}
    `, context);

    return {
        requestRightClickedContext: context.requestRightClickedContext,
        calls
    };
}

test('에브리띵 검색어에서 등록된 판본명만 제거한다', () => {
    const { stripEditionTagsForEverythingSearch } = createEverythingSearchHarness();

    assert.equal(stripEditionTagsForEverythingSearch('작품명(번역판)'), '작품명');
    assert.equal(stripEditionTagsForEverythingSearch('작품명 [신장판] (외전)'), '작품명 (외전)');
    assert.equal(stripEditionTagsForEverythingSearch('작품명（개정 완전판）【특장판】'), '작품명');
});

test('사용자 지정 판본명도 에브리띵 검색어에서 제거한다', () => {
    const { stripEditionTagsForEverythingSearch, setEditionKeywords } = createEverythingSearchHarness();
    setEditionKeywords(['리커버판']);

    assert.equal(stripEditionTagsForEverythingSearch('작품명(리커버판)'), '작품명');
    assert.equal(stripEditionTagsForEverythingSearch('작품명(번역판)'), '작품명');
});

test('백그라운드 에브리띵 실행 직전에 판본명을 제거한다', () => {
    const { executeEverythingSearch, scriptCalls, tabCalls } = createEverythingSearchHarness();

    executeEverythingSearch('작품명(번역판)', 17);
    executeEverythingSearch('다른 작품[애장판]', null);

    assert.equal(scriptCalls.length, 1);
    assert.deepEqual(Array.from(scriptCalls[0].args), ['작품명']);
    assert.equal(scriptCalls[0].target.tabId, 17);
    assert.equal(tabCalls.length, 1);
    assert.equal(tabCalls[0].url, `es:${encodeURIComponent('다른 작품')}`);
});

test('채팅 위키 우클릭은 앵커 전체 텍스트보다 콘텐츠에서 추출한 제목을 사용한다', async () => {
    const pageUrl = 'https://chating.wiki/게시판/여성향/만화-웹툰';
    const linkUrl = `${pageUrl}/글/53782`;
    const cleanLinkTitle = '[스에히로 마치] 질투는 여우빛 (단권)';
    const resolveContextMenuClickContext = createContextMenuResolver({
        title: cleanLinkTitle,
        hasTranslationEdition: false,
        pageUrl,
        linkUrl,
        timestamp: Date.now()
    });

    const result = await resolveContextMenuClickContext({
        menuItemId: 'searchEverything',
        pageUrl,
        linkUrl,
        linkText: chatingWikiLinkText,
        selectionText: chatingWikiLinkText,
        frameId: 0
    }, { id: 31 });
    const { cleanSiteTitle } = createEverythingSearchHarness();

    assert.equal(cleanSiteTitle(chatingWikiLinkText), '질투는 여우빛 0만화구작BL웹추출');
    assert.equal(result.title, cleanLinkTitle);
    assert.equal(cleanSiteTitle(result.title), '질투는 여우빛');
});

test('채팅 위키 제목은 게시물 내부 요소에서 호출해도 strong 텍스트만 추출한다', () => {
    const cleanLinkTitle = '[스에히로 마치] 질투는 여우빛 (단권)';
    const titleContainer = {
        querySelector(selector) {
            return selector === 'strong' ? { textContent: cleanLinkTitle } : null;
        }
    };
    const item = {
        matches(selector) {
            return selector === 'a.cw-board-item';
        },
        querySelector(selector) {
            return selector.includes('.cw-board-item__title') ? titleContainer : null;
        }
    };
    const nestedElement = {
        matches() {
            return false;
        },
        closest(selector) {
            return selector === 'a.cw-board-item' ? item : null;
        }
    };

    assert.equal(createChatingWikiTitleHarness()(nestedElement), cleanLinkTitle);
});

test('채팅 위키 인라인 퀵액션은 클릭 순간의 strong 제목을 다시 사용한다', () => {
    const liveTitle = '[스에히로 마치] 질투는 여우빛 (단권)';
    const context = vm.createContext({
        getChatingWikiListTitle: () => liveTitle,
        getResolvedSiteTitle: (title, hasTranslationEdition) => ({ title, hasTranslationEdition }),
        getResolvedLinkTitle: () => ({ title: chatingWikiLinkText })
    });
    vm.runInContext(extractFunction(contentSource, 'getResolvedQuickActionTitle'), context);

    const result = context.getResolvedQuickActionTitle({
        originalText: chatingWikiLinkText,
        hasSiteTranslationEdition: false
    }, {});

    assert.equal(result.title, liveTitle);
    assert.match(contentSource, /const resolvedTitle = getResolvedQuickActionTitle\(linkData, btn\);/);
});

test('채팅 위키는 정제된 클릭 제목이 없을 때 오염된 linkText를 사용하지 않는다', async () => {
    const pageUrl = 'https://chating.wiki/게시판/여성향/만화-웹툰';
    const resolveContextMenuClickContext = createContextMenuResolver(null);

    const result = await resolveContextMenuClickContext({
        menuItemId: 'searchEverything',
        pageUrl,
        linkUrl: `${pageUrl}/글/53782`,
        linkText: chatingWikiLinkText,
        selectionText: chatingWikiLinkText,
        frameId: 0
    }, { id: 31 });

    assert.equal(result.title, '');
});

test('채팅 위키의 다른 우클릭 메뉴는 사용자가 선택한 제목을 유지한다', async () => {
    const pageUrl = 'https://chating.wiki/게시판/여성향/만화-웹툰';
    const resolveContextMenuClickContext = createContextMenuResolver({
        title: '[스에히로 마치] 질투는 여우빛 (단권)',
        pageUrl,
        linkUrl: `${pageUrl}/글/53782`,
        timestamp: Date.now()
    });

    const result = await resolveContextMenuClickContext({
        menuItemId: 'addExclude',
        pageUrl,
        linkUrl: `${pageUrl}/글/53782`,
        linkText: chatingWikiLinkText,
        selectionText: '직접 선택한 제목',
        frameId: 0
    }, { id: 31 });

    assert.equal(result.title, '직접 선택한 제목');
});

test('채팅 위키 에브리띵 검색도 제목 일부를 직접 선택한 경우에는 선택값을 유지한다', async () => {
    const pageUrl = 'https://chating.wiki/게시판/여성향/만화-웹툰';
    const resolveContextMenuClickContext = createContextMenuResolver({
        title: '[스에히로 마치] 질투는 여우빛 (단권)',
        pageUrl,
        linkUrl: `${pageUrl}/글/53782`,
        timestamp: Date.now()
    });

    const result = await resolveContextMenuClickContext({
        menuItemId: 'searchEverything',
        pageUrl,
        linkUrl: `${pageUrl}/글/53782`,
        linkText: chatingWikiLinkText,
        selectionText: '질투는 여우빛',
        frameId: 0
    }, { id: 31 });

    assert.equal(result.title, '질투는 여우빛');
});

test('쿼리 문자열에 포함된 채팅 위키 URL은 채팅 위키 페이지로 오인하지 않는다', async () => {
    const resolveContextMenuClickContext = createContextMenuResolver(null);
    const result = await resolveContextMenuClickContext({
        pageUrl: 'https://example.com/?next=https://chating.wiki/게시판',
        linkUrl: 'https://example.com/book/1',
        selectionText: '일반 링크 제목',
        frameId: 0
    }, { id: 31 });

    assert.equal(result.title, '일반 링크 제목');
});

test('우클릭 제목 캐시는 탭과 프레임 및 링크가 같은 경우에만 사용한다', () => {
    const cache = createRightClickedContextCacheHarness();
    const pageUrl = 'https://chating.wiki/게시판/여성향/만화-웹툰';
    const linkUrl = `${pageUrl}/글/53782`;

    cache.rememberRightClickedContext(31, 2, {
        title: '[스에히로 마치] 질투는 여우빛 (단권)',
        pageUrl,
        linkUrl,
        timestamp: Date.now()
    });

    assert.equal(cache.getCachedRightClickedContext(32, 2, { pageUrl, linkUrl }), null);
    assert.equal(cache.getCachedRightClickedContext(31, 0, { pageUrl, linkUrl }), null);
    assert.equal(
        cache.getCachedRightClickedContext(31, 2, { pageUrl, linkUrl }).title,
        '[스에히로 마치] 질투는 여우빛 (단권)'
    );
    assert.equal(
        cache.getCachedRightClickedContext(31, 2, { pageUrl, linkUrl: `${pageUrl}/글/99999` }),
        null
    );

    cache.rememberRightClickedContext(41, 0, {
        title: '오래된 제목',
        pageUrl,
        linkUrl,
        timestamp: Date.now() - (31 * 1000)
    });
    assert.equal(cache.getCachedRightClickedContext(41, 0, { pageUrl, linkUrl }), null);
});

test('우클릭 제목은 실제 클릭 프레임의 콘텐츠 스크립트에 요청한다', async () => {
    const response = {
        ok: true,
        title: '[스에히로 마치] 질투는 여우빛 (단권)',
        pageUrl: 'https://chating.wiki/게시판',
        linkUrl: 'https://chating.wiki/게시판/글/53782'
    };
    const { requestRightClickedContext, calls } = createRightClickedContextRequestHarness(response);
    const result = await requestRightClickedContext(31, 2);

    assert.equal(result.title, response.title);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tabId, 31);
    assert.equal(calls[0].message.action, 'GET_RIGHT_CLICK_CONTEXT');
    assert.equal(calls[0].options.frameId, 2);
});

test('우클릭 제목은 콘텐츠 스크립트에 다시 요청할 수 있게 연결한다', () => {
    assert.match(contentSource, /document\.addEventListener\('contextmenu', captureRightClickedContext, true\);/);
    assert.match(
        contentSource,
        /request\.action === 'GET_RIGHT_CLICK_CONTEXT'[\s\S]*?sendResponse\(context \? \{ ok: true, \.\.\.context \} : \{ ok: false \}\);/
    );
    assert.match(
        backgroundSource,
        /chrome\.tabs\.sendMessage\([\s\S]*?\{ action: 'GET_RIGHT_CLICK_CONTEXT' \}/
    );
});
