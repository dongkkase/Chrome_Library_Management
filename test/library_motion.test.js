const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const motionSource = fs.readFileSync(path.join(__dirname, '..', 'library-motion.js'), 'utf8');

function createHarness({ reducedMotion = false, available = true, hidden = false, throwOnAnimate = false } = {}) {
    const document = { activeElement: null };
    const animations = [];
    const changes = [];
    const renders = [];
    const initialStyle = {
        height: 'auto', paddingTop: '', paddingBottom: '', overflow: 'visible',
        boxSizing: 'content-box', alignContent: 'normal'
    };
    const makeNode = (children = []) => ({
        children,
        inert: false,
        attributes: {},
        listeners: {},
        contains(target) {
            return this === target || this.children.some(child => child.contains(target));
        },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, callback) { this.listeners[name] = callback; },
        focus(options) { document.activeElement = this; this.focusOptions = options; }
    });
    const input = makeNode();
    const content = makeNode([input]);
    const originallyInertContent = makeNode();
    originallyInertContent.inert = true;
    const trigger = makeNode();
    const header = makeNode([trigger]);
    const element = makeNode([header, content, originallyInertContent]);
    element.style = { ...initialStyle };
    element.open = true;
    element.hidden = hidden;
    element.getBoundingClientRect = () => ({
        height: element.hidden ? 0
            : Number.isFinite(parseFloat(element.style.height)) ? parseFloat(element.style.height)
                : element.open ? 320 : 48,
        width: 400
    });
    const scope = {
        document,
        window: {
            matchMedia: () => ({ matches: reducedMotion }),
            getComputedStyle: target => ({
                paddingTop: target.style.paddingTop || (target.open ? '16px' : '6px'),
                paddingBottom: target.style.paddingBottom || (target.open ? '16px' : '6px')
            })
        }
    };
    if (available) {
        scope.Motion = {
            animate(target, keyframes, options) {
                if (throwOnAnimate) throw new Error('animation unavailable');
                let finish;
                let reject;
                const promise = new Promise((resolve, rejectPromise) => {
                    finish = resolve;
                    reject = rejectPromise;
                });
                const animation = {
                    keyframes,
                    options,
                    stopped: false,
                    then: promise.then.bind(promise),
                    stop() { this.stopped = true; },
                    finish,
                    reject
                };
                animations.push(animation);
                for (const [property, frames] of Object.entries(keyframes)) target.style[property] = frames[0];
                return animation;
            }
        };
    }
    const api = vm.runInNewContext(`${motionSource}\nLibraryMotion;`, scope);
    function bind(expanded = true) {
        return api.bindDisclosure(element, trigger, {
            expanded,
            render(value) { element.open = value; renders.push(value); },
            onChange(value) { changes.push(value); }
        });
    }
    const click = () => {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        trigger.listeners.click(event);
        return event;
    };
    return { api, bind, element, trigger, header, content, originallyInertContent, input, document, animations, changes, renders, initialStyle, click };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('접는 동안 내용은 남겨두고 애니메이션 완료 후 닫힌 상태를 확정한다', async () => {
    const fixture = createHarness();
    const disclosure = fixture.bind(true);
    assert.equal(fixture.animations.length, 0, '초기 상태 복원에는 모션이 없어야 한다.');
    const closing = disclosure.setExpanded(false);
    assert.equal(disclosure.getExpanded(), false);
    assert.equal(fixture.trigger.attributes['aria-expanded'], 'false');
    assert.equal(fixture.element.open, true, '접기 애니메이션 중 본문이 즉시 사라지면 안 된다.');
    assert.equal(fixture.content.inert, true);
    assert.equal(fixture.header.inert, false);
    assert.equal(fixture.element.style.overflow, 'hidden');
    assert.deepEqual(Array.from(fixture.animations[0].keyframes.height), ['320px', '48px']);
    fixture.animations[0].finish();
    await closing;
    assert.equal(fixture.element.open, false);
    assert.equal(fixture.content.inert, true);
    assert.deepEqual(fixture.element.style, fixture.initialStyle);
});

test('빠르게 다시 펼치면 현재 높이에서 반전하고 이전 완료 콜백은 최신 상태를 덮지 않는다', async () => {
    const fixture = createHarness();
    const disclosure = fixture.bind(true);
    const closing = disclosure.setExpanded(false);
    fixture.element.style.height = '174px';
    fixture.element.style.paddingTop = '10px';
    fixture.element.style.paddingBottom = '10px';
    const opening = disclosure.setExpanded(true);
    assert.equal(fixture.animations[0].stopped, true);
    await closing;
    assert.equal(fixture.animations.length, 2);
    assert.deepEqual(Array.from(fixture.animations[1].keyframes.height), ['174px', '320px']);
    assert.deepEqual(Array.from(fixture.animations[1].keyframes.paddingTop), ['10px', '16px']);
    assert.equal(fixture.element.open, true);
    assert.equal(fixture.content.inert, false);
    assert.equal(fixture.trigger.attributes['aria-expanded'], 'true');
    fixture.animations[0].finish();
    await flush();
    assert.equal(fixture.element.style.height, '174px', '이전 모션 완료가 새 모션의 높이를 복원하면 안 된다.');
    assert.equal(fixture.element.open, true);
    fixture.animations[1].finish();
    await opening;
    assert.equal(disclosure.getExpanded(), true);
    assert.equal(fixture.element.open, true);
    assert.deepEqual(fixture.element.style, fixture.initialStyle);
    assert.deepEqual(fixture.changes, [true, false, true]);
});

test('취소는 대기 Promise를 완료하고 height·padding·overflow 등 기존 스타일을 복원한다', async () => {
    const fixture = createHarness();
    fixture.element.style.overflow = 'clip';
    fixture.initialStyle.overflow = 'clip';
    const disclosure = fixture.bind(false);
    const opening = disclosure.setExpanded(true);
    assert.equal(fixture.element.style.boxSizing, 'border-box');
    await fixture.api.cancel(fixture.element);
    await opening;
    assert.equal(fixture.animations[0].stopped, true);
    assert.deepEqual(fixture.element.style, fixture.initialStyle);
    assert.equal(disclosure.getExpanded(), true);
    assert.equal(fixture.element.open, true);
    fixture.animations[0].finish();
    await flush();
    assert.deepEqual(fixture.element.style, fixture.initialStyle);
});

for (const [name, settings, callOptions] of [
    ['동작 줄이기', { reducedMotion: true }, {}],
    ['Motion 라이브러리 없음', { available: false }, {}],
    ['비활성 탭의 높이 0', { hidden: true }, {}],
    ['모션 없는 상태 복원', {}, { animate: false }]
]) {
    test(`${name}에서는 접기·펼치기를 즉시 적용한다`, async () => {
        const fixture = createHarness(settings);
        const disclosure = fixture.bind(true);
        await disclosure.setExpanded(false, callOptions);
        assert.equal(fixture.element.open, false);
        assert.equal(fixture.trigger.attributes['aria-expanded'], 'false');
        assert.equal(fixture.content.inert, true);
        await disclosure.setExpanded(true, callOptions);
        assert.equal(fixture.element.open, true);
        assert.equal(fixture.trigger.attributes['aria-expanded'], 'true');
        assert.equal(fixture.content.inert, false);
        assert.equal(fixture.originallyInertContent.inert, true);
        assert.equal(fixture.animations.length, 0);
        assert.deepEqual(fixture.element.style, fixture.initialStyle);
    });
}

test('접을 때 본문 포커스를 트리거로 돌리고 다시 펼칠 때 원래 inert 상태를 보존한다', async () => {
    const fixture = createHarness();
    const disclosure = fixture.bind(true);
    fixture.document.activeElement = fixture.input;
    const closing = disclosure.setExpanded(false);
    assert.equal(fixture.document.activeElement, fixture.trigger);
    assert.equal(fixture.trigger.focusOptions.preventScroll, true);
    assert.equal(fixture.content.inert, true);
    assert.equal(fixture.originallyInertContent.inert, true);
    fixture.animations[0].finish();
    await closing;
    const opening = disclosure.setExpanded(true);
    assert.equal(fixture.content.inert, false);
    assert.equal(fixture.originallyInertContent.inert, true);
    fixture.animations[1].finish();
    await opening;
    fixture.document.activeElement = {};
    const externalFocus = fixture.document.activeElement;
    await disclosure.setExpanded(false, { animate: false });
    assert.equal(fixture.document.activeElement, externalFocus, '영역 밖 포커스는 이동하지 않아야 한다.');
});

test('summary와 버튼 클릭은 기본 토글을 막고 요청한 상태를 한 번씩 바꾼다', async () => {
    const fixture = createHarness({ reducedMotion: true });
    const disclosure = fixture.bind(false);
    assert.equal(fixture.click().defaultPrevented, true);
    assert.equal(disclosure.getExpanded(), true);
    assert.equal(fixture.element.open, true);
    assert.equal(fixture.click().defaultPrevented, true);
    assert.equal(disclosure.getExpanded(), false);
    assert.equal(fixture.element.open, false);
    assert.deepEqual(fixture.changes, [false, true, false]);
});

test('애니메이션 시작 실패나 재생 실패 시에도 스타일과 최종 상태를 복원한다', async () => {
    const throwing = createHarness({ throwOnAnimate: true });
    await throwing.bind(true).setExpanded(false);
    assert.equal(throwing.element.open, false);
    assert.deepEqual(throwing.element.style, throwing.initialStyle);
    const rejected = createHarness();
    const closing = rejected.bind(true).setExpanded(false);
    rejected.animations[0].reject(new Error('animation interrupted'));
    await closing;
    assert.equal(rejected.element.open, false);
    assert.deepEqual(rejected.element.style, rejected.initialStyle);
});

test('spinner는 일정한 속도로 반복 회전하고 중단 시 원래 transform을 복원한다', async () => {
    const { api, element, animations } = createHarness();
    element.style.transform = 'scale(0.8)';
    const stop = api.spin(element);
    assert.deepEqual(Array.from(animations[0].keyframes.transform), ['rotate(0deg)', 'rotate(360deg)']);
    assert.equal(animations[0].options.duration, 0.8);
    assert.equal(animations[0].options.ease, 'linear');
    assert.equal(animations[0].options.repeat, Infinity);
    assert.equal(element.style.transform, 'rotate(0deg)');
    stop();
    assert.equal(animations[0].stopped, true);
    assert.equal(element.style.transform, 'scale(0.8)');
    const stopAgain = api.spin(element);
    stop();
    assert.equal(animations[1].stopped, false);
    await api.cancel(element);
    assert.equal(animations[1].stopped, true);
    assert.equal(element.style.transform, 'scale(0.8)');
    stopAgain();
});

test('spinner를 다시 시작하면 이전 회전을 취소하고 이전 완료가 새 회전을 덮지 않는다', async () => {
    const { api, element, animations } = createHarness();
    element.style.transform = '';
    api.spin(element);
    const stop = api.spin(element);
    assert.equal(animations[0].stopped, true);
    animations[0].finish();
    await flush();
    assert.equal(element.style.transform, 'rotate(0deg)');
    stop();
    assert.equal(element.style.transform, '');
});

test('모션 축소나 라이브러리 부재 시 spinner 회전을 시작하지 않는다', () => {
    for (const settings of [{ reducedMotion: true }, { available: false }, { throwOnAnimate: true }]) {
        const { api, element, animations } = createHarness(settings);
        element.style.transform = 'scale(1)';
        const stop = api.spin(element);
        assert.equal(typeof stop, 'function');
        assert.equal(animations.length, 0);
        stop();
        assert.equal(element.style.transform, 'scale(1)');
        api.spin(null)();
    }
});

test('spinner 재생 실패도 회전을 중단하고 transform을 복원한다', async () => {
    const { api, element, animations } = createHarness();
    element.style.transform = 'scale(0.9)';
    api.spin(element);
    animations[0].reject(new Error('interrupted'));
    await flush();
    assert.equal(animations[0].stopped, true);
    assert.equal(element.style.transform, 'scale(0.9)');
});
