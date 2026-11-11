(() => {
    const chooseButton = document.getElementById('chooseFolder');
    const grantButton = document.getElementById('grantFolder');
    const backupButton = document.getElementById('backupNow');
    const closeButton = document.getElementById('closeWindow');
    const location = document.getElementById('folderLocation');
    const summary = document.getElementById('folderStatus');
    const lastBackup = document.getElementById('lastBackup');
    const error = document.getElementById('folderError');
    const permissionNote = document.getElementById('permissionNote');
    let currentStatus = null;
    let busy = false;
    let refreshPending = false;
    let epoch = 0;

    function updateControls() {
        const destination = currentStatus?.destination;
        chooseButton.disabled = busy || !!currentStatus?.busy || !currentStatus || typeof window.showDirectoryPicker !== 'function';
        grantButton.hidden = !destination || ['granted', 'missing'].includes(destination.permission);
        grantButton.disabled = busy || !!currentStatus?.busy;
        chooseButton.classList.toggle('secondary', !grantButton.hidden);
        backupButton.hidden = !destination;
        backupButton.disabled = busy || !!currentStatus?.busy || destination?.permission !== 'granted';
        closeButton.disabled = busy || !!currentStatus?.busy;
        permissionNote.hidden = !destination;
    }

    function render() {
        updateControls();
        if (!currentStatus) return;
        const destination = currentStatus.destination;
        location.textContent = destination?.label || `브라우저 다운로드 폴더 → ${FileBackupFolder.NAME}`;
        summary.textContent = currentStatus.busy ? '백업 파일을 저장하고 있습니다.'
            : destination?.permission === 'missing' ? '저장 폴더를 다시 선택해 주세요.'
                : destination && destination.permission !== 'granted' ? '선택한 폴더의 접근을 허용해 주세요.'
                    : destination ? '백업 폴더를 사용할 수 있습니다.' : '‘폴더 선택’을 눌러 저장 위치를 변경하세요.';
        lastBackup.textContent = currentStatus.lastCompletedAt
            ? `${currentStatus.lastBackupMatchesDestination ? '마지막 저장 완료' : '이전 위치의 마지막 저장'}: ${new Date(currentStatus.lastCompletedAt).toLocaleString('ko-KR')} · ${currentStatus.lastBookCount.toLocaleString('ko-KR')}건`
            : currentStatus.enabled ? '자동 백업이 켜져 있습니다.' : destination ? '자동 백업이 꺼져 있습니다. ‘지금 백업’으로 저장할 수 있습니다.' : '자동 백업이 꺼져 있습니다.';
        error.textContent = currentStatus.error || destination?.error || '';
        error.hidden = !error.textContent;
    }

    async function request(action = 'FILE_BACKUP_STATUS', prepare) {
        if (busy) {
            if (action === 'FILE_BACKUP_STATUS') refreshPending = true;
            return;
        }
        const mutating = action !== 'FILE_BACKUP_STATUS';
        const requestEpoch = ++epoch;
        if (mutating) { busy = true; render(); }
        try {
            const values = prepare ? await prepare() : {};
            const response = await chrome.runtime.sendMessage({ action, ...values });
            if (!response?.ok) throw new Error(response?.error || '백업 폴더 설정을 확인하지 못했습니다.');
            if (requestEpoch === epoch) { currentStatus = response.status; render(); }
        } catch (failure) {
            if (requestEpoch === epoch && failure.name !== 'AbortError') {
                error.textContent = failure.message || String(failure);
                error.hidden = false;
            }
        } finally {
            if (mutating) {
                busy = false;
                updateControls();
                if (refreshPending) { refreshPending = false; void request(); }
            }
        }
    }

    chooseButton.addEventListener('click', () => void request('FILE_BACKUP_USE_FOLDER', async () => {
        const parent = await window.showDirectoryPicker({ id: 'library-matching-backup', mode: 'readwrite', startIn: 'downloads' });
        return FileBackupFolder.storeSelection(parent);
    }));
    grantButton.addEventListener('click', () => void request('FILE_BACKUP_FOLDER_ACCESS', async () => {
        const { handle } = await FileBackupFolder.get(currentStatus.destination.id);
        if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
            throw new Error('폴더 접근을 허용하지 않았습니다. 다시 허용하거나 다른 폴더를 선택해 주세요.');
        }
        return {};
    }));
    backupButton.addEventListener('click', () => void request('FILE_BACKUP_NOW'));
    closeButton.addEventListener('click', () => window.close());
    window.addEventListener('focus', () => void request());
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.darkMode) document.documentElement.dataset.theme = changes.darkMode.newValue ? 'dark' : 'light';
        if (changes.fileBackupState || changes.fileBackupDestination || changes.fileBackupEnabled) void request();
    });
    void chrome.storage.local.get({ darkMode: false }).then(values => {
        document.documentElement.dataset.theme = values.darkMode ? 'dark' : 'light';
    }).catch(() => {});
    void request();
})();
