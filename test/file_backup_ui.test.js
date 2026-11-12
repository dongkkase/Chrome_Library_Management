const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'file-backup-ui.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

async function harness({ enabled = true, toggleError = false } = {}) {
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) {
            const listeners = new Map();
            elements.set(id, {
                hidden: false, disabled: true, checked: false, textContent: '',
                addEventListener: (event, listener) => listeners.set(event, listener),
                fire: event => listeners.get(event)?.()
            });
        }
        return elements.get(id);
    }
    const calls = { messages: [], toasts: [] };
    const status = { enabled, busy: false, lastCompletedAt: 0, lastBackupMatchesDestination: true, error: '' };
    let onChange;
    vm.runInNewContext(source, {
        window: { addEventListener() {} },
        chrome: {
            runtime: {
                async sendMessage(message) {
                    calls.messages.push(message);
                    if (message.action === 'FILE_BACKUP_SET_ENABLED') {
                        if (toggleError) return { ok: false, error: '설정 저장 실패' };
                        status.enabled = message.enabled;
                    }
                    return { ok: true, status: structuredClone(status) };
                }
            },
            storage: { onChanged: { addListener(listener) { onChange = listener; } } }
        },
        document: { getElementById: element, querySelector: element },
        showInfoToast: (message, isError = false) => calls.toasts.push({ message, isError }),
        escapeOptionsHtml: value => value
    });
    await flush();
    return {
        calls, status, element,
        async click(id) { element(id).fire('click'); await flush(); },
        async toggle(value) { element('fileBackupEnabled').checked = value; element('fileBackupEnabled').fire('change'); await flush(); },
        async change(values) { Object.assign(status, values); onChange({ fileBackupState: {} }, 'local'); await flush(); }
    };
}

test('자동 백업을 켰을 때만 상세 설정을 표시하고 끄면 숨긴다', async () => {
    const h = await harness({ enabled: false });
    assert.equal(h.element('fileBackupDetails').hidden, true);
    await h.toggle(true);
    assert.equal(h.element('fileBackupDetails').hidden, false);
    await h.toggle(false);
    assert.equal(h.element('fileBackupDetails').hidden, true);
    assert.deepEqual(h.calls.messages.filter(message => message.action !== 'FILE_BACKUP_STATUS').map(message => message.action), ['FILE_BACKUP_SET_ENABLED', 'FILE_BACKUP_SET_ENABLED']);
});

test('설정 저장 실패 시 이전 스위치 상태를 복원하고 토스트로 알린다', async () => {
    const h = await harness({ enabled: false, toggleError: true });
    await h.toggle(true);
    assert.equal(h.element('fileBackupEnabled').checked, false);
    assert.equal(h.element('fileBackupDetails').hidden, true);
    assert.equal(h.calls.toasts.at(-1).isError, true);
    assert.match(h.calls.toasts.at(-1).message, /설정 저장 실패/);
});
