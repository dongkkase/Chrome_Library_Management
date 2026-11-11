const FileBackup = (() => {
    const ENABLED_KEY = 'fileBackupEnabled';
    const STATE_KEY = 'fileBackupState';
    const DESTINATION_KEY = 'fileBackupDestination';
    const ALARM = 'book-manager-file-backup';
    const CHECK_ALARM = 'book-manager-file-backup-check';
    const QUIET_MS = 5 * 60 * 1000;
    const MAX_WAIT_MS = 30 * 60 * 1000;
    const FOLDER = FileBackupFolder.NAME;
    const OFFSCREEN_PAGE = 'file-backup-offscreen.html';
    const FOLDER_WINDOW_PAGE = 'file-backup-folder-window.html';
    const CHANGE_KEYS = ['bookStoreChange', 'missingVolsMap', 'allowedSites', 'filterWords', 'editionKeywords'];
    const downloadIds = new Set();
    let queue = Promise.resolve();
    let folderWindowId = null;

    function enqueue(operation) {
        const result = queue.then(operation, operation);
        queue = result.catch(error => console.error('자동 파일 백업 실패:', error));
        return result;
    }

    async function read() {
        const values = await chrome.storage.local.get({ [ENABLED_KEY]: false, [STATE_KEY]: {}, [DESTINATION_KEY]: null });
        return { enabled: values[ENABLED_KEY] === true, state: { ...values[STATE_KEY] }, destination: values[DESTINATION_KEY] };
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
        state.lastDestinationId = pending.destination?.id || 'downloads';
        state.error = '';
        state.retryAt = 0;
        state.pending = null;
        await save(state);
    }

    async function reconcilePending(state) {
        if (!state.pending) return;
        const pending = state.pending;
        if (pending.destination) {
            try {
                const file = await FileBackupFolder.readFile(pending.destination.id, pending.filename);
                if (!file || await hash(JSON.parse(await file.text())) !== pending.hash) {
                    throw new Error('완료되지 않은 백업입니다. 새 파일로 다시 저장합니다.');
                }
                await complete(state, pending, `${pending.destination.label} → ${pending.filename}`);
            } catch (error) {
                await fail(state, `백업 파일 확인 실패: ${error.message || error}`);
            }
            return;
        }
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
        const { destination } = await read();
        const snapshot = await capture(true);
        const contentHash = await hash(snapshot.data);
        state.observedSignature = snapshot.signature;
        if (!force && contentHash === state.lastHash
            && (state.lastDestinationId || 'downloads') === (destination?.id || 'downloads')) {
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
            if (destination) {
                const pending = {
                    destination, filename: targetFilename.slice(FOLDER.length + 1), hash: contentHash,
                    startedAt: Date.now(), firstChangeAt: state.firstChangeAt || Date.now(),
                    bookCount: snapshot.data.bookList.length
                };
                state.pending = pending;
                state.firstChangeAt = 0;
                state.lastChangeAt = 0;
                state.error = '';
                await save(state);
                await FileBackupFolder.writeFile(destination.id, pending.filename, JSON.stringify(snapshot.data, null, 2));
                await complete(state, pending, `${destination.label} → ${pending.filename}`);
                return;
            }
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
        const { enabled, state, destination } = await read();
        let folder = null;
        if (destination) {
            try {
                folder = await FileBackupFolder.describe(destination.id);
            } catch (error) {
                folder = { ...destination, permission: 'missing', error: error.message || String(error) };
            }
        }
        return {
            enabled, busy: !!state.pending,
            nextBackupAt: enabled ? dueAt(state) : 0,
            lastCompletedAt: state.lastCompletedAt || 0,
            lastFilename: state.lastFilename || '',
            lastBookCount: state.lastBookCount ?? null,
            hasDownload: Number.isInteger(state.lastDownloadId),
            destination: folder,
            lastBackupMatchesDestination: (state.lastDestinationId || 'downloads') === (destination?.id || 'downloads'),
            error: state.error || ''
        };
    }

    function isBackupSender(sender, action) {
        if (sender?.id !== chrome.runtime.id || typeof sender.url !== 'string') return false;
        const url = sender.url.split(/[?#]/)[0];
        if (url === chrome.runtime.getURL('options.html')) return true;
        return url === chrome.runtime.getURL(FOLDER_WINDOW_PAGE)
            && ['FILE_BACKUP_STATUS', 'FILE_BACKUP_USE_FOLDER', 'FILE_BACKUP_FOLDER_ACCESS', 'FILE_BACKUP_NOW'].includes(action);
    }

    async function openFolderWindow() {
        const url = chrome.runtime.getURL(FOLDER_WINDOW_PAGE);
        const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
        const ids = new Set([folderWindowId, ...contexts.map(context => context.windowId)]);
        for (const id of ids) {
            if (!Number.isInteger(id) || id < 0) continue;
            try {
                const existing = await chrome.windows.get(id);
                if (existing.type !== 'popup') continue;
                await chrome.windows.update(id, { focused: true });
                folderWindowId = id;
                return;
            } catch (_) {
                // 닫힌 창은 새 창으로 대체합니다.
            }
        }
        const created = await chrome.windows.create({ url, type: 'popup', width: 520, height: 620, focused: true });
        folderWindowId = created.id;
    }

    function isBackupDownload(item) {
        return !!item && item.url?.startsWith(`blob:${chrome.runtime.getURL('')}`)
            && (!item.byExtensionId || item.byExtensionId === chrome.runtime.id);
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!['FILE_BACKUP_STATUS', 'FILE_BACKUP_SET_ENABLED', 'FILE_BACKUP_NOW', 'FILE_BACKUP_SHOW',
            'FILE_BACKUP_USE_FOLDER', 'FILE_BACKUP_DEFAULT_FOLDER', 'FILE_BACKUP_FOLDER_ACCESS',
            'FILE_BACKUP_OPEN_FOLDER_WINDOW'].includes(message?.action)) return;
        if (!isBackupSender(sender, message.action)) {
            sendResponse({ ok: false, error: '설정 화면에서만 파일 백업을 변경할 수 있습니다.' });
            return;
        }
        void enqueue(async () => {
            try {
                if (message.action === 'FILE_BACKUP_OPEN_FOLDER_WINDOW') {
                    await openFolderWindow();
                } else if (['FILE_BACKUP_USE_FOLDER', 'FILE_BACKUP_DEFAULT_FOLDER', 'FILE_BACKUP_FOLDER_ACCESS'].includes(message.action)) {
                    const { enabled, state, destination } = await read();
                    await reconcilePending(state);
                    if (state.pending) throw new Error('백업 파일을 저장하고 있습니다. 완료 후 저장 위치를 변경해 주세요.');
                    let nextDestination = null;
                    if (message.action !== 'FILE_BACKUP_DEFAULT_FOLDER') {
                        const folder = await FileBackupFolder.describe(message.action === 'FILE_BACKUP_FOLDER_ACCESS' ? destination?.id : message.id);
                        if (folder.permission !== 'granted') throw new Error('선택한 폴더의 읽기·쓰기 접근을 허용해 주세요.');
                        nextDestination = { id: folder.id, label: folder.label };
                    }
                    await chrome.storage.local.set({ [DESTINATION_KEY]: nextDestination });
                    state.firstChangeAt = Date.now();
                    state.lastChangeAt = Date.now();
                    state.retryAt = 0;
                    state.error = '';
                    await save(state);
                    await tick({ force: enabled && message.action === 'FILE_BACKUP_FOLDER_ACCESS' });
                } else if (message.action === 'FILE_BACKUP_SET_ENABLED') {
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
                    const { state, destination } = await read();
                    if (destination) throw new Error('선택한 폴더의 LibraryMatchingManagerBackups에서 백업 파일을 확인해 주세요.');
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
                if (!state.pending || state.pending.destination || (state.pending.downloadId !== null && state.pending.downloadId !== delta.id)) return;
                await reconcilePending(state);
                await schedule(enabled, state);
            });
        }
    });
    chrome.runtime.onStartup.addListener(() => { void initialize(); });
    chrome.runtime.onInstalled.addListener(() => { void initialize(); });

    return { initialize, status, isBackupDownload, isBackupDownloadId: id => downloadIds.has(id) };
})();
