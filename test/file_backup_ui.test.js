const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'file-backup-ui.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

async function harness({ hash = '', popup = false, destination = null, windowError = null, cancelPicker = false } = {}) {
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) {
            const listeners = new Map();
            elements.set(id, {
                hidden: true, disabled: true, checked: false, textContent: '',
                addEventListener: (event, listener) => listeners.set(event, listener),
                click: () => listeners.get('click')?.(),
                scrollIntoView() {}
            });
        }
        return elements.get(id);
    }
    const calls = { tabs: [], messages: [], picks: 0, grants: 0, stored: 0 };
    const status = { enabled: true, busy: false, destination, lastCompletedAt: 0, lastBackupMatchesDestination: true, error: '' };
    const window = {
        location: { hash, search: '' },
        addEventListener() {},
        async showDirectoryPicker() {
            calls.picks++;
            if (cancelPicker) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
            return { kind: 'directory', name: '선택 폴더' };
        }
    };
    const chrome = {
        extension: { getViews: () => popup ? [window] : [] },
        tabs: { async create(value) {
            calls.tabs.push(value);
            return { id: 42 };
        } },
        runtime: {
            getURL: file => `chrome-extension://test/${file}`,
            async sendMessage(message) {
                calls.messages.push(message);
                if (message.action === 'FILE_BACKUP_OPEN_FOLDER_WINDOW' && windowError) return { ok: false, error: windowError };
                if (message.action === 'FILE_BACKUP_USE_FOLDER') status.destination = { id: message.id, label: message.label, permission: 'granted' };
                if (message.action === 'FILE_BACKUP_FOLDER_ACCESS') status.destination.permission = 'granted';
                if (message.action === 'FILE_BACKUP_DEFAULT_FOLDER') status.destination = null;
                return { ok: true, status: structuredClone(status) };
            }
        },
        storage: { onChanged: { addListener() {} } }
    };
    vm.runInNewContext(source, {
        window, chrome, URLSearchParams,
        document: { getElementById: element, querySelector: element, addEventListener() {} },
        FileBackupFolder: {
            NAME: 'LibraryMatchingManagerBackups',
            async get() { return { handle: { async requestPermission() { calls.grants++; return 'granted'; } } }; },
            async storeSelection() { calls.stored++; return { id: 'chosen', label: '선택 폴더 → LibraryMatchingManagerBackups' }; }
        }
    });
    await flush();
    return { calls, status, element, async click(id) { element(id).click(); await flush(); } };
}

for (const [surface, options] of [['사이드 패널', { hash: '#sidepanel' }], ['팝업', { popup: true }]]) {
    test(`${surface}의 폴더 변경은 전용 창을 요청하고 전체 설정 탭을 열지 않는다`, async () => {
        const h = await harness(options);
        await h.click('fileBackupChooseFolder');
        assert.equal(h.calls.tabs.length, 0);
        assert.equal(h.calls.messages.at(-1).action, 'FILE_BACKUP_OPEN_FOLDER_WINDOW');
        assert.equal(h.calls.picks, 0);
        assert.equal(h.calls.stored, 0);
        assert.equal(h.calls.messages.some(message => message.action === 'FILE_BACKUP_USE_FOLDER'), false);
        assert.equal(h.element('fileBackupChooseFolder').disabled, false);
    });

    test(`${surface}의 접근 허용도 전체 설정 탭 대신 전용 창을 요청한다`, async () => {
        const h = await harness({ ...options, destination: { id: 'existing', label: '백업 폴더', permission: 'prompt' } });
        assert.equal(h.element('fileBackupGrantFolder').hidden, false);
        await h.click('fileBackupGrantFolder');
        assert.equal(h.calls.tabs.length, 0);
        assert.equal(h.calls.messages.at(-1).action, 'FILE_BACKUP_OPEN_FOLDER_WINDOW');
        assert.equal(h.calls.grants, 0);
        assert.equal(h.calls.messages.some(message => message.action === 'FILE_BACKUP_FOLDER_ACCESS'), false);
        assert.match(h.element('fileBackupLocationNote').textContent, /작은 전용 창/);
    });
}

test('일반 설정 탭에서는 폴더를 선택하고 허용 결과를 백그라운드에 전달한다', async () => {
    const h = await harness();
    await h.click('fileBackupChooseFolder');
    assert.equal(h.calls.tabs.length, 0);
    assert.equal(h.calls.picks, 1);
    assert.equal(h.calls.stored, 1);
    assert.equal(h.status.destination.id, 'chosen');
    assert.equal(h.element('fileBackupGrantFolder').hidden, true);
});

test('일반 설정 탭에서 기존 폴더의 접근 허용을 완료하고 권한 버튼을 숨긴다', async () => {
    const h = await harness({ destination: { id: 'existing', label: '백업 폴더', permission: 'prompt' } });
    await h.click('fileBackupGrantFolder');
    assert.equal(h.calls.tabs.length, 0);
    assert.equal(h.calls.grants, 1);
    assert.equal(h.calls.messages.at(-1).action, 'FILE_BACKUP_FOLDER_ACCESS');
    assert.equal(h.element('fileBackupGrantFolder').hidden, true);
});

test('전용 창을 열 수 없으면 원래 위치를 유지하고 다시 시도할 수 있다', async () => {
    const destination = { id: 'existing', label: '백업 폴더', permission: 'prompt' };
    const h = await harness({ hash: '#sidepanel', destination, windowError: '창 열기 실패' });
    await h.click('fileBackupGrantFolder');
    assert.equal(h.status.destination.id, 'existing');
    assert.equal(h.calls.grants, 0);
    assert.equal(h.element('fileBackupGrantFolder').disabled, false);
    assert.equal(h.element('fileBackupError').hidden, false);
    assert.match(h.element('fileBackupError').textContent, /창 열기 실패/);
});

test('폴더 선택을 취소하면 기존 폴더와 권한 상태를 유지한다', async () => {
    const h = await harness({ destination: { id: 'existing', label: '백업 폴더', permission: 'granted' }, cancelPicker: true });
    await h.click('fileBackupChooseFolder');
    assert.equal(h.status.destination.id, 'existing');
    assert.equal(h.calls.stored, 0);
    assert.equal(h.element('fileBackupError').hidden, true);
});

test('사이드 패널의 기본 다운로드 위치 복원은 새 탭 없이 처리한다', async () => {
    const h = await harness({ hash: '#sidepanel', destination: { id: 'existing', label: '백업 폴더', permission: 'prompt' } });
    await h.click('fileBackupDefaultFolder');
    assert.equal(h.calls.tabs.length, 0);
    assert.equal(h.status.destination, null);
    assert.equal(h.element('fileBackupGrantFolder').hidden, true);
    assert.equal(h.element('fileBackupShow').hidden, false);
});
