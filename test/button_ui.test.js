const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'button-ui.js'), 'utf8');

function createHarness() {
    const spins = [];
    const document = { createElement: tagName => new Element(tagName) };
    class Element {
        constructor(tagName) {
            this.tagName = tagName;
            this.ownerDocument = document;
            this.childNodes = [];
            this.parentNode = null;
            this.attributes = new Map();
            this.disabled = false;
            this.className = '';
            this.text = '';
            this.style = { setProperty(name, value) { this[name] = value; } };
            this.classList = {
                contains: name => this.className.split(' ').includes(name),
                add: name => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), name])].join(' '); },
                remove: name => { this.className = this.className.split(' ').filter(item => item !== name).join(' '); }
            };
        }
        append(...nodes) {
            for (const node of nodes) {
                node.remove();
                this.childNodes.push(node);
                node.parentNode = this;
            }
        }
        replaceChildren(...nodes) {
            for (const child of [...this.childNodes]) child.remove();
            this.append(...nodes);
        }
        remove() {
            if (!this.parentNode) return;
            this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this);
            this.parentNode = null;
        }
        get textContent() { return this.text + this.childNodes.map(node => node.textContent).join(''); }
        set textContent(value) { this.replaceChildren(); this.text = value; }
        getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
        setAttribute(name, value) { this.attributes.set(name, String(value)); }
        removeAttribute(name) { this.attributes.delete(name); }
    }
    const api = vm.runInNewContext(`${source}\nButtonUI;`, {
        chrome: { runtime: { getURL: name => `chrome-extension://test/${name}` } },
        LibraryMotion: {
            spin(element) {
                const spin = { element, stopped: 0 };
                spins.push(spin);
                return () => { spin.stopped++; };
            }
        }
    });
    const button = document.createElement('button');
    const icon = document.createElement('span');
    icon.className = 'original-icon';
    const label = document.createElement('span');
    label.textContent = '저장';
    label.listener = () => 'original listener';
    button.append(icon, label);
    return { api, button, icon, label, spins, document };
}

test('처리 중 원래 노드와 버튼 크기를 유지하는 내용 래퍼와 회전 아이콘을 표시한다', () => {
    const { api, button, icon, label, spins } = createHarness();
    const finish = api.start(button);
    assert.equal(typeof finish, 'function');
    assert.equal(button.disabled, true);
    assert.equal(button.classList.contains('is-busy'), true);
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.equal(button.getAttribute('aria-label'), '저장 처리 중');
    const [content, spinner] = button.childNodes;
    assert.equal(content.className, 'button-busy-content');
    assert.equal(content.style.display, 'contents');
    assert.deepEqual(content.childNodes, [icon, label]);
    assert.equal(spinner.className, 'button-busy-spinner');
    assert.equal(spinner.getAttribute('aria-hidden'), 'true');
    assert.equal(spins[0].element, spinner.childNodes[0]);
    assert.match(spins[0].element.style['--action-icon'], /chrome-extension:\/\/test\/images\/spinner-solid-full\.svg/);
    finish();
    assert.deepEqual(button.childNodes, [icon, label]);
    assert.equal(label.listener(), 'original listener');
    assert.equal(spins[0].stopped, 1);
    assert.equal(button.disabled, false);
    assert.equal(button.classList.contains('is-busy'), false);
    assert.equal(button.getAttribute('aria-busy'), null);
    assert.equal(button.getAttribute('aria-label'), null);
});

test('비동기 작업의 결과가 나올 때까지 busy를 유지하고 결과를 전달한다', async () => {
    const { api, button } = createHarness();
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const result = api.run(button, () => pending);
    await Promise.resolve();
    assert.equal(button.disabled, true);
    resolve({ saved: 1 });
    assert.deepEqual(await result, { saved: 1 });
    assert.equal(button.disabled, false);
});

test('작업 중 두 번째 실행과 기존 비활성 버튼 실행을 차단한다', async () => {
    const { api, button, spins } = createHarness();
    let calls = 0;
    const finish = api.start(button);
    assert.equal(api.start(button), null);
    assert.equal(await api.run(button, () => { calls++; }), undefined);
    assert.equal(calls, 0);
    assert.equal(spins.length, 1);
    finish();
    button.disabled = true;
    assert.equal(api.start(button), null);
    await api.run(button, () => { calls++; });
    assert.equal(calls, 0);
    assert.equal(button.disabled, true);
});

test('동기 예외와 Promise 실패를 전달하면서 원래 DOM과 접근성 속성을 복원한다', async () => {
    for (const asynchronous of [false, true]) {
        const { api, button, icon, label, spins } = createHarness();
        button.setAttribute('aria-label', '도서 저장');
        button.setAttribute('aria-busy', 'false');
        const error = new Error('저장 실패');
        const operation = () => {
            if (asynchronous) return Promise.reject(error);
            throw error;
        };
        await assert.rejects(api.run(button, operation), candidate => candidate === error);
        assert.deepEqual(button.childNodes, [icon, label]);
        assert.equal(button.getAttribute('aria-label'), '도서 저장');
        assert.equal(button.getAttribute('aria-busy'), 'false');
        assert.equal(button.disabled, false);
        assert.equal(spins[0].stopped, 1);
    }
});

test('DOM에서 제거된 버튼도 정리하며 반복 cleanup은 새 작업을 변경하지 않는다', () => {
    const { api, button, document, spins } = createHarness();
    const parent = document.createElement('div');
    parent.append(button);
    button.classList.add('is-busy');
    const finish = api.start(button);
    button.remove();
    finish();
    assert.equal(button.parentNode, null);
    assert.equal(button.classList.contains('is-busy'), true);
    const nextFinish = api.start(button);
    finish();
    assert.equal(button.disabled, true);
    assert.equal(spins[0].stopped, 1);
    assert.equal(spins[1].stopped, 0);
    nextFinish();
    nextFinish();
    assert.equal(spins[1].stopped, 1);
    assert.equal(button.disabled, false);
});

test('버튼이 없는 작업도 실행하고 아이콘 버튼은 title을 처리 중 레이블로 사용한다', async () => {
    const { api, button } = createHarness();
    assert.equal(typeof api.start(null), 'function');
    assert.equal(await api.run(null, () => 42), 42);
    button.textContent = '   ';
    button.setAttribute('title', '삭제');
    const finish = api.start(button);
    assert.equal(button.getAttribute('aria-label'), '삭제 처리 중');
    finish();
});
