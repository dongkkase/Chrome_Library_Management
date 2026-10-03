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

test('티카페 단축키: 실제 DOM과 키 이벤트로 동작 검증', { skip: !browserPath && 'CHROME_BIN에 Chromium 실행 파일을 지정하세요.' }, async t => {
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'book-shortcuts-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(directory)), temporaryRoot);
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const source = fs.readFileSync(path.join(root, 'book-shortcuts.js'), 'utf8');
    const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    const siteConfig = contentSource.match(/const PRE_DEFINED_SITES = \[[\s\S]*?\r?\n\];/);
    assert.ok(siteConfig, '실제 사이트 설정을 찾을 수 없습니다.');
    const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><body><script>
        const testWindow = { location: { hostname: 'tcafe21.com' }, getComputedStyle: window.getComputedStyle.bind(window) };
        const shortcuts = (function(window) { ${source}; return BookShortcuts; })(testWindow);
        ${siteConfig[0]}
        ${runShortcutTests.toString()}
        const results = ['tcafe21.com', 'lamu.club'].flatMap(hostname =>
            runShortcutTests(shortcuts, testWindow, PRE_DEFINED_SITES, hostname)
                .map(result => ({ ...result, name: hostname + ': ' + result.name })));
        document.body.textContent = '';
        const output = document.createElement('pre');
        output.id = 'results';
        output.textContent = JSON.stringify(results);
        document.body.appendChild(output);
    </script></body></html>`;
    const page = path.join(directory, 'test.html');
    fs.writeFileSync(page, html);
    const result = spawnSync(browserPath, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-extensions',
        `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', pathToFileURL(page).href
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const match = result.stdout.match(/<pre id="results">([\s\S]*?)<\/pre>/);
    assert.ok(match, `브라우저 테스트 결과가 없습니다: ${result.stderr}\n${result.stdout}`);
    const results = JSON.parse(match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    assert.equal(results.length, 36);
    for (const result of results) {
        await t.test(result.name, () => assert.equal(result.ok, true, result.error));
    }
});

function runShortcutTests(BookShortcuts, testWindow, sites, siteHostname) {
    const results = [];
    let valid = true;
    const controller = BookShortcuts.create({ sites, isContextValid: () => valid });
    let clicks;
    let fixture;

    function assert(condition, message = '조건이 일치하지 않습니다.') {
        if (!condition) throw new Error(message);
    }

    function press(key, options = {}, target = document.activeElement) {
        const event = new KeyboardEvent('keydown', {
            key, code: key === 'd' ? 'KeyD' : '', bubbles: true, composed: true, cancelable: true, ...options
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
    }

    function download(index = 1) {
        const button = document.createElement('a');
        button.href = '#';
        button.className = 'auto-dl-btn';
        button.dataset.downloadUrl = `https://download.example/${index}`;
        button.textContent = '바로다운로드';
        button.addEventListener('click', event => {
            event.preventDefault();
            clicks.push(index);
        });
        fixture.appendChild(button);
        return button;
    }

    function modal() {
        return document.getElementById('bm-download-shortcut-modal')?.shadowRoot;
    }

    function test(name, run) {
        try {
            controller.setEnabled(false);
            document.body.replaceChildren();
            fixture = document.createElement('section');
            document.body.appendChild(fixture);
            clicks = [];
            valid = true;
            testWindow.location.hostname = siteHostname;
            controller.setEnabled(true);
            run();
            results.push({ name, ok: true });
        } catch (error) {
            results.push({ name, ok: false, error: error.stack });
        } finally {
            controller.setEnabled(false);
        }
    }

    test('기본 꺼짐, 설정 변경 즉시 반영 및 중복 리스너 방지', () => {
        download();
        controller.setEnabled(false);
        const initiallyDisabled = BookShortcuts.create({ sites, isContextValid: () => valid });
        assert(!press('d') && clicks.length === 0);
        initiallyDisabled.setEnabled(false);
        controller.setEnabled(true);
        controller.setEnabled(true);
        assert(press('d') && clicks.length === 1);
        controller.setEnabled(false);
        assert(!press('d') && clicks.length === 1);
    });

    test('열람 후 동적으로 생성된 버튼은 다음 D 입력에서 다운로드', () => {
        const open = document.createElement('button');
        open.id = 'clink-open-btn';
        open.textContent = '링크 열람';
        fixture.appendChild(open);
        let opened = 0;
        open.onclick = () => {
            opened++;
            open.hidden = true;
            download();
        };
        assert(press('d') && opened === 1 && clicks.length === 0);
        assert(!press('d', { repeat: true }) && clicks.length === 0);
        assert(press('d') && clicks.join() === '1');
    });

    test('제공된 링크 열람 HTML의 인라인 openClink 핸들러를 실행한다', () => {
        fixture.innerHTML = `<div class="text-center" style="margin-top:10px;">
            <button type="button" id="clink-open-btn" class="btn btn-black btn-sm" onclick="openClink()">
                <i class="fa fa-unlock-alt"></i> <b>링크 열람(100P)</b>
            </button>
        </div>`;
        let opened = 0;
        window.openClink = () => { opened++; };
        try {
            assert(press('d') && opened === 1);
        } finally {
            delete window.openClink;
        }
    });

    test('지원하지 않는 사이트 및 유사 도메인 차단, 실제 하위 도메인 허용', () => {
        download();
        for (const hostname of ['tcafe21.com.example.org', 'nottcafe21.com', 'lamu.club.example.org', 'notlamu.club', 'example.org']) {
            testWindow.location.hostname = hostname;
            assert(!press('d') && clicks.length === 0, hostname);
        }
        testWindow.location.hostname = `www.${siteHostname}`;
        assert(press('d') && clicks.length === 1);
    });

    test('버튼이 없는 페이지에서는 키 이벤트를 취소하지 않는다', () => {
        assert(!press('d') && !modal());
    });

    test('input, textarea, select, contenteditable 및 사용자 정의 입력 차단', () => {
        download();
        for (const html of [
            '<input>', '<textarea></textarea>', '<select><option>자료</option></select>',
            '<div contenteditable="true"><span>본문</span></div>',
            '<div role="textbox" tabindex="0">본문</div>'
        ]) {
            const container = document.createElement('div');
            container.innerHTML = html;
            fixture.appendChild(container);
            const editor = container.firstElementChild;
            editor.focus();
            assert(!press('d', {}, editor.lastElementChild || editor), html);
            editor.blur();
            container.remove();
        }
        assert(clicks.length === 0);
        document.designMode = 'on';
        assert(!press('d'));
        document.designMode = 'off';
    });

    test('Shadow DOM 입력에 포커스한 경우에도 차단', () => {
        download();
        const host = document.createElement('div');
        fixture.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const input = document.createElement('input');
        shadow.appendChild(input);
        input.focus();
        assert(!press('d', {}, input) && clicks.length === 0);
    });

    test('조합키, IME 입력, 반복 키 및 이미 처리된 이벤트 차단', () => {
        download();
        for (const options of [
            { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
            { repeat: true }, { isComposing: true }, { keyCode: 229 }
        ]) assert(!press('d', options));
        fixture.addEventListener('keydown', event => event.preventDefault(), { once: true });
        press('d', {}, fixture);
        assert(clicks.length === 0);
    });

    test('숨김, 비활성 및 요청 중인 버튼 제외', () => {
        const button = download();
        for (const css of ['display:none', 'visibility:hidden', 'opacity:0', 'pointer-events:none']) {
            button.style.cssText = css;
            assert(!press('d') && clicks.length === 0, css);
        }
        button.style.cssText = '';
        fixture.hidden = true;
        assert(!press('d'));
        fixture.hidden = false;
        button.setAttribute('aria-disabled', 'true');
        assert(!press('d'));
        button.removeAttribute('aria-disabled');
        button.remove();
        fixture.innerHTML = '<button id="clink-open-btn" disabled>링크 열람</button>';
        assert(!press('d'));
    });

    test('여러 다운로드 주소 표시 및 숫자 키로 지정한 원본 버튼만 실행', () => {
        download(1);
        const second = download(2);
        second.dataset.downloadUrl += '?title=<img src=x onerror=alert(1)>';
        assert(press('d') && clicks.length === 0);
        assert(modal().querySelectorAll('.row').length === 2);
        assert(modal().querySelectorAll('kbd')[1].textContent === '2');
        assert(modal().querySelectorAll('.url')[1].textContent === second.dataset.downloadUrl);
        assert(!modal().querySelector('img'));
        assert(press('2', { code: 'Numpad2' }, modal().activeElement));
        assert(clicks.join() === '2' && !modal());
    });

    test('모달 버튼 클릭과 Esc 닫기, 포커스 복원', () => {
        const previous = document.createElement('button');
        previous.textContent = '이전 포커스';
        fixture.appendChild(previous);
        download(1);
        download(2);
        previous.focus();
        press('d');
        press('Escape', {}, modal().activeElement);
        assert(!modal() && clicks.length === 0 && document.activeElement === previous);
        press('d');
        modal().querySelectorAll('.download')[1].click();
        assert(!modal() && clicks.join() === '2');
    });

    test('다운로드 자동 갱신 표시는 단축키와 선택 모달에서만 전달한다', () => {
        const button = download(1);
        const triggers = [];
        button.addEventListener('click', () => triggers.push(BookShortcuts.isDownloadTrigger(button)));
        button.click();
        press('d');
        assert(!BookShortcuts.isDownloadTrigger(button));
        download(2);
        press('d');
        modal().querySelector('.download').click();
        assert(JSON.stringify(triggers) === '[false,true,true]');
        button.click();
        assert(triggers[3] === false);
    });

    test('10개 이상의 주소를 9개씩 표시하고 페이지마다 1~9로 선택', () => {
        for (let index = 1; index <= 12; index++) download(index);
        press('d');
        assert(modal().querySelectorAll('.row').length === 9);
        press('ArrowRight', {}, modal().activeElement);
        assert(modal().querySelectorAll('.row').length === 3);
        assert(modal().querySelector('.url').textContent.endsWith('/10'));
        press('ArrowLeft', {}, modal().activeElement);
        modal().querySelector('.next').click();
        press('3', {}, modal().activeElement);
        assert(clicks.join() === '12');
    });

    test('모달에서 D를 다시 눌러도 중복 표시/다운로드하지 않는다', () => {
        download(1);
        download(2);
        press('d');
        press('d', {}, modal().activeElement);
        assert(document.querySelectorAll('#bm-download-shortcut-modal').length === 1);
        assert(!press('9', {}, modal().activeElement) && clicks.length === 0);
    });

    test('선택 직전 삭제되거나 요청 중으로 바뀐 버튼은 실행하지 않는다', () => {
        const first = download(1);
        const second = download(2);
        press('d');
        first.remove();
        press('1', {}, modal().activeElement);
        assert(!modal() && clicks.length === 0);
        download(3);
        press('d');
        second.style.pointerEvents = 'none';
        press('1', {}, modal().activeElement);
        assert(!modal() && clicks.length === 0);
    });

    test('모달 표시 중 끄면 즉시 닫고 숫자 키도 동작하지 않는다', () => {
        download(1);
        download(2);
        press('d');
        controller.setEnabled(false);
        assert(!modal() && !press('1') && clicks.length === 0);
    });

    test('확장 컨텍스트가 만료되면 다운로드를 실행하지 않는다', () => {
        download();
        valid = false;
        assert(!press('d') && clicks.length === 0);
    });

    test('사이트의 다른 모달이 열려 있으면 D를 실행하지 않는다', () => {
        download();
        const dialog = document.createElement('dialog');
        dialog.textContent = '다른 작업';
        fixture.appendChild(dialog);
        dialog.showModal();
        assert(!press('d') && clicks.length === 0);
        dialog.close();
    });

    return results;
}
