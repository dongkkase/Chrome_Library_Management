const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'help-navigation.js'), 'utf8');

function createHarness() {
    const listeners = new Map();
    const frames = [];
    const scroller = { scrollTop: 0, scrollHeight: 3600, clientHeight: 800 };
    const focus = { id: 'reading-control' };
    const locations = [110, 900, 1900, 3200];
    const sections = ['intro', 'examples', 'tab-books', 'troubleshooting'].map((id, index) => ({
        id,
        getBoundingClientRect: () => ({ top: locations[index] - scroller.scrollTop })
    }));
    let sidebar;
    const links = sections.map((section, index) => ({
        attributes: { href: `#${section.id}` },
        getAttribute(name) { return this.attributes[name]; },
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this.attributes[name]; },
        getBoundingClientRect() {
            const top = 104 + index * 38 - sidebar.scrollTop;
            return { top, bottom: top + 34 };
        }
    }));
    sidebar = {
        scrollTop: 0, scrollHeight: 152, clientHeight: 90,
        querySelectorAll: () => links,
        getBoundingClientRect: () => ({ top: 104, bottom: 194 })
    };
    let resizeContent;
    const document = {
        documentElement: scroller,
        scrollingElement: scroller,
        activeElement: focus,
        querySelector(selector) {
            if (selector === '.sidebar') return sidebar;
            if (selector === '.page-header') return { getBoundingClientRect: () => ({ bottom: 68 }) };
        },
        querySelectorAll: () => sections
    };
    const window = {
        location: { hash: '#tab-books' },
        requestAnimationFrame(callback) { frames.push(callback); },
        addEventListener(name, callback) { listeners.set(name, callback); },
        getComputedStyle: element => element === scroller ? { scrollPaddingTop: '90px' } : { scrollMarginTop: '20px' }
    };
    vm.runInNewContext(source, {
        document, window,
        ResizeObserver: class {
            constructor(callback) { resizeContent = callback; }
            observe() {}
        }
    });
    const flush = () => { while (frames.length) frames.shift()(); };
    const event = name => { listeners.get(name)(); flush(); };
    const active = () => links.filter(link => link.attributes['aria-current'] === 'location').map(link => link.attributes.href);
    flush();
    return { scroller, sidebar, locations, document, window, focus, active, event, frames, listeners, flush, resizeContent };
}

test('스크롤 위치로 현재 목차를 고르고 기존 URL 해시와 키보드 포커스는 유지한다', () => {
    const fixture = createHarness();
    assert.deepEqual(fixture.active(), ['#intro']);
    fixture.scroller.scrollTop = 900 - 110;
    fixture.event('scroll');
    assert.deepEqual(fixture.active(), ['#examples']);
    fixture.scroller.scrollTop = 1950;
    fixture.event('scroll');
    assert.deepEqual(fixture.active(), ['#tab-books']);
    fixture.scroller.scrollTop = 0;
    fixture.event('scroll');
    assert.deepEqual(fixture.active(), ['#intro']);
    assert.equal(fixture.window.location.hash, '#tab-books');
    assert.equal(fixture.document.activeElement, fixture.focus);
});

test('페이지 하단의 짧은 마지막 섹션과 직접 링크로 이동한 위치를 반영한다', () => {
    const fixture = createHarness();
    fixture.scroller.scrollTop = 2800;
    fixture.event('scroll');
    assert.deepEqual(fixture.active(), ['#troubleshooting']);
    fixture.scroller.scrollTop = 1900 - 110;
    fixture.event('hashchange');
    assert.deepEqual(fixture.active(), ['#tab-books']);
    fixture.scroller.scrollTop = 900 - 110;
    fixture.event('pageshow');
    assert.deepEqual(fixture.active(), ['#examples']);
});

test('본문 높이와 화면 크기가 바뀌면 현재 섹션을 다시 계산한다', () => {
    const fixture = createHarness();
    fixture.scroller.scrollTop = 1000;
    fixture.event('scroll');
    assert.deepEqual(fixture.active(), ['#examples']);
    fixture.locations[2] = 1080;
    fixture.resizeContent();
    fixture.flush();
    assert.deepEqual(fixture.active(), ['#tab-books']);
    fixture.locations[2] = 1900;
    fixture.event('resize');
    assert.deepEqual(fixture.active(), ['#examples']);
});

test('짧은 목차 영역만 스크롤하고 연속 스크롤 이벤트는 한 프레임으로 묶는다', () => {
    const fixture = createHarness();
    fixture.scroller.scrollTop = 2800;
    for (let i = 0; i < 6; i++) fixture.listeners.get('scroll')();
    assert.equal(fixture.frames.length, 1);
    fixture.flush();
    assert.ok(fixture.sidebar.scrollTop > 0);
    assert.equal(fixture.scroller.scrollTop, 2800);
    assert.equal(fixture.document.activeElement, fixture.focus);
});

test('스크롤할 필요가 없는 화면에서는 첫 섹션을 현재 위치로 유지한다', () => {
    const fixture = createHarness();
    fixture.scroller.scrollHeight = fixture.scroller.clientHeight;
    fixture.event('resize');
    assert.deepEqual(fixture.active(), ['#intro']);
});
