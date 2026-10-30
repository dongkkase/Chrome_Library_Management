const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
const bookUiSource = fs.readFileSync(path.join(root, 'book-ui.js'), 'utf8');
const start = optionsSource.indexOf('function initializeQuickButtonSettings()');
const end = optionsSource.indexOf('function requestRuntimeResult(', start);
const quickSettingsSource = optionsSource.slice(start, end);
const plain = value => JSON.parse(JSON.stringify(value));

function createHarness(initial = {}, overrides = {}) {
    const elements = {};
    class Element {
        constructor() {
            this.children = [];
            this.dataset = {};
            this.attributes = {};
            this.listeners = {};
            this.checked = false;
            this.disabled = false;
            this.hidden = false;
            this.inert = false;
            this.textContent = '';
        }
        set id(value) { this._id = value; elements[value] = this; }
        get id() { return this._id; }
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.append(child); }
        setAttribute(name, value) { this.attributes[name] = value; }
        getAttribute(name) { return this.attributes[name] ?? null; }
        addEventListener(type, callback) { this.listeners[type] = callback; }
    }
    for (const id of ['quickButtonVisibilityControls', 'quickButtonSettingsStatus', 'showListQuickBtnCheckbox', 'showListQuickBtnHoverCheckbox', 'quickButtonsCompactCheckbox', 'quickButtonsMiniCheckbox', 'quickMiniSettingsPanel']) {
        const element = new Element();
        element.id = id;
    }
    const stored = { ...initial };
    const writes = [];
    const listeners = [];
    const slideCalls = [];
    const miniPanel = elements.quickMiniSettingsPanel;
    miniPanel.hidden = true;
    miniPanel.inert = true;
    miniPanel.setAttribute('aria-hidden', 'true');
    elements.quickButtonsCompactCheckbox.setAttribute('aria-controls', miniPanel.id);
    elements.quickButtonsCompactCheckbox.setAttribute('aria-expanded', 'false');
    let failNextWrite = false;
    const emit = (changes, area = 'local') => listeners.forEach(listener => listener(changes, area));
    const context = vm.createContext({
        document: {
            getElementById: id => elements[id],
            createElement: () => new Element()
        },
        console: { error() {} },
        LibraryMotion: {
            createSlidePanel(panel, { focusTarget }) {
                assert.equal(panel, miniPanel);
                assert.equal(focusTarget, elements.quickButtonsCompactCheckbox);
                let expanded = false;
                return {
                    getExpanded: () => expanded,
                    setExpanded(next, { animate = true } = {}) {
                        expanded = next === true;
                        slideCalls.push({ expanded, animate });
                        panel.hidden = !expanded;
                        panel.inert = !expanded;
                        panel.setAttribute('aria-hidden', String(!expanded));
                        focusTarget.setAttribute('aria-expanded', String(expanded));
                        return Promise.resolve();
                    }
                };
            }
        },
        chrome: { storage: { onChanged: { addListener: listener => listeners.push(listener) } } },
        storageLocalGet: async defaults => plain({ ...defaults, ...stored }),
        storageLocalSet: async values => {
            if (failNextWrite) {
                failNextWrite = false;
                throw new Error('write failed');
            }
            writes.push(plain(values));
            Object.assign(stored, plain(values));
            emit(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }])));
        },
        ...overrides
    });
    vm.runInContext(`${bookUiSource}\n${quickSettingsSource}`, context);
    return {
        elements, stored, writes, emit, slideCalls,
        initialize: () => context.initializeQuickButtonSettings(),
        failWrite: () => { failNextWrite = true; },
        change(id, value) {
            const input = elements[id];
            assert.equal(input.disabled, false, `${id} should be editable`);
            input.checked = value;
            return input.listeners.change();
        }
    };
}

function assertMiniPanel(harness, expanded) {
    const { quickMiniSettingsPanel: panel, quickButtonsCompactCheckbox: parent } = harness.elements;
    assert.equal(panel.hidden, !expanded);
    assert.equal(panel.inert, !expanded);
    assert.equal(panel.getAttribute('aria-hidden'), String(!expanded));
    assert.equal(parent.getAttribute('aria-controls'), panel.id);
    assert.equal(parent.getAttribute('aria-expanded'), String(expanded));
}

test('기존 사용자는 모든 퀵 메뉴를 글자 버튼으로 표시하고 목록 표시만 별도로 선택한다', async () => {
    const harness = createHarness();
    await harness.initialize();
    assert.equal(harness.elements.quickButtonVisibilityControls.children.length, 11);
    assert.equal(harness.elements.quickButtonsCompactCheckbox.checked, false);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.checked, false);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.disabled, true);
    assertMiniPanel(harness, false);
    assert.equal(harness.slideCalls.some(call => call.expanded), false);
    assert.equal(harness.elements.showListQuickBtnHoverCheckbox.disabled, true);
    for (const action of ['category', 'copy', 'exclude', 'incomplete', 'complete', 'delete', 'missing_vol', 'search', 'ridi_preview', 'everything_search', 'correct_title']) {
        const input = harness.elements[`quickButtonVisibility-${action}`];
        assert.equal(input.checked, true);
        assert.equal(input.disabled, false);
        assert.equal(input.attributes.role, 'switch');
        assert.ok(input.attributes['aria-label'].endsWith(' 표시'));
    }
    assert.equal(harness.elements.quickButtonsCompactCheckbox.disabled, false);
});

test('부모 표시를 껐다 켜도 마우스 오버 설정과 버튼별 설정은 보존한다', async () => {
    const harness = createHarness({ showListQuickBtn: true, showListQuickBtnHover: true, quickButtonsCompact: true, quickButtonVisibility: { copy: false } });
    await harness.initialize();
    await harness.change('showListQuickBtnCheckbox', false);
    assert.equal(harness.elements.showListQuickBtnHoverCheckbox.checked, true);
    assert.equal(harness.elements.showListQuickBtnHoverCheckbox.disabled, true);
    assert.equal(harness.elements.quickButtonsCompactCheckbox.checked, true);
    assert.equal(harness.elements.quickButtonsCompactCheckbox.disabled, false);
    assert.equal(harness.elements['quickButtonVisibility-copy'].checked, false);
    await harness.change('showListQuickBtnCheckbox', true);
    assert.equal(harness.elements.showListQuickBtnHoverCheckbox.disabled, false);
    assert.equal(harness.elements.showListQuickBtnHoverCheckbox.checked, true);
});

test('미니 모드는 아이콘 표시를 꺼도 선택값을 보존하고 재시작과 재활성화 시 복구한다', async () => {
    const harness = createHarness({ quickButtonsCompact: true });
    await harness.initialize();
    assertMiniPanel(harness, true);
    assert.equal(harness.slideCalls.find(call => call.expanded)?.animate, false, '저장된 초기 펼침 상태는 모션 없이 복원합니다.');
    assert.equal(harness.elements.quickButtonsMiniCheckbox.disabled, false);
    await harness.change('quickButtonsMiniCheckbox', true);
    assert.equal(harness.stored.quickButtonsMini, true);
    const closing = harness.change('quickButtonsCompactCheckbox', false);
    assertMiniPanel(harness, false);
    assert.deepEqual(harness.slideCalls.at(-1), { expanded: false, animate: true });
    await closing;
    assert.equal(harness.elements.quickButtonsMiniCheckbox.checked, true);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.disabled, true);
    assert.equal(harness.stored.quickButtonsMini, true);

    const reopened = createHarness(harness.stored);
    await reopened.initialize();
    assertMiniPanel(reopened, false);
    assert.equal(reopened.elements.quickButtonsMiniCheckbox.checked, true);
    assert.equal(reopened.elements.quickButtonsMiniCheckbox.disabled, true);
    await reopened.change('quickButtonsCompactCheckbox', true);
    assertMiniPanel(reopened, true);
    assert.ok(reopened.slideCalls.some(call => call.expanded && call.animate));
    assert.equal(reopened.elements.quickButtonsMiniCheckbox.checked, true);
    assert.equal(reopened.elements.quickButtonsMiniCheckbox.disabled, false);
    await reopened.change('quickButtonsMiniCheckbox', false);
    assert.equal(reopened.stored.quickButtonsMini, false);
});

test('미니 모드 저장 실패는 이전 값으로 복원하고 다음 선택을 저장한다', async () => {
    const harness = createHarness({ quickButtonsCompact: true, quickButtonsMini: true });
    await harness.initialize();
    assertMiniPanel(harness, true);
    harness.slideCalls.length = 0;
    harness.failWrite();
    const parentSave = harness.change('quickButtonsCompactCheckbox', false);
    assertMiniPanel(harness, false);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.checked, true);
    await parentSave;
    assertMiniPanel(harness, true);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.checked, true);
    assert.ok(harness.slideCalls.some(call => !call.expanded && call.animate));
    assert.ok(harness.slideCalls.some(call => call.expanded && call.animate));
    harness.failWrite();
    await harness.change('quickButtonsMiniCheckbox', false);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.checked, true);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.disabled, false);
    assert.match(harness.elements.quickButtonSettingsStatus.textContent, /저장하지 못했습니다/);
    await harness.change('quickButtonsMiniCheckbox', false);
    assert.equal(harness.stored.quickButtonsMini, false);
    assert.equal(harness.elements.quickButtonSettingsStatus.textContent, '');
});

test('여러 표시 스위치를 연이어 바꿔도 기존 및 다른 창의 설정을 함께 저장한다', async () => {
    const harness = createHarness({ quickButtonVisibility: { copy: false } });
    await harness.initialize();
    harness.stored.quickButtonVisibility = { copy: false, search: false };
    const first = harness.change('quickButtonVisibility-delete', false);
    const second = harness.change('quickButtonVisibility-ridi_preview', false);
    await Promise.all([first, second]);
    assert.deepEqual(harness.stored.quickButtonVisibility, { copy: false, search: false, delete: false, ridi_preview: false });
    assert.equal(harness.elements['quickButtonVisibility-search'].checked, false);
    assert.equal(harness.elements['quickButtonVisibility-ridi_preview'].disabled, false);
    await harness.change('quickButtonsCompactCheckbox', true);
    assert.equal(harness.stored.quickButtonsCompact, true);
});

test('저장 실패 시 실제 저장값으로 복원하고 다시 조작할 수 있다', async () => {
    const harness = createHarness();
    await harness.initialize();
    harness.failWrite();
    await harness.change('quickButtonVisibility-copy', false);
    assert.equal(harness.elements['quickButtonVisibility-copy'].checked, true);
    assert.equal(harness.elements['quickButtonVisibility-copy'].disabled, false);
    assert.match(harness.elements.quickButtonSettingsStatus.textContent, /저장하지 못했습니다/);
    await harness.change('quickButtonVisibility-copy', false);
    assert.equal(harness.stored.quickButtonVisibility.copy, false);
    assert.equal(harness.elements.quickButtonSettingsStatus.textContent, '');
});

test('다른 옵션창의 변경과 설정 삭제를 즉시 반영한다', async () => {
    const harness = createHarness();
    await harness.initialize();
    harness.emit({ quickButtonVisibility: { newValue: { copy: false } }, quickButtonsCompact: { newValue: true }, quickButtonsMini: { newValue: true }, showListQuickBtn: { newValue: true } });
    assertMiniPanel(harness, true);
    assert.deepEqual(harness.slideCalls.at(-1), { expanded: true, animate: true });
    assert.equal(harness.elements['quickButtonVisibility-copy'].checked, false);
    assert.equal(harness.elements['quickButtonVisibility-delete'].checked, true);
    assert.equal(harness.elements.quickButtonsCompactCheckbox.checked, true);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.checked, true);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.disabled, false);
    assert.equal(harness.elements.showListQuickBtnHoverCheckbox.disabled, false);
    harness.emit({ quickButtonVisibility: {}, quickButtonsCompact: {}, quickButtonsMini: {} });
    assertMiniPanel(harness, false);
    assert.deepEqual(harness.slideCalls.at(-1), { expanded: false, animate: true });
    assert.equal(harness.elements['quickButtonVisibility-copy'].checked, true);
    assert.equal(harness.elements.quickButtonsCompactCheckbox.checked, false);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.checked, false);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.disabled, true);
    harness.emit({ quickButtonVisibility: { newValue: { copy: false } } }, 'sync');
    assert.equal(harness.elements['quickButtonVisibility-copy'].checked, true);
});

test('늦게 완료된 초기 읽기가 먼저 도착한 저장소 변경을 덮어쓰지 않는다', async () => {
    let resolveRead;
    const harness = createHarness({}, { storageLocalGet: () => new Promise(resolve => { resolveRead = resolve; }) });
    const initialized = harness.initialize();
    assertMiniPanel(harness, false);
    harness.emit({ quickButtonsCompact: { newValue: true }, quickButtonsMini: { newValue: true }, quickButtonVisibility: { newValue: { category: false } } });
    assertMiniPanel(harness, false);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.disabled, true);
    resolveRead({ quickButtonsCompact: false, quickButtonsMini: false, quickButtonVisibility: {}, showListQuickBtn: false, showListQuickBtnHover: false });
    await initialized;
    assertMiniPanel(harness, true);
    assert.equal(harness.slideCalls.find(call => call.expanded)?.animate, false, '초기 조회 중 도착한 변경도 준비 완료 후 모션 없이 복원합니다.');
    assert.equal(harness.elements.quickButtonsCompactCheckbox.checked, true);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.checked, true);
    assert.equal(harness.elements.quickButtonsMiniCheckbox.disabled, false);
    assert.equal(harness.elements['quickButtonVisibility-category'].checked, false);
});
