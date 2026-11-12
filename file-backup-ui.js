(() => {
    const enabled = document.getElementById('fileBackupEnabled');
    if (!enabled) return;
    const details = document.getElementById('fileBackupDetails');
    const summary = document.getElementById('fileBackupStatus');
    const lastTime = document.getElementById('fileBackupLastTime');
    const error = document.getElementById('fileBackupError');
    let busy = false;
    let epoch = 0;
    let currentStatus = null;
    let refreshPending = false;
    let actionError = '';

    function updateControls() {
        enabled.disabled = busy;
        details.hidden = !currentStatus?.enabled;
    }

    function render(status) {
        if (!status) return;
        currentStatus = status;
        enabled.checked = status.enabled;
        updateControls();
        summary.textContent = status.busy ? '백업 파일을 저장하고 있습니다.'
            : !status.enabled ? '자동 파일 백업이 꺼져 있습니다.'
                : status.nextBackupAt ? `다음 백업 예정: ${new Date(status.nextBackupAt).toLocaleString('ko-KR')}`
                    : '자동 파일 백업이 켜져 있습니다. 다음 변경을 기다립니다.';
        lastTime.textContent = status.lastCompletedAt
            ? `${status.lastBackupMatchesDestination ? '마지막 저장 완료' : '이전 저장 위치의 마지막 완료'}: ${new Date(status.lastCompletedAt).toLocaleString('ko-KR')} · ${status.lastBookCount.toLocaleString('ko-KR')}건`
            : '아직 완료된 자동 파일 백업이 없습니다.';
        error.textContent = actionError || status.error || '';
        error.hidden = !error.textContent;
    }

    async function request(action = 'FILE_BACKUP_STATUS', values = {}) {
        if (busy) {
            if (action === 'FILE_BACKUP_STATUS') refreshPending = true;
            return;
        }
        const mutating = action !== 'FILE_BACKUP_STATUS';
        const requestEpoch = ++epoch;
        if (mutating) {
            actionError = '';
            busy = true;
            updateControls();
        }
        try {
            const response = await chrome.runtime.sendMessage({ action, ...values });
            if (!response?.ok) throw new Error(response?.error || '파일 백업 상태를 확인하지 못했습니다.');
            if (requestEpoch === epoch) render(response.status);
        } catch (failure) {
            if (requestEpoch === epoch) {
                if (mutating) actionError = failure.message;
                render(currentStatus);
                error.textContent = failure.message;
                error.hidden = false;
                if (mutating || !currentStatus) showInfoToast(escapeOptionsHtml(failure.message), true);
            }
        } finally {
            if (mutating) {
                busy = false;
                updateControls();
                if (refreshPending) {
                    refreshPending = false;
                    void request();
                }
            }
        }
    }

    enabled.addEventListener('change', () => void request('FILE_BACKUP_SET_ENABLED', { enabled: enabled.checked }));
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.fileBackupState || changes.fileBackupEnabled)) void request();
    });
    document.querySelector('[data-target="tab-backup"]')?.addEventListener('click', () => void request());
    window.addEventListener('focus', () => void request());
    void request();
})();
