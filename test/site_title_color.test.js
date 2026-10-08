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

test('사이트 제목 색상: 실제 DOM에서 원본 색상 배지와 확장 프로그램 색상 분리', { skip: !browserPath && 'CHROME_BIN에 Chromium 실행 파일을 지정하세요.' }, async t => {
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'site-title-color-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(directory)), temporaryRoot);
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    const uiSource = fs.readFileSync(path.join(root, 'book-ui.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'book-ui.css'), 'utf8');
    const galleryCss = source.match(/#fboardlist td:nth-child\(3\) span\s*\{[^}]+\}/);
    assert.ok(galleryCss, '기존 갤러리 스타일을 찾을 수 없습니다.');
    const functions = [
        'syncSiteTitleColorBadges', 'getListRenderTargets', 'getDetailRenderTargets',
        'getChatingWikiListTitle', 'getPureLinkText', 'setManagedTitleStyle',
        'clearManagedTitleStyles', 'removeBadge', 'applyStyleToSingleLink', 'applyStyleToDetailElement'
    ].map(name => extractFunction(source, name)).join('\n');
    const html = `<!doctype html><html lang="ko"><meta charset="utf-8">
        <style>.test-title { color: rgb(48, 49, 50); font-weight: 400; font-size: 16px; } ${css}</style>
        <style>${galleryCss[0]}</style><body><script>
        ${uiSource}
        const testWindow = { location: { hostname: 'tcafe21.com' }, getComputedStyle: window.getComputedStyle.bind(window) };
        const api = (function(window) {
            let siteTitleColorObserver = null;
            let matchedBook = null;
            const isExtensionContextValid = () => true;
            const isSupportSingleCharEnabled = false;
            const isShowListQuickBtn = false;
            const isAllowedBoard = false;
            const isHideExclude = false, isHideComplete = false, isHideIncomplete = false;
            const isHideTranslate = false, isHideNew = false;
            const globalHideSelector = null;
            const hasSiteTranslationEdition = () => false;
            const hasTranslationEditionMarker = () => false;
            const getResolvedSiteTitle = title => ({ title, autoTitle: title, isCorrected: false });
            const getResolvedTitleMatchParts = value => ({ baseOriginal: value.title, baseNoSpace: value.title, matchKey: value.title });
            const findMatchingBook = () => ({ book: matchedBook, maxScore: matchedBook ? 100 : 0 });
            ${functions}
            return {
                syncSiteTitleColorBadges, applyStyleToSingleLink, applyStyleToDetailElement, getPureLinkText,
                setBook: book => { matchedBook = book; },
                reset: () => { siteTitleColorObserver?.disconnect(); siteTitleColorObserver = null; matchedBook = null; }
            };
        })(testWindow);
        ${runSiteTitleColorTests.toString()}
        runSiteTitleColorTests(api, testWindow).then(results => {
            document.body.replaceChildren();
            const output = document.createElement('pre');
            output.id = 'results';
            output.textContent = JSON.stringify(results);
            document.body.appendChild(output);
        }).catch(error => { document.body.textContent = error.stack; });
        </script></body></html>`;
    const page = path.join(directory, 'test.html');
    fs.writeFileSync(page, html);
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
    assert.ok(results.length >= 25, '필수 브라우저 테스트가 실행되지 않았습니다.');
    for (const result of results) {
        await t.test(result.name, () => assert.equal(result.ok, true, result.error));
    }
});

async function runSiteTitleColorTests(api, testWindow) {
    const results = [];
    const title = '전생 콜로세움 ~최약 스킬로 최강의 여자들을 공략해 노예 할렘 만듭니다~ 5~7권 [1350,1440px]';
    let fixture;

    function assert(condition, message = '조건이 일치하지 않습니다.') {
        if (!condition) throw new Error(message);
    }

    function color(value) {
        const element = document.createElement('span');
        element.style.color = value;
        return element.style.color;
    }

    function createTitle(tagName = 'a', originalColor = '#1e9fd8') {
        const element = document.createElement(tagName);
        element.className = 'test-title';
        const marker = document.createElement('span');
        marker.className = 'nm-mark';
        marker.style.color = originalColor;
        marker.style.fontWeight = '700';
        marker.textContent = title;
        element.appendChild(marker);
        fixture.appendChild(element);
        return { element, marker };
    }

    function owned(type) {
        return { id: 1, title, type, resolution: '1440px', lastVol: '7', missingVols: [] };
    }

    function badgeOf(marker) {
        const badges = marker.querySelectorAll(':scope > .bm-site-color-badge');
        assert(badges.length === 1, '원본 색상 배지가 정확히 하나 있어야 합니다.');
        assert(marker.firstChild === badges[0], '배지는 제목의 왼쪽에 있어야 합니다.');
        assert(badges[0].textContent === '', '배지가 제목 추출 결과를 변경해서는 안 됩니다.');
        return badges[0];
    }

    async function check(name, run) {
        api.reset();
        document.body.replaceChildren();
        fixture = document.createElement('section');
        document.body.appendChild(fixture);
        testWindow.location.hostname = 'tcafe21.com';
        try {
            await run();
            results.push({ name, ok: true });
        } catch (error) {
            results.push({ name, ok: false, error: error.stack });
        } finally {
            api.reset();
        }
    }

    for (const hostname of ['tcafe21.com', 'lamu.club']) {
        for (const [label, render, tagName] of [
            ['목록', api.applyStyleToSingleLink, 'a'], ['상세', api.applyStyleToDetailElement, 'h1']
        ]) {
            for (const type of ['complete', 'incomplete', 'exclude', null]) {
                await check(`${hostname} ${label}: ${type || '미등록'} 제목 색상과 원본 배지`, () => {
                    testWindow.location.hostname = hostname;
                    const { element, marker } = createTitle(tagName);
                    const originalStyle = marker.getAttribute('style');
                    const book = type ? owned(type) : null;
                    api.setBook(book);
                    render(element);
                    const badge = badgeOf(marker);
                    const expected = BookMatchUI.getPresentation(book, 1440, 7, book ? 100 : 0, label === '상세');
                    const expectedWeight = expected.titleStyles['font-weight'];
                    const computed = getComputedStyle(marker);
                    assert(computed.color === color(expected.titleStyles.color || 'rgb(48, 49, 50)'), computed.color);
                    assert(computed.fontWeight === (expectedWeight === 'normal' ? '400' : expectedWeight || '400'), computed.fontWeight);
                    assert(getComputedStyle(badge).backgroundColor === color('#1e9fd8'));
                    assert(marker.getAttribute('style') === originalStyle, '사이트의 인라인 스타일을 보존해야 합니다.');
                    assert(api.getPureLinkText(element) === title, '색상 및 보유 배지가 제목 추출 결과를 변경했습니다.');
                });
            }
        }
    }

    for (const [label, render, tagName] of [
        ['목록', api.applyStyleToSingleLink, 'a'], ['상세', api.applyStyleToDetailElement, 'h1']
    ]) {
        await check(`${label}: 등록 삭제 시 기존 확장 색상과 굵기 제거`, () => {
            const { element, marker } = createTitle(tagName);
            api.setBook(owned('complete'));
            render(element);
            const badge = badgeOf(marker);
            api.setBook(null);
            render(element);
            assert(getComputedStyle(marker).color === 'rgb(48, 49, 50)');
            assert(getComputedStyle(marker).fontWeight === '400');
            assert(badgeOf(marker) === badge);
            assert(getComputedStyle(badge).backgroundColor === color('#1e9fd8'));
            assert(!element.querySelector('.book-badge'));
        });
    }

    await check('같은 제목 반복 처리 시 배지 중복과 DOM 자식 변경이 없다', () => {
        const { element, marker } = createTitle();
        api.syncSiteTitleColorBadges(element);
        const badge = badgeOf(marker);
        const observer = new MutationObserver(() => {});
        observer.observe(element, { childList: true, subtree: true });
        try {
            for (let index = 0; index < 10; index++) api.syncSiteTitleColorBadges(element);
            assert(observer.takeRecords().length === 0, '반복 처리로 MutationObserver 루프가 발생할 수 있습니다.');
            assert(badgeOf(marker) === badge);
            assert(marker.style.color === color('#1e9fd8'));
        } finally {
            observer.disconnect();
        }
    });

    await check('사이트가 기존 마커 색상을 변경하면 배지에 새 색상 반영', async () => {
        const { element, marker } = createTitle();
        api.setBook(owned('complete'));
        api.applyStyleToSingleLink(element);
        const badge = badgeOf(marker);
        marker.style.color = '#1ca342';
        await Promise.resolve();
        assert(badgeOf(marker) === badge);
        assert(getComputedStyle(badge).backgroundColor === color('#1ca342'));
        assert(getComputedStyle(marker).color === color('#0056b3'));
        assert(marker.style.color === color('#1ca342'));
    });

    await check('사이트가 원본 색상을 제거하면 배지와 상속 마커 제거', async () => {
        const { element, marker } = createTitle();
        api.syncSiteTitleColorBadges(element);
        marker.style.removeProperty('color');
        await Promise.resolve();
        assert(!marker.querySelector('.bm-site-color-badge'));
        assert(!marker.hasAttribute('data-bm-site-color'));
        assert(getComputedStyle(marker).fontWeight === '700');
    });

    await check('마커 교체 후 재처리하면 새 원본 색상으로 배지 생성', () => {
        const { element, marker } = createTitle();
        api.setBook(owned('incomplete'));
        api.applyStyleToSingleLink(element);
        const replacement = document.createElement('span');
        replacement.className = 'nm-mark';
        replacement.style.cssText = 'color:#333;font-weight:700';
        replacement.textContent = title;
        marker.replaceWith(replacement);
        api.applyStyleToSingleLink(element);
        assert(element.querySelectorAll('.bm-site-color-badge').length === 1);
        assert(getComputedStyle(badgeOf(replacement)).backgroundColor === color('#333'));
        assert(getComputedStyle(replacement).color === color('#d9480f'));
        assert(api.getPureLinkText(element) === title);
    });

    await check('지원 하위 도메인과 루트 마커도 원본 색상 처리', () => {
        for (const hostname of ['www.tcafe21.com', 'board.lamu.club']) {
            testWindow.location.hostname = hostname;
            const { marker } = createTitle();
            api.syncSiteTitleColorBadges(marker);
            assert(getComputedStyle(badgeOf(marker)).backgroundColor === color('#1e9fd8'));
            assert(marker.style.color === color('#1e9fd8'));
        }
    });

    await check('미지원 사이트 및 유사 도메인의 제목은 변경하지 않는다', () => {
        for (const hostname of ['example.org', 'chating.wiki', 'nottcafe21.com', 'tcafe21.com.example.org', 'notlamu.club', 'lamu.club.example.org']) {
            testWindow.location.hostname = hostname;
            const { element, marker } = createTitle();
            const html = element.innerHTML;
            api.syncSiteTitleColorBadges(element);
            assert(element.innerHTML === html, hostname);
            assert(getComputedStyle(marker).color === color('#1e9fd8'), hostname);
        }
    });

    await check('갤러리의 span 강제 스타일에서도 배지 너비와 표시 유지', () => {
        fixture.id = 'fboardlist';
        const table = document.createElement('table');
        table.innerHTML = '<tbody><tr><td></td><td></td><td></td></tr></tbody>';
        fixture.appendChild(table);
        const { element, marker } = createTitle();
        table.querySelector('td:last-child').appendChild(element);
        api.syncSiteTitleColorBadges(element);
        const badge = badgeOf(marker);
        const computed = getComputedStyle(badge);
        const rectangle = badge.getBoundingClientRect();
        assert(computed.display === 'inline-block', computed.display);
        assert(rectangle.width > 0 && rectangle.height > 0, '빈 색상 배지가 표시되지 않습니다.');
        assert(rectangle.width < 20 && rectangle.height < 20, '색상 배지 크기가 제목보다 큽니다.');
        assert(getComputedStyle(badge).backgroundColor === color('#1e9fd8'));
    });

    await check('색상 없는 마커와 일반 인라인 색상은 변경하지 않는다', () => {
        fixture.innerHTML = '<a class="test-title"><span class="nm-mark">원본 제목</span><span style="color:red">기타 표시</span></a>';
        const html = fixture.innerHTML;
        api.syncSiteTitleColorBadges(fixture.firstElementChild);
        assert(fixture.innerHTML === html);
    });

    return results;
}
