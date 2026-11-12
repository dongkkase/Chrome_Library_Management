const FileBackup = (() => {
    const ENABLED_KEY = 'fileBackupEnabled';
    const STATE_KEY = 'fileBackupState';
    const LEGACY_DESTINATION_KEY = 'fileBackupDestination';
    const ALARM = 'book-manager-file-backup';
    const CHECK_ALARM = 'book-manager-file-backup-check';
    const QUIET_MS = 30 * 1000; // 임시 테스트용. 테스트 후 5 * 60 * 1000으로 복원합니다.
    const MAX_WAIT_MS = 30 * 60 * 1000;
    const FOLDER = 'LibraryMatchingManagerBackups';
    const OFFSCREEN_PAGE = 'file-backup-offscreen.html';
    const CHANGE_KEYS = ['bookStoreChange', 'missingVolsMap', 'allowedSites', 'filterWords', 'editionKeywords'];
    const downloadIds = new Set();
    let queue = Promise.resolve();

    function enqueue(operation) {
        const result = queue.then(operation, operation);
        queue = result.catch(error => console.error('자동 파일 백업 실패:', error));
        return result;
    }

    async function read() {
        const values = await chrome.storage.local.get({ [ENABLED_KEY]: false, [STATE_KEY]: {}, [LEGACY_DESTINATION_KEY]: null });
        const enabled = values[ENABLED_KEY] === true;
        const state = { ...values[STATE_KEY] };
        const hadCustomFolder = !!values[LEGACY_DESTINATION_KEY] || !!state.pending?.destination;
        if (hadCustomFolder || state.folderAccessIssue) {
            // 기존 폴더의 파일은 그대로 두고 이후 백업만 다운로드 방식으로 전환한다.
            if (state.pending?.destination) state.pending = null;
            delete state.folderAccessIssue;
            state.error = '';
            state.retryAt = 0;
            if (hadCustomFolder && !state.pending) {
                if (state.lastDestinationId !== 'downloads') state.lastHash = null;
                if (enabled) markChanged(state);
            }
            await chrome.storage.local.set({ [LEGACY_DESTINATION_KEY]: null, [STATE_KEY]: state });
        }
        return { enabled, state };
    }

    async function save(state) {
        await chrome.storage.local.set({ [STATE_KEY]: state });
    }

    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
        }
        return value;
    }

    async function hash(value) {
        const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function capture(includeBooks) {
        return bookStoreWithSyncLock(async () => {
            const snapshot = includeBooks ? await bookStoreGetAllWithRevision() : null;
            const revision = snapshot ? snapshot.revision : await bookStoreGetRevision();
            const stored = await chrome.storage.local.get({
                bookStoreChange: null, missingVolsMap: {}, allowedSites: [],
                filterWords: [], editionKeywords: getDefaultEditionKeywords()
            });
            const { bookStoreChange, ...settings } = stored;
            const signature = await hash({ revision, token: bookStoreChange?.token || '', ...settings });
            return {
                signature,
                data: snapshot ? { bookList: snapshot.bookList, ...settings } : null
            };
        });
    }

    function markChanged(state, now = Date.now()) {
        state.firstChangeAt = state.firstChangeAt || now;
        state.lastChangeAt = now;
    }

    function dueAt(state) {
        if (!state.firstChangeAt) return 0;
        return Math.max(state.retryAt || 0,
            Math.min(state.lastChangeAt + QUIET_MS, state.firstChangeAt + MAX_WAIT_MS));
    }

    async function schedule(enabled, state) {
        if (enabled) {
            if (!await chrome.alarms.get(CHECK_ALARM)) {
                await chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 30 });
            }
        } else {
            await chrome.alarms.clear(CHECK_ALARM);
        }
        const when = state.pending ? Date.now() + 60 * 1000 : enabled ? dueAt(state) : 0;
        if (when) {
            await chrome.alarms.create(ALARM, { when: Math.max(Date.now() + 1000, when) });
        } else {
            await chrome.alarms.clear(ALARM);
        }
    }

    async function offscreenExists() {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(OFFSCREEN_PAGE)]
        });
        return contexts.length > 0;
    }

    async function closeOffscreen() {
        try {
            if (await offscreenExists()) await chrome.offscreen.closeDocument();
        } catch (error) {
            console.warn('백업 파일 준비 화면 정리 실패:', error);
        }
    }

    async function createBlobUrl(text, requestId) {
        if (!await offscreenExists()) {
            await chrome.offscreen.createDocument({
                url: OFFSCREEN_PAGE, reasons: ['BLOBS'],
                justification: '도서 목록을 다운로드할 JSON 백업 파일로 준비합니다.'
            });
        }
        const result = await chrome.runtime.sendMessage({
            target: 'file-backup-offscreen', action: 'create', requestId, text
        });
        if (!result?.ok || typeof result.url !== 'string'
            || !result.url.startsWith(`blob:${chrome.runtime.getURL('')}`)) {
            throw new Error(result?.error || '백업 파일을 준비하지 못했습니다.');
        }
        return result.url;
    }

    function filename() {
        const now = new Date();
        const pad = (value, width = 2) => String(value).padStart(width, '0');
        const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
            + `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
        return `${FOLDER}/book_manager_backup_${stamp}_${crypto.randomUUID().slice(0, 8)}.json`;
    }

    async function fail(state, message) {
        const pending = state.pending;
        if (pending) {
            state.firstChangeAt = Math.min(state.firstChangeAt || Date.now(), pending.firstChangeAt || pending.startedAt);
            state.lastChangeAt = Math.max(state.lastChangeAt || 0, pending.startedAt);
        } else {
            markChanged(state);
        }
        state.pending = null;
        state.error = message;
        state.retryAt = Date.now() + QUIET_MS;
        await save(state);
        await closeOffscreen();
    }

    async function complete(state, pending, savedFilename, downloadId = null) {
        state.lastCompletedAt = Date.now();
        state.lastFilename = savedFilename;
        state.lastDownloadId = downloadId;
        state.lastBookCount = pending.bookCount;
        state.lastHash = pending.hash;
        state.lastDestinationId = 'downloads';
        state.error = '';
        state.retryAt = 0;
        state.pending = null;
        await save(state);
    }

    async function reconcilePending(state) {
        if (!state.pending) return;
        const pending = state.pending;
        let items = [];
        if (Number.isInteger(pending.downloadId)) {
            downloadIds.add(pending.downloadId);
            items = await chrome.downloads.search({ id: pending.downloadId });
        } else if (pending.url) {
            items = await chrome.downloads.search({ url: pending.url });
        }
        const item = items.find(candidate => isBackupDownload(candidate));
        if (!item) {
            await fail(state, '진행 중이던 백업 파일을 확인하지 못했습니다.');
            return;
        }
        downloadIds.add(item.id);
        if (item.state === 'complete') {
            await complete(state, pending, item.filename || pending.filename, item.id);
            await closeOffscreen();
        } else if (item.state === 'interrupted') {
            await fail(state, `백업 파일 저장이 중단되었습니다${item.error ? ` (${item.error})` : ''}.`);
        } else if (pending.downloadId !== item.id) {
            state.pending.downloadId = item.id;
            await save(state);
        }
    }

    async function observe(state) {
        const snapshot = await capture(false);
        if (snapshot.signature !== state.observedSignature) {
            state.observedSignature = snapshot.signature;
            markChanged(state);
            await save(state);
        }
    }

    async function startBackup(state, force = false) {
        if (state.pending) return;
        const snapshot = await capture(true);
        const contentHash = await hash(snapshot.data);
        state.observedSignature = snapshot.signature;
        if (!force && contentHash === state.lastHash
            && (state.lastDestinationId || 'downloads') === 'downloads') {
            state.firstChangeAt = 0;
            state.lastChangeAt = 0;
            state.retryAt = 0;
            state.error = '';
            await save(state);
            return;
        }
        const requestId = crypto.randomUUID();
        const targetFilename = filename();
        try {
            const url = await createBlobUrl(JSON.stringify(snapshot.data, null, 2), requestId);
            state.pending = {
                requestId, url, filename: targetFilename, hash: contentHash,
                startedAt: Date.now(), firstChangeAt: state.firstChangeAt || Date.now(),
                bookCount: snapshot.data.bookList.length, downloadId: null
            };
            state.firstChangeAt = 0;
            state.lastChangeAt = 0;
            state.error = '';
            await save(state);
            const downloadId = await chrome.downloads.download({
                url, filename: targetFilename, conflictAction: 'uniquify', saveAs: false
            });
            if (!Number.isInteger(downloadId)) throw new Error('다운로드 번호를 확인하지 못했습니다.');
            downloadIds.add(downloadId);
            state.pending.downloadId = downloadId;
            await save(state);
            await reconcilePending(state);
        } catch (error) {
            await fail(state, `자동 백업 실패: ${error.message || error}`);
        }
    }

    async function tick({ force = false, check = false } = {}) {
        const { enabled, state } = await read();
        try {
            await reconcilePending(state);
            if (enabled || force) {
                await observe(state);
                const due = dueAt(state);
                if (!state.pending && (force || (due && due <= Date.now()) || (check && !due))) {
                    await startBackup(state, force);
                }
            }
        } catch (error) {
            state.error = `자동 백업 확인 실패: ${error.message || error}`;
            state.retryAt = Date.now() + QUIET_MS;
            if (!state.pending) markChanged(state);
            await save(state);
        }
        await schedule(enabled, state);
    }

    function initialize() {
        return enqueue(() => tick());
    }

    async function status() {
        const { enabled, state } = await read();
        return {
            enabled, busy: !!state.pending,
            nextBackupAt: enabled ? dueAt(state) : 0,
            lastCompletedAt: state.lastCompletedAt || 0,
            lastFilename: state.lastFilename || '',
            lastBookCount: state.lastBookCount ?? null,
            hasDownload: Number.isInteger(state.lastDownloadId),
            lastBackupMatchesDestination: (state.lastDestinationId || 'downloads') === 'downloads',
            error: state.error || ''
        };
    }

    function isOptionsSender(sender) {
        return sender?.id === chrome.runtime.id && typeof sender.url === 'string'
            && sender.url.split(/[?#]/)[0] === chrome.runtime.getURL('options.html');
    }

    function isBackupDownload(item) {
        return !!item && item.url?.startsWith(`blob:${chrome.runtime.getURL('')}`)
            && (!item.byExtensionId || item.byExtensionId === chrome.runtime.id);
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!['FILE_BACKUP_STATUS', 'FILE_BACKUP_SET_ENABLED', 'FILE_BACKUP_NOW', 'FILE_BACKUP_SHOW'].includes(message?.action)) return;
        if (!isOptionsSender(sender)) {
            sendResponse({ ok: false, error: '설정 화면에서만 파일 백업을 변경할 수 있습니다.' });
            return;
        }
        void enqueue(async () => {
            try {
                if (message.action === 'FILE_BACKUP_SET_ENABLED') {
                    if (typeof message.enabled !== 'boolean') throw new Error('백업 설정이 올바르지 않습니다.');
                    await chrome.storage.local.set({ [ENABLED_KEY]: message.enabled });
                    const { state } = await read();
                    if (message.enabled) {
                        markChanged(state);
                    } else {
                        state.firstChangeAt = 0;
                        state.lastChangeAt = 0;
                    }
                    await save(state);
                    await tick();
                } else if (message.action === 'FILE_BACKUP_NOW') {
                    await tick({ force: true });
                } else if (message.action === 'FILE_BACKUP_SHOW') {
                    const { state } = await read();
                    if (Number.isInteger(state.lastDownloadId) && (!state.lastDestinationId || state.lastDestinationId === 'downloads')) {
                        await chrome.downloads.show(state.lastDownloadId);
                    } else {
                        await chrome.downloads.showDefaultFolder();
                    }
                }
                sendResponse({ ok: true, status: await status() });
            } catch (error) {
                sendResponse({ ok: false, error: error.message || String(error) });
            }
        });
        return true;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && CHANGE_KEYS.some(key => Object.prototype.hasOwnProperty.call(changes, key))) {
            void initialize();
        }
    });
    chrome.alarms.onAlarm.addListener(alarm => {
        if (alarm.name === ALARM || alarm.name === CHECK_ALARM) {
            void enqueue(() => tick({ check: alarm.name === CHECK_ALARM }));
        }
    });
    chrome.downloads.onCreated.addListener(item => {
        if (isBackupDownload(item)) downloadIds.add(item.id);
    });
    chrome.downloads.onChanged.addListener(delta => {
        if (delta.state && ['complete', 'interrupted'].includes(delta.state.current)) {
            void enqueue(async () => {
                const { enabled, state } = await read();
                if (!state.pending || (state.pending.downloadId !== null && state.pending.downloadId !== delta.id)) return;
                await reconcilePending(state);
                await schedule(enabled, state);
            });
        }
    });
    chrome.runtime.onStartup.addListener(() => { void enqueue(() => tick({ check: true })); });
    chrome.runtime.onInstalled.addListener(() => { void enqueue(() => tick({ check: true })); });

    return { initialize, status, isBackupDownload, isBackupDownloadId: id => downloadIds.has(id) };
})();
