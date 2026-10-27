const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const commonSource = fs.readFileSync(path.join(root, 'common.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'category-ui.js'), 'utf8');
const motionSource = fs.readFileSync(path.join(root, 'library-motion.js'), 'utf8');

function storageHarness(initial = {}) {
    const state = { values: { ...initial }, listeners: [], writes: [], failValue: null, holdRead: null };
    const storage = {
        onChanged: { addListener: listener => state.listeners.push(listener) },
        local: {
            get(defaults, callback) {
                const result = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, state.values[key] ?? fallback]));
                if (callback) callback(result);
                if (Object.hasOwn(defaults, 'lastRegistrationCategory') && state.holdRead) {
                    return state.holdRead.then(() => result);
                }
                return Promise.resolve(result);
            },
            async set(values) {
                await Promise.resolve();
                if (values.lastRegistrationCategory === state.failValue) throw new Error('storage write failed');
                const changes = {};
                for (const [key, newValue] of Object.entries(values)) {
                    changes[key] = { oldValue: state.values[key], newValue };
                    state.values[key] = newValue;
                }
                state.writes.push(values);
                state.listeners.forEach(listener => listener(changes, 'local'));
            }
        }
    };
    function context() {
        const scope = vm.createContext({ chrome: { storage }, console: { error() {}, warn() {} }, setTimeout, clearTimeout });
        vm.runInContext(commonSource, scope);
        const api = vm.runInContext(`${uiSource}\nBookCategoryUI;`, scope);
        return api;
    }
    return { state, storage, context };
}

test('등록 기본 분류는 초기 저장값을 읽고 다른 화면 및 재시작에 공유된다', async () => {
    const { state, context } = storageHarness({ lastRegistrationCategory: 'epub' });
    const first = context();
    const second = context();
    await Promise.all([first.ready, second.ready]);
    assert.equal(first.getRegistrationCategory(), 'epub');
    assert.equal(second.getRegistrationCategory(), 'epub');
    await first.setRegistrationCategory('comic');
    assert.equal(second.getRegistrationCategory(), 'comic');
    const reopened = context();
    await reopened.ready;
    assert.equal(reopened.getRegistrationCategory(), 'comic');
    assert.equal(state.values.lastRegistrationCategory, 'comic');
});

test('늦게 도착한 초기 읽기는 사용자가 방금 선택한 등록 분류를 되돌리지 않는다', async () => {
    const { state, context } = storageHarness({ lastRegistrationCategory: 'epub' });
    let release;
    state.holdRead = new Promise(resolve => { release = resolve; });
    const api = context();
    const saving = api.setRegistrationCategory('video');
    release();
    state.holdRead = null;
    await Promise.all([api.ready, saving]);
    assert.equal(api.getRegistrationCategory(), 'video');
    assert.equal(state.values.lastRegistrationCategory, 'video');
});

test('연속 선택 중 이전 저장 이벤트는 최신 선택을 덮어쓰지 않는다', async () => {
    const { state, context } = storageHarness();
    const api = context();
    await api.ready;
    const observed = [];
    const unsubscribe = api.subscribeRegistrationCategory(value => observed.push(value));
    await Promise.all([api.setRegistrationCategory('comic'), api.setRegistrationCategory('pdf')]);
    assert.deepEqual(observed, ['uncategorized', 'comic', 'pdf']);
    assert.equal(api.getRegistrationCategory(), 'pdf');
    assert.equal(state.values.lastRegistrationCategory, 'pdf');
    unsubscribe();
    await api.setRegistrationCategory('other');
    assert.deepEqual(observed, ['uncategorized', 'comic', 'pdf']);
});

test('저장 실패는 마지막으로 저장된 분류로 복구하고 다음 저장을 막지 않는다', async () => {
    const { state, context } = storageHarness({ lastRegistrationCategory: 'scan' });
    const api = context();
    await api.ready;
    state.failValue = 'video';
    await assert.rejects(api.setRegistrationCategory('video'), /storage write failed/);
    assert.equal(api.getRegistrationCategory(), 'scan');
    assert.equal(state.values.lastRegistrationCategory, 'scan');
    await api.setRegistrationCategory('audiobook');
    assert.equal(api.getRegistrationCategory(), 'audiobook');
});

test('필터 전체와 변경 안 함은 등록 분류 목록과 분리되고 잘못된 저장값은 미분류가 된다', async () => {
    const { context } = storageHarness({ lastRegistrationCategory: 'unknown-category' });
    const api = context();
    await api.ready;
    assert.equal(api.getRegistrationCategory(), 'uncategorized');
    assert.equal(api.categoryOptions().length, 9);
    assert.equal(api.categoryOptions({ includeAll: true })[0].value, 'all');
    assert.equal(api.categoryOptions({ includeUnchanged: true })[0].value, 'unchanged');
    assert.equal(api.categoryOptions().some(option => ['all', 'unchanged'].includes(option.value)), false);
});

test('동작 줄이기는 두 애니메이션 라이브러리를 호출하지 않는다', async () => {
    const calls = [];
    const api = vm.runInNewContext(`${motionSource}\nLibraryMotion;`, {
        window: { matchMedia: () => ({ matches: true }) },
        Motion: { animate() { calls.push('motion'); } },
        anime: { animate() { calls.push('anime'); } }
    });
    const element = { style: { opacity: '', transform: '' } };
    await api.reveal(element);
    await api.conceal(element);
    await api.feedback(element);
    assert.deepEqual(calls, []);
    assert.deepEqual(element.style, { opacity: '', transform: '' });
});

test('애니메이션 취소는 대기 중인 표시 작업을 완료하고 원래 스타일을 복원한다', async () => {
    let stopped = false;
    const api = vm.runInNewContext(`${motionSource}\nLibraryMotion;`, {
        window: { matchMedia: () => ({ matches: false }) },
        Motion: {
            animate(element) {
                element.style.opacity = '0.5';
                element.style.transform = 'translateY(3px)';
                return { then() {}, stop() { stopped = true; } };
            }
        }
    });
    const element = { style: { opacity: '0.8', transform: 'translateX(2px)' } };
    const animation = api.reveal(element);
    await api.cancel(element);
    await animation;
    assert.equal(stopped, true);
    assert.deepEqual(element.style, { opacity: '0.8', transform: 'translateX(2px)' });
});
