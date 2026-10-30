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

test('사용방법 페이지에서 목록과 상세 퀵 메뉴 표시를 실제로 체험한다', {
    skip: !browserPath && 'CHROME_BIN에 Chromium 실행 파일을 지정하세요.'
}, async t => {
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'help-quick-display-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(directory)), temporaryRoot);
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const rootUrl = pathToFileURL(root + path.sep).href;
    const bootstrapPath = path.join(directory, 'bootstrap.js');
    fs.writeFileSync(bootstrapPath, `
        const fixtureCalls = { writes: [], copies: [], messages: [], opened: [], errors: [] };
        const fixtureSettings = { darkMode: false, lastRegistrationCategory: 'pdf', quickButtonsCompact: true, quickButtonsMini: true };
        Object.defineProperty(window, 'chrome', { configurable: true, value: {
            runtime: {
                getURL: value => new URL(value, ${JSON.stringify(rootUrl)}).href,
                sendMessage: value => { fixtureCalls.messages.push(value); return Promise.resolve(); }
            },
            storage: {
                onChanged: { addListener() {} },
                local: {
                    get(keys, callback) {
                        const values = Array.isArray(keys)
                            ? Object.fromEntries(keys.map(key => [key, fixtureSettings[key]]))
                            : { ...keys, ...Object.fromEntries(Object.keys(keys).filter(key => key in fixtureSettings).map(key => [key, fixtureSettings[key]])) };
                        callback?.(values);
                        return Promise.resolve(values);
                    },
                    set(values, callback) { fixtureCalls.writes.push(values); callback?.(); return Promise.resolve(); },
                    remove(keys, callback) { fixtureCalls.writes.push({ remove: keys }); callback?.(); return Promise.resolve(); }
                }
            }
        } });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async value => { fixtureCalls.copies.push(value); }
        } });
        window.open = (...args) => { fixtureCalls.opened.push(args); return null; };
        window.addEventListener('error', event => fixtureCalls.errors.push(event.message));
        window.addEventListener('unhandledrejection', event => fixtureCalls.errors.push(String(event.reason)));
        const originalMatchMedia = window.matchMedia.bind(window);
        window.matchMedia = query => query.includes('prefers-reduced-motion')
            ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
            : originalMatchMedia(query);
        document.addEventListener('click', event => {
            if (event.target.closest('a')?.getAttribute('href')?.startsWith('#')) event.preventDefault();
        }, true);
    `);
    const testPath = path.join(directory, 'test.js');
    fs.writeFileSync(testPath, `
        ${runHelpDisplayTests.toString()}
        runHelpDisplayTests(fixtureCalls).then(results => {
            const output = document.createElement('pre');
            output.id = 'help-test-results';
            output.textContent = JSON.stringify(results);
            document.body.replaceChildren(output);
        });
    `);
    const helpHtml = fs.readFileSync(path.join(root, 'help.html'), 'utf8')
        .replace('<head>', `<head><base href="${rootUrl}"><script src="${pathToFileURL(bootstrapPath).href}"></script>`)
        .replace('</head>', `<script src="${pathToFileURL(testPath).href}" defer></script></head>`);
    const page = path.join(directory, 'help.html');
    fs.writeFileSync(page, helpHtml);
    const browser = spawnSync(browserPath, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-extensions',
        '--force-prefers-reduced-motion', '--window-size=1280,1000',
        `--user-data-dir=${path.join(directory, 'profile')}`, '--virtual-time-budget=10000', '--dump-dom', pathToFileURL(page).href
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(browser.error);
    assert.equal(browser.status, 0, browser.stderr);
    const match = browser.stdout.match(/<pre id="help-test-results">([\s\S]*?)<\/pre>/);
    assert.ok(match, `사용방법 테스트 결과가 없습니다: ${browser.stderr}\n${browser.stdout}`);
    const results = JSON.parse(match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    assert.equal(results.length, 6, '필수 사용방법 테스트가 모두 실행되어야 합니다.');
    for (const result of results) {
        await t.test(result.name, () => assert.equal(result.ok, true, result.error));
    }
});

async function runHelpDisplayTests(calls) {
    const results = [];
    const byId = id => document.getElementById(id);
    const compactIds = ['demoQuickCompact', 'detailQuickCompact'];
    const miniIds = ['demoQuickMini', 'detailQuickMini'];
    const panelIds = ['demoQuickMiniPanel', 'detailQuickMiniPanel'];
    function assert(condition, message) {
        if (!condition) throw new Error(message);
    }
    async function check(name, run) {
        try {
            byId('resetDemo').click();
            await run();
            results.push({ name, ok: true });
        } catch (error) {
            results.push({ name, ok: false, error: error.stack || String(error) });
        }
    }
    function toggle(id, checked) {
        const input = byId(id);
        assert(input && !input.disabled, `${id}를 조작할 수 없습니다.`);
        input.checked = checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function assertControls(compact, mini, enabled = true) {
        for (const id of compactIds) {
            assert(byId(id)?.checked === compact, `${id}: 아이콘 선택값이 동기화되지 않았습니다.`);
            assert(byId(id).disabled === !enabled, `${id}: 활성 상태가 다릅니다.`);
            assert(byId(id).getAttribute('aria-expanded') === String(compact), `${id}: 펼침 상태가 다릅니다.`);
        }
        for (const id of miniIds) {
            assert(byId(id)?.checked === mini, `${id}: 미니 선택값이 동기화되지 않았습니다.`);
            assert(byId(id).disabled === (!enabled || !compact), `${id}: 미니 활성 상태가 다릅니다.`);
        }
        for (const id of panelIds) {
            const panel = byId(id);
            assert(panel && panel.hidden === !compact && panel.inert === !compact, `${id}: 미니 하위 패널 표시 상태가 다릅니다.`);
            assert(panel.getAttribute('aria-hidden') === String(!compact), `${id}: 미니 패널 접근성 상태가 다릅니다.`);
        }
    }
    function assertButtons(compact, mini = false) {
        for (const selector of ['#exampleRows .bm-quick-actions', '#detailActions .bm-quick-actions']) {
            const groups = document.querySelectorAll(selector);
            assert(groups.length > 0, `${selector}: 퀵 메뉴가 없습니다.`);
            for (const group of groups) {
                for (const button of group.querySelectorAll('.bm-quick-button')) {
                    const image = button.querySelector('img');
                    assert(!!image === compact, `${button.dataset.demoAction}: 표시 방식이 다릅니다.`);
                    assert(button.getBoundingClientRect().height === (compact && !mini ? 24 : 18), `${button.dataset.demoAction}: 버튼 높이가 다릅니다.`);
                    if (compact) {
                        assert(image.getBoundingClientRect().height === (mini ? 12 : 14), `${button.dataset.demoAction}: 아이콘 높이가 다릅니다.`);
                        assert(button.getAttribute('aria-label') && button.title, `${button.dataset.demoAction}: 접근성 이름이나 툴팁이 없습니다.`);
                    }
                }
                const category = group.querySelector('.bm-category-button');
                assert(category?.getBoundingClientRect().height === (compact && !mini ? 24 : 18), '등록 분류 높이가 퀵 버튼과 다릅니다.');
            }
        }
    }
    function detailButton(action) {
        const button = document.querySelector(`#detailActions [data-demo-action="${action}"]`);
        assert(button, `${action} 상세 퀵 버튼이 없습니다.`);
        return button;
    }
    function ownedValue(label) {
        return Array.from(byId('ownedData').children).find(row => row.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent;
    }

    await check('실제 저장 설정과 독립된 글자 표시로 시작하고 미니 옵션을 접는다', () => {
        assertControls(false, false);
        assertButtons(false);
        assert(document.querySelector('#exampleRows .bm-category-button').dataset.value === 'comic', '실제 등록 분류가 체험 분류에 적용되었습니다.');
    });

    await check('목록과 상세의 아이콘·미니 토글을 공유하고 SVG·말풍선을 표시한다', async () => {
        toggle('demoQuickCompact', true);
        assertControls(true, false);
        assertButtons(true);
        const icons = document.querySelectorAll('#detailActions .bm-quick-button img');
        await Promise.all(Array.from(icons, image => image.decode()));
        assert(Array.from(icons).every(image => image.naturalWidth > 0 && image.src.endsWith('.svg')), '예시 SVG를 정상 로드하지 못했습니다.');
        const google = detailButton('search');
        google.dispatchEvent(new Event('pointerenter'));
        await new Promise(resolve => setTimeout(resolve, 350));
        const tooltip = byId(google.getAttribute('aria-describedby'));
        assert(tooltip?.textContent.includes('구글검색'), '아이콘 버튼의 말풍선이 없습니다.');
        google.dispatchEvent(new Event('pointerleave'));
        toggle('detailQuickMini', true);
        assertControls(true, true);
        assertButtons(true, true);
        toggle('demoQuickMini', false);
        assertControls(true, false);
        assertButtons(true);
    });

    await check('부모 표시와 매칭 적용을 껐다 켜도 미니 선택을 보존한다', () => {
        toggle('detailQuickCompact', true);
        toggle('demoQuickMini', true);
        toggle('demoQuickCompact', false);
        assertControls(false, true);
        assertButtons(false);
        toggle('detailQuickCompact', true);
        assertControls(true, true);
        assertButtons(true, true);
        toggle('demoEnabled', false);
        assert(compactIds.concat(miniIds).every(id => byId(id).disabled), '매칭 해제 후 표시 토글이 활성 상태입니다.');
        assert(!document.querySelector('#exampleRows .bm-quick-actions, #detailActions .bm-quick-actions'), '매칭 해제 후 퀵 메뉴가 남았습니다.');
        assert(compactIds.concat(miniIds).every(id => byId(id).checked), '매칭 해제 중 선택값이 변경되었습니다.');
        toggle('demoEnabled', true);
        assertControls(true, true);
        assertButtons(true, true);
    });

    await check('아이콘으로 검색·복사·등록·누락관리·삭제를 체험한다', async () => {
        toggle('demoQuickCompact', true);
        toggle('detailQuickMini', true);
        for (const [action, label] of [['search', '구글검색'], ['ridi_preview', '리디검색'], ['everything_search', '에브리띵검색']]) {
            detailButton(action).querySelector('img').click();
            assert(byId('demoFeedback').textContent.includes(label), `${label} 체험이 실행되지 않았습니다.`);
        }
        detailButton('copy').querySelector('img').click();
        await Promise.resolve();
        await Promise.resolve();
        assert(calls.copies.includes('별빛 도서관'), '아이콘 복사가 실행되지 않았습니다.');
        document.querySelector('[data-sample-id="moon"]').click();
        detailButton('complete').querySelector('img').click();
        assert(ownedValue('타입') === '완결', '아이콘 완결 등록이 적용되지 않았습니다.');
        detailButton('missing_vol').querySelector('img').click();
        const popover = byId('demo-missing-popover');
        assert(getComputedStyle(popover).display !== 'none', '아이콘 누락관리가 열리지 않았습니다.');
        popover.querySelector('[data-vol="1"]').click();
        assert(ownedValue('누락') === '1권', '누락 번호 선택이 반영되지 않았습니다.');
        byId('demoClosePopoverBtn').click();
        detailButton('delete').querySelector('img').click();
        assert(ownedValue('등록 상태') === '미등록', '아이콘 삭제가 반영되지 않았습니다.');
        assert(!document.querySelector('#detailActions [data-demo-action="delete"]'), '삭제 후 조건부 버튼이 남았습니다.');
        assertControls(true, true);
        assertButtons(true, true);
    });

    await check('예시 초기화는 양쪽 표시 모드와 접힌 미니 옵션을 기본값으로 복원한다', () => {
        toggle('demoQuickCompact', true);
        toggle('detailQuickMini', true);
        toggle('demoQuickHover', true);
        toggle('demoEnabled', false);
        byId('resetDemo').click();
        assertControls(false, false);
        assertButtons(false);
        assert(byId('demoEnabled').checked && !byId('demoQuickHover').checked, '기존 체험 옵션이 초기화되지 않았습니다.');
        assert(ownedValue('타입') === '미완', '초기 예시 소장 정보가 복원되지 않았습니다.');
    });

    await check('체험은 실제 저장소나 외부 검색을 변경하지 않고 오류 없이 동작한다', () => {
        assert(calls.writes.length === 0, `실제 저장소 쓰기 발생: ${JSON.stringify(calls.writes)}`);
        assert(calls.messages.length === 0 && calls.opened.length === 0, '체험이 외부 기능을 호출했습니다.');
        assert(calls.errors.length === 0, `페이지 실행 오류: ${calls.errors.join('; ')}`);
    });
    return results;
}
