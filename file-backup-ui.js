(() => {
    const enabled = document.getElementById('fileBackupEnabled');
    if (!enabled) return;
    const nowButton = document.getElementById('fileBackupNow');
    const showButton = document.getElementById('fileBackupShow');
    const chooseButton = document.getElementById('fileBackupChooseFolder');
    const defaultButton = document.getElementById('fileBackupDefaultFolder');
    const grantButton = document.getElementById('fileBackupGrantFolder');
    const location = document.getElementById('fileBackupLocation');
    const locationNote = document.getElementById('fileBackupLocationNote');
    const summary = document.getElementById('fileBackupStatus');
    const lastTime = document.getElementById('fileBackupLastTime');
    const error = document.getElementById('fileBackupError');
    let busy = false;
    let epoch = 0;
    let currentStatus = null;
    let refreshPending = false;

    function needsFolderWindow() {
        return window.location.hash === '#sidepanel'
            || !!chrome.extension?.getViews({ type: 'popup' }).includes(window);
    }

    function updateControls() {
        const destination = currentStatus?.destination;
        enabled.disabled = busy;
        nowButton.disabled = busy || !!currentStatus?.busy;
        showButton.disabled = busy;
        showButton.hidden = !!destination;
        chooseButton.disabled = busy || !!currentStatus?.busy || typeof window.showDirectoryPicker !== 'function';
        defaultButton.hidden = !destination;
        defaultButton.disabled = busy || !!currentStatus?.busy;
        grantButton.hidden = !destination || ['granted', 'missing'].includes(destination.permission);
        grantButton.disabled = busy || !!currentStatus?.busy;
    }

    function render(status) {
        if (!status) return;
        currentStatus = status;
        enabled.checked = status.enabled;
        updateControls();
        const destination = status.destination;
        location.textContent = destination?.label || `브라우저 다운로드 폴더 → ${FileBackupFolder.NAME}`;
        locationNote.textContent = !destination
            ? typeof window.showDirectoryPicker === 'function'
                ? `폴더를 선택하면 그 안의 ${FileBackupFolder.NAME}에 저장합니다. 기존 백업 파일은 이동하지 않습니다.`
                : '이 브라우저에서는 폴더 선택을 지원하지 않습니다. 기본 다운로드 폴더에 백업합니다.'
            : destination.permission === 'missing' ? destination.error
                : destination.permission !== 'granted' ? '‘폴더 접근 다시 허용’을 눌러 읽기·쓰기를 허용해 주세요. ‘방문할 때마다 허용’이 표시되면 선택하세요. 자동 백업이 켜져 있으면 허용 후 현재 목록을 바로 저장합니다.'
                    : '선택한 폴더에서 날짜·시간별 JSON 파일을 확인할 수 있습니다. 한 번만 접근을 허용했다면 폴더 설정 창을 닫은 뒤 다시 권한이 필요할 수 있습니다.';
        if (needsFolderWindow()) {
            locationNote.textContent += ' 폴더 선택과 접근 허용은 작은 전용 창에서 진행합니다.';
        }
        summary.textContent = status.busy ? '백업 파일을 저장하고 있습니다.'
            : !status.enabled ? '자동 파일 백업이 꺼져 있습니다.'
                : status.nextBackupAt ? `다음 백업 예정: ${new Date(status.nextBackupAt).toLocaleString('ko-KR')}`
                    : '자동 파일 백업이 켜져 있습니다. 다음 변경을 기다립니다.';
        lastTime.textContent = status.lastCompletedAt
            ? `${status.lastBackupMatchesDestination ? '마지막 저장 완료' : '이전 저장 위치의 마지막 완료'}: ${new Date(status.lastCompletedAt).toLocaleString('ko-KR')} · ${status.lastBookCount.toLocaleString('ko-KR')}건`
            : '아직 완료된 자동 파일 백업이 없습니다.';
        error.textContent = status.error || '';
        error.hidden = !status.error;
    }

    async function request(action = 'FILE_BACKUP_STATUS', values = {}, prepare) {
        if (busy) {
            if (action === 'FILE_BACKUP_STATUS') refreshPending = true;
            return;
        }
        const mutating = action !== 'FILE_BACKUP_STATUS';
        const requestEpoch = ++epoch;
        let finishBusy;
        if (mutating) {
            busy = true;
            if (action === 'FILE_BACKUP_NOW') finishBusy = ButtonUI.start(nowButton);
            updateControls();
        }
        try {
            if (prepare) values = await prepare();
            const response = await chrome.runtime.sendMessage({ action, ...values });
            if (!response?.ok) throw new Error(response?.error || '파일 백업 상태를 확인하지 못했습니다.');
            if (requestEpoch === epoch) render(response.status);
        } catch (failure) {
            if (requestEpoch === epoch) {
                render(currentStatus);
                if (failure.name !== 'AbortError') {
                    error.textContent = failure.message;
                    error.hidden = false;
                }
            }
        } finally {
            if (mutating) {
                busy = false;
                if (finishBusy) finishBusy();
                updateControls();
                if (refreshPending) {
                    refreshPending = false;
                    void request();
                }
            }
        }
    }

    function openFolderWindow() {
        if (!needsFolderWindow()) return false;
        void request('FILE_BACKUP_OPEN_FOLDER_WINDOW');
        return true;
    }

    chooseButton.addEventListener('click', () => {
        if (openFolderWindow()) return;
        void request('FILE_BACKUP_USE_FOLDER', {}, async () => {
            const parent = await window.showDirectoryPicker({ id: 'library-matching-backup', mode: 'readwrite', startIn: 'downloads' });
            return FileBackupFolder.storeSelection(parent);
        });
    });
    defaultButton.addEventListener('click', () => void request('FILE_BACKUP_DEFAULT_FOLDER'));
    grantButton.addEventListener('click', () => {
        if (openFolderWindow()) return;
        void request('FILE_BACKUP_FOLDER_ACCESS', {}, async () => {
            const { handle } = await FileBackupFolder.get(currentStatus.destination.id);
            if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
                throw new Error('폴더 접근을 허용하지 않았습니다. 다시 허용하거나 다른 저장 폴더를 선택해 주세요.');
            }
            return {};
        });
    });
    enabled.addEventListener('change', () => void request('FILE_BACKUP_SET_ENABLED', { enabled: enabled.checked }));
    nowButton.addEventListener('click', () => void request('FILE_BACKUP_NOW'));
    showButton.addEventListener('click', () => void request('FILE_BACKUP_SHOW'));
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.fileBackupState || changes.fileBackupEnabled || changes.fileBackupDestination)) void request();
    });
    document.querySelector('[data-target="tab-backup"]')?.addEventListener('click', () => void request());
    window.addEventListener('focus', () => void request());
    if (new URLSearchParams(window.location.search).has('backupFolder')) {
        document.addEventListener('DOMContentLoaded', () => {
            document.querySelector('[data-target="tab-backup"]')?.click();
            document.querySelector('.file-backup-settings')?.scrollIntoView({ block: 'start' });
        });
    }
    void request();
})();
