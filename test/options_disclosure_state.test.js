const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'options.js'), 'utf8');
const start = source.indexOf('function initializeOptionDisclosures()');
const end = source.indexOf("document.addEventListener('DOMContentLoaded'", start);
assert.ok(start >= 0 && end > start, '옵션 disclosure 초기화 함수가 있어야 한다.');
const disclosureSource = source.slice(start, end);
const settle = () => new Promise(resolve => setImmediate(resolve));
const panelIds = ['allowedSitesPanel', 'filterWordsPanel', 'editionKeywordsPanel', 'everythingGuidePanel', 'quickButtonVisibilityPanel', 'googleSyncPanel'];
const keyFor = id => id === 'bulkPanel' ? 'bulkPanelCollapsed' : `optionsPanelExpanded:${id}`;

function createHarness(initialStorage = {}) {
    const stored = { ...initialStorage };
    const reads = [];
    const writes = [];
    const storageListeners = [];
    const toasts = [];
    const errors = [];
    const controllers = new Map();
    const panels = new Map();
    const bulkLabels = [];

    function makeTrigger() {
        const listeners = [];
        return {
            addEventListener(name, listener) {
                assert.equal(name, 'click');
                listeners.push(listener);
            },
            click() { listeners.forEach(listener => listener({ preventDefault() {} })); }
        };
    }

    for (const [index, id] of panelIds.entries()) {
        const trigger = makeTrigger();
        panels.set(id, {
            id,
            open: index < 3,
            trigger,
            querySelector(selector) {
                assert.equal(selector, ':scope > summary');
                return trigger;
            }
        });
    }
    const bulkPanel = { id: 'bulkPanel', collapsed: false, trigger: makeTrigger() };
    bulkPanel.classList = {
        contains: name => name === 'is-collapsed' && bulkPanel.collapsed,
        toggle(name, value) {
            assert.equal(name, 'is-collapsed');
            bulkPanel.collapsed = value;
        }
    };
    panels.set('bulkPanel', bulkPanel);

    vm.runInNewContext(`${disclosureSource}\ninitializeOptionDisclosures();`, {
        document: {
            querySelectorAll(selector) {
                assert.equal(selector, 'details[id]');
                return panelIds.map(id => panels.get(id));
            }
        },
        bulkPanel,
        bulkPanelToggle: bulkPanel.trigger,
        updateBulkPanelToggle: value => bulkLabels.push(value),
        LibraryMotion: {
            bindDisclosure(panel, trigger, options) {
                let expanded = options.expanded;
                const controller = {
                    calls: [],
                    getExpanded: () => expanded,
                    setExpanded(value, settings = {}) {
                        expanded = value === true;
                        controller.calls.push({ expanded, animate: settings.animate !== false });
                        options.onChange?.(expanded);
                        options.render(expanded);
                        return Promise.resolve();
                    }
                };
                options.onChange?.(expanded);
                options.render(expanded);
                trigger.addEventListener('click', () => controller.setExpanded(!expanded));
                controllers.set(panel.id, controller);
                return controller;
            }
        },
        storageLocalGet(defaults) {
            const snapshot = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
                key, Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : value
            ]));
            return new Promise((resolve, reject) => reads.push({ snapshot, resolve, reject }));
        },
        storageLocalSet(values) {
            return new Promise((resolve, reject) => writes.push({ values: { ...values }, resolve, reject }));
        },
        chrome: { storage: { onChanged: { addListener: listener => storageListeners.push(listener) } } },
        showInfoToast: (message, isError) => toasts.push({ message, isError }),
        console: { error: (...args) => errors.push(args) }
    });

    function change(values, areaName = 'local') {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: stored[key], newValue: value };
            if (areaName === 'local') {
                if (value === undefined) delete stored[key];
                else stored[key] = value;
            }
        }
        storageListeners.forEach(listener => listener(changes, areaName));
    }
    return {
        stored, reads, writes, controllers, panels, toasts, errors, bulkLabels,
        click: id => panels.get(id).trigger.click(),
        expanded: id => controllers.get(id).getExpanded(),
        resolveRead(index) { reads[index].resolve(reads[index].snapshot); },
        finishWrite(index) { change(writes[index].values); writes[index].resolve(); },
        failWrite(index) { writes[index].reject(new Error('storage unavailable')); },
        change
    };
}

test('7개 패널 상태를 독립 복원하고 bulk는 기존 collapsed 키의 반전 의미를 유지한다', async () => {
    const stored = Object.fromEntries(panelIds.map((id, index) => [keyFor(id), index % 2 === 1]));
    stored.bulkPanelCollapsed = true;
    const fixture = createHarness(stored);
    fixture.resolveRead(0);
    await settle();
    panelIds.forEach((id, index) => assert.equal(fixture.expanded(id), index % 2 === 1));
    assert.equal(fixture.expanded('bulkPanel'), false);
    assert.equal(fixture.panels.get('bulkPanel').collapsed, true);
    assert.equal(fixture.writes.length, 0, '초기 복원이 저장을 발생시키면 안 된다.');
    for (const id of [...panelIds, 'bulkPanel']) fixture.click(id);
    await settle();
    assert.equal(fixture.writes.length, 7);
    const pending = Object.assign({}, ...fixture.writes.map(write => write.values));
    panelIds.forEach((id, index) => assert.equal(pending[keyFor(id)], index % 2 !== 1));
    assert.equal(pending.bulkPanelCollapsed, false);
    assert.equal(Object.keys(pending).length, 7);
    for (let index = 0; index < fixture.writes.length; index++) fixture.finishWrite(index);
    await settle();
    for (let index = 1; index < fixture.reads.length; index++) fixture.resolveRead(index);
    await settle();
    assert.deepEqual(fixture.stored, pending);
});

test('저장값이 없거나 boolean이 아니면 마크업 기본값을 유지하고 삭제 시 복귀한다', async () => {
    const fixture = createHarness({
        [keyFor('allowedSitesPanel')]: 'false',
        [keyFor('everythingGuidePanel')]: 1,
        [keyFor('quickButtonVisibilityPanel')]: 'true',
        bulkPanelCollapsed: 'true'
    });
    fixture.resolveRead(0);
    await settle();
    assert.equal(fixture.expanded('allowedSitesPanel'), true);
    assert.equal(fixture.expanded('everythingGuidePanel'), false);
    assert.equal(fixture.expanded('quickButtonVisibilityPanel'), false);
    assert.equal(fixture.expanded('googleSyncPanel'), false);
    assert.equal(fixture.expanded('bulkPanel'), true);
    fixture.change({ [keyFor('allowedSitesPanel')]: false, [keyFor('quickButtonVisibilityPanel')]: true, [keyFor('googleSyncPanel')]: true, bulkPanelCollapsed: true });
    fixture.change({ [keyFor('allowedSitesPanel')]: undefined, [keyFor('quickButtonVisibilityPanel')]: undefined, [keyFor('googleSyncPanel')]: undefined, bulkPanelCollapsed: undefined });
    assert.equal(fixture.expanded('allowedSitesPanel'), true);
    assert.equal(fixture.expanded('quickButtonVisibilityPanel'), false);
    assert.equal(fixture.expanded('googleSyncPanel'), false);
    assert.equal(fixture.expanded('bulkPanel'), true);
    assert.equal(fixture.writes.length, 0);
});

test('늦은 초기 조회가 사용자 클릭으로 변경한 상태를 덮어쓰지 않는다', async () => {
    const id = 'allowedSitesPanel';
    const fixture = createHarness({ [keyFor(id)]: true });
    fixture.click(id);
    fixture.resolveRead(0);
    await settle();
    assert.equal(fixture.expanded(id), false);
    assert.equal(fixture.controllers.get(id).calls.length, 1);
    fixture.finishWrite(0);
    await settle();
    fixture.resolveRead(1);
    await settle();
    assert.equal(fixture.expanded(id), false);
});

test('늦은 초기 조회가 더 최근 외부 storage 변경을 덮어쓰지 않는다', async () => {
    const id = 'allowedSitesPanel';
    const fixture = createHarness({ [keyFor(id)]: true });
    fixture.change({ [keyFor(id)]: false });
    fixture.resolveRead(0);
    await settle();
    assert.equal(fixture.expanded(id), false);
    assert.deepEqual(fixture.controllers.get(id).calls, [{ expanded: false, animate: false }]);
    assert.equal(fixture.writes.length, 0);
});

test('빠른 클릭의 저장 순서를 보존하고 큐가 끝나면 대기 중 최종 외부 변경을 반영한다', async () => {
    const id = 'allowedSitesPanel';
    const key = keyFor(id);
    const fixture = createHarness();
    fixture.resolveRead(0);
    await settle();
    fixture.click(id);
    fixture.click(id);
    await settle();
    assert.equal(fixture.writes.length, 1);
    assert.deepEqual(fixture.writes[0].values, { [key]: false });
    fixture.finishWrite(0);
    await settle();
    assert.equal(fixture.expanded(id), true, '첫 번째 저장 echo가 최신 클릭을 덮으면 안 된다.');
    assert.equal(fixture.reads.length, 1, '대기 중인 저장이 있으면 재조회하지 않는다.');
    assert.equal(fixture.writes.length, 2);
    assert.deepEqual(fixture.writes[1].values, { [key]: true });
    fixture.finishWrite(1);
    fixture.change({ [key]: false });
    assert.equal(fixture.expanded(id), true, '저장 callback 전 외부변경은 즉시 적용하지 않는다.');
    await settle();
    assert.equal(fixture.reads.length, 2);
    fixture.resolveRead(1);
    await settle();
    assert.equal(fixture.expanded(id), false);
    assert.equal(fixture.stored[key], false);
});

test('서로 다른 패널은 독립 큐로 저장하고 한 패널 대기 중 다른 패널의 외부 변경을 적용한다', async () => {
    const first = 'allowedSitesPanel';
    const second = 'filterWordsPanel';
    const third = 'googleSyncPanel';
    const fixture = createHarness();
    fixture.resolveRead(0);
    await settle();
    fixture.click(first);
    fixture.click(second);
    await settle();
    assert.equal(fixture.writes.length, 2);
    fixture.change({ [keyFor(third)]: true });
    assert.equal(fixture.expanded(third), true);
    fixture.finishWrite(1);
    await settle();
    fixture.resolveRead(1);
    fixture.finishWrite(0);
    await settle();
    fixture.resolveRead(2);
    await settle();
    assert.equal(fixture.stored[keyFor(first)], false);
    assert.equal(fixture.stored[keyFor(second)], false);
    assert.equal(fixture.stored[keyFor(third)], true);
});

test('저장 실패 후 다음 요청을 계속 저장하고 최종 실패 시 저장된 상태로 복원한다', async () => {
    const id = 'allowedSitesPanel';
    const key = keyFor(id);
    const fixture = createHarness({ [key]: true });
    fixture.resolveRead(0);
    await settle();
    fixture.click(id);
    fixture.click(id);
    await settle();
    fixture.failWrite(0);
    await settle();
    assert.equal(fixture.writes.length, 2);
    assert.equal(fixture.toasts.length, 1);
    assert.equal(fixture.toasts[0].isError, true);
    fixture.finishWrite(1);
    await settle();
    fixture.resolveRead(1);
    await settle();
    assert.equal(fixture.expanded(id), true);
    fixture.click(id);
    await settle();
    fixture.failWrite(2);
    await settle();
    assert.equal(fixture.expanded(id), false);
    fixture.resolveRead(2);
    await settle();
    assert.equal(fixture.expanded(id), true);
    assert.equal(fixture.toasts.length, 2);
});

test('외부 동일값이나 자신의 저장 echo가 현재 모션을 다시 설정하지 않는다', async () => {
    const id = 'allowedSitesPanel';
    const key = keyFor(id);
    const fixture = createHarness();
    fixture.resolveRead(0);
    await settle();
    fixture.click(id);
    await settle();
    const controller = fixture.controllers.get(id);
    controller.calls.length = 0;
    fixture.change({ [key]: false });
    fixture.finishWrite(0);
    await settle();
    fixture.resolveRead(1);
    await settle();
    fixture.change({ [key]: false });
    assert.equal(controller.calls.length, 0);
    fixture.change({ [key]: true }, 'sync');
    assert.equal(controller.calls.length, 0, '다른 storage 영역은 무시한다.');
    assert.equal(fixture.expanded(id), false);
});

test('저장 후 재조회도 늦게 도착하면 새로운 클릭이나 외부변경을 덮지 않는다', async () => {
    for (const updateByClick of [true, false]) {
        const id = 'allowedSitesPanel';
        const key = keyFor(id);
        const fixture = createHarness();
        fixture.resolveRead(0);
        await settle();
        fixture.click(id);
        await settle();
        fixture.finishWrite(0);
        await settle();
        if (updateByClick) fixture.click(id);
        else fixture.change({ [key]: true });
        fixture.resolveRead(1);
        await settle();
        assert.equal(fixture.expanded(id), true);
    }
});
