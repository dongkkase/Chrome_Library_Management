const GoogleBookSync = (() => {
    const STATE_KEY = 'googleSyncState';
    const PREFERENCES_KEY = 'googleSyncPreferences';
    const INTERVALS = [5, 15, 30, 60];
    const ALARM = 'google-book-sync';
    const CHANGE_ALARM = 'google-book-sync-change';
    const STORE_ID = 'kjfmielegfhljmjjmhjmidlfdponknpm';
    const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
    let activeRun = null;
    let generation = 0;
    let stateWrites = Promise.resolve();
    let preferenceWrites = Promise.resolve();
    let alarmUpdates = Promise.resolve();

    async function readState() {
        const data = await chrome.storage.local.get({ [STATE_KEY]: {} });
        return data[STATE_KEY] || {};
    }

    function updateState(values) {
        const result = stateWrites.then(async () => {
            const previous = await readState();
            const state = { ...previous, ...(typeof values === 'function' ? values(previous) : values) };
            await chrome.storage.local.set({ [STATE_KEY]: state });
            return state;
        });
        stateWrites = result.catch(() => {});
        return result;
    }

    async function readPreferences() {
        const data = await chrome.storage.local.get({ [PREFERENCES_KEY]: {} });
        const saved = data[PREFERENCES_KEY] || {};
        return {
            autoSync: typeof saved.autoSync === 'boolean' ? saved.autoSync : true,
            intervalMinutes: INTERVALS.includes(saved.intervalMinutes) ? saved.intervalMinutes : 5,
            syncOnStartup: typeof saved.syncOnStartup === 'boolean' ? saved.syncOnStartup : true,
            syncOnChange: typeof saved.syncOnChange === 'boolean' ? saved.syncOnChange : true
        };
    }

    function allowsAutomaticSync(preferences, trigger) {
        return preferences.autoSync
            && (trigger !== 'startup' || preferences.syncOnStartup)
            && (trigger !== 'change' || preferences.syncOnChange);
    }

    function updateAlarms(operation) {
        const result = alarmUpdates.then(operation);
        alarmUpdates = result.catch(() => {});
        return result;
    }

    function reconcileAlarms() {
        return updateAlarms(async () => {
            const [state, preferences, access] = await Promise.all([readState(), readPreferences(), availability()]);
            if (!state.enabled || !preferences.autoSync || !access.available || !access.configured) {
                await Promise.all([chrome.alarms.clear(ALARM), chrome.alarms.clear(CHANGE_ALARM)]);
                return;
            }
            const alarm = await chrome.alarms.get(ALARM);
            if (!alarm || alarm.periodInMinutes !== preferences.intervalMinutes) {
                await chrome.alarms.create(ALARM, { periodInMinutes: preferences.intervalMinutes });
            }
            if (!preferences.syncOnChange) await chrome.alarms.clear(CHANGE_ALARM);
        });
    }

    function scheduleChange() {
        return updateAlarms(async () => {
            const [state, preferences, access] = await Promise.all([readState(), readPreferences(), availability()]);
            if (!state.enabled || !allowsAutomaticSync(preferences, 'change')
                || !access.available || !access.configured) return;
            if (!await chrome.alarms.get(CHANGE_ALARM)) {
                await chrome.alarms.create(CHANGE_ALARM, { delayInMinutes: 0.5 });
            }
        });
    }

    function updatePreferences(values) {
        const result = preferenceWrites.then(async () => {
            const defaults = await readPreferences();
            if (!values || typeof values !== 'object' || Array.isArray(values)) {
                throw new Error('동기화 옵션 형식이 올바르지 않습니다.');
            }
            for (const [key, value] of Object.entries(values)) {
                if (!Object.prototype.hasOwnProperty.call(defaults, key)
                    || (key === 'intervalMinutes' ? !INTERVALS.includes(value) : typeof value !== 'boolean')) {
                    throw new Error('동기화 옵션이 올바르지 않습니다. 주기는 5, 15, 30, 60분 중에서 선택해 주세요.');
                }
            }
            await chrome.storage.local.set({ [PREFERENCES_KEY]: { ...defaults, ...values } });
            await reconcileAlarms();
        });
        preferenceWrites = result.catch(() => {});
        return result;
    }

    async function availability() {
        const manifest = chrome.runtime.getManifest();
        let install;
        try {
            install = await chrome.management.getSelf();
        } catch (_) {
            return { available: false, configured: false, unavailableReason: '설치 유형을 확인할 수 없습니다.' };
        }
        const isManualInstall = install.installType === 'development';
        const supportedInstall = isManualInstall
            ? typeof manifest.key === 'string' && manifest.key.trim().length > 0
            : install.installType === 'normal'
                && manifest.update_url === 'https://clients2.google.com/service/update2/crx';
        const available = supportedInstall && chrome.runtime.id === STORE_ID;
        const oauth = manifest.oauth2;
        const configured = !!(oauth
            && /^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(oauth.client_id || '')
            && Array.isArray(oauth.scopes) && oauth.scopes.includes(SCOPE));
        return {
            available,
            configured,
            unavailableReason: !available ? (isManualInstall
                ? '직접 설치본은 동기화 지원 배포 파일로 설치해야 합니다. 전환 전에 도서 목록을 파일로 백업해 주세요.'
                : '이 설치본에서는 Google 동기화를 사용할 수 없습니다. 동기화 지원 배포 파일을 사용해 주세요.')
                : !configured ? '이 버전은 Google 연결 준비 중입니다. 연결을 지원하는 버전으로 업데이트해 주세요.' : ''
        };
    }

    async function status() {
        const [access, state, preferences] = await Promise.all([availability(), readState(), readPreferences()]);
        return {
            ...access,
            preferences,
            enabled: !!state.enabled,
            busy: !!activeRun,
            state: activeRun ? 'syncing' : (state.state === 'syncing' ? 'idle' : state.state || 'disabled'),
            accountEmail: state.accountEmail || '',
            lastSyncedAt: state.lastSyncedAt || null,
            error: state.error || '',
            conflict: state.conflict || null
        };
    }

    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
        }
        return value;
    }

    function normalizeBooks(books) {
        if (!Array.isArray(books)) throw new Error('Google Drive의 도서 목록 형식이 올바르지 않습니다.');
        const ids = new Set();
        return books.map(book => {
            if (!book || typeof book !== 'object' || Array.isArray(book)
                || !Number.isSafeInteger(book.id) || book.id <= 0 || ids.has(book.id)
                || typeof book.title !== 'string' || !book.title.trim()
                || !Array.isArray(book.missingVols)
                || book.missingVols.some(value => !Number.isSafeInteger(value) || value <= 0)) {
                throw new Error('Google Drive의 도서 데이터가 손상되었거나 지원하지 않는 형식입니다.');
            }
            ids.add(book.id);
            const result = Object.fromEntries(Object.entries(book).filter(([key]) => {
                return key !== 'cleanTitleStr' && !key.startsWith('_');
            }));
            result.title = result.title.trim();
            result.missingVols = [...new Set(result.missingVols)].sort((a, b) => a - b);
            return canonical(result);
        }).sort((a, b) => a.id - b.id);
    }

    async function hashBooks(books) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(books)));
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function localSnapshot() {
        return enqueueBookMutation(() => bookStoreWithSyncLock(async () => {
            const snapshot = await bookStoreGetAllWithRevision();
            const data = await chrome.storage.local.get({ missingVolsMap: {} });
            if (await bookStoreGetRevision() !== snapshot.revision) {
                throw new Error('도서 목록이 변경되었습니다. 잠시 후 다시 동기화합니다.');
            }
            const books = normalizeBooks(snapshot.bookList.map(book => ({
                ...book,
                missingVols: getBookMissingVols(book, data.missingVolsMap)
            })));
            const replacement = await db.meta.get('google-sync-local-replacement');
            return {
                ...snapshot, books, hash: await hashBooks(books), missingVolsMap: data.missingVolsMap,
                replacementRevision: replacement?.revision || 0
            };
        }));
    }

    async function remoteSnapshot(remote) {
        if (!remote) return { hash: null, books: [], updatedAt: null };
        const payload = remote.payload;
        if (!payload || payload.format !== 'book-manager-google-sync' || payload.version !== 1
            || !Number.isFinite(payload.updatedAt) || typeof payload.hash !== 'string') {
            throw new Error('지원하지 않는 Google Drive 동기화 파일입니다. 로컬 데이터는 유지됩니다.');
        }
        const books = normalizeBooks(payload.books);
        const hash = await hashBooks(books);
        if (hash !== payload.hash) throw new Error('Google Drive 데이터 검증에 실패했습니다. 로컬 데이터는 유지됩니다.');
        return { books, hash, updatedAt: payload.updatedAt };
    }

    function direction(baseHash, local, remote) {
        if (local.hash === remote.hash) return 'equal';
        if (!baseHash) {
            if (remote.hash === null) return 'upload';
            if (local.books.length === 0) return 'download';
            return 'conflict';
        }
        if (remote.hash === null) return 'conflict';
        if (local.hash === baseHash) return 'download';
        if (remote.hash === baseHash) return 'upload';
        return 'conflict';
    }

    function changesBetween(previous, next) {
        const before = new Map(previous.map(book => [book.id, JSON.stringify(book)]));
        const after = new Map(next.map(book => [book.id, JSON.stringify(book)]));
        return {
            added: next.filter(book => !before.has(book.id)).length,
            updated: next.filter(book => before.has(book.id) && before.get(book.id) !== after.get(book.id)).length,
            removed: previous.filter(book => !after.has(book.id)).length
        };
    }

    function matchesConflict(conflict, local, remote, file) {
        return conflict && conflict.localHash === local.hash && conflict.remoteHash === remote.hash
            && conflict.etag === (file ? file.etag : null)
            && conflict.fileId === (file ? file.fileId : null)
            && (conflict.replacementRevision || 0) === local.replacementRevision;
    }

    async function recordConflict(local, remote, file, reason = 'review-required', proposedDirection = null) {
        const previous = (await readState()).conflict;
        const conflict = {
            token: matchesConflict(previous, local, remote, file) ? previous.token : crypto.randomUUID(),
            localHash: local.hash,
            remoteHash: remote.hash,
            etag: file ? file.etag : null,
            fileId: file ? file.fileId : null,
            replacementRevision: local.replacementRevision,
            reason,
            proposedDirection,
            localChanges: changesBetween(remote.books, local.books),
            remoteChanges: changesBetween(local.books, remote.books),
            localCount: local.books.length,
            remoteCount: remote.books.length,
            remoteUpdatedAt: remote.updatedAt
        };
        await updateState({ state: 'conflict', error: '', conflict });
    }

    function reviewReason(state, local, remote, file, nextDirection) {
        if (state.baseFileId && file && state.baseFileId !== file.fileId) return 'remote-replaced';
        if (nextDirection === 'equal') return null;
        if (!file && (state.baseHash || state.conflict)) return 'remote-missing';
        if (local.replacementRevision > (state.reviewedLocalRevision || 0)) return 'local-restore';
        if (state.conflict) {
            return matchesConflict(state.conflict, local, remote, file)
                ? state.conflict.reason || 'review-required' : 'review-required';
        }
        if (nextDirection === 'conflict') return state.baseHash ? 'both-changed' : 'initial-difference';
        const changes = nextDirection === 'upload'
            ? changesBetween(remote.books, local.books) : changesBetween(local.books, remote.books);
        return changes.removed > 0 ? 'deletion' : null;
    }

    async function recoverPendingApply() {
        await ensureBookStoreReady();
        const pending = await db.meta.get('google-sync-pending');
        if (!pending) return;
        const data = await chrome.storage.local.get({ missingVolsMap: {} });
        const currentMap = data.missingVolsMap || {};
        const previousMap = pending.previousMissingVolsMap || {};
        const missingVolsMap = { ...currentMap };
        const keys = new Set([...Object.keys(previousMap), ...Object.keys(pending.missingVolsMap)]);
        keys.forEach(key => {
            // 중단 이후 사용자가 바꾼 누락 권수는 보존합니다.
            if (JSON.stringify(currentMap[key]) !== JSON.stringify(previousMap[key])) return;
            if (Object.prototype.hasOwnProperty.call(pending.missingVolsMap, key)) {
                missingVolsMap[key] = pending.missingVolsMap[key];
            } else {
                delete missingVolsMap[key];
            }
        });
        await chrome.storage.local.set({ missingVolsMap });
        await updateState(state => state.accountId === pending.checkpoint.accountId ? {
            ...pending.checkpoint, conflict: null, error: '', state: state.enabled ? 'idle' : 'disabled'
        } : {});
        await bookStorePublishChange({ type: 'reload', reason: 'google-sync', revision: pending.revision });
        await db.meta.delete('google-sync-pending');
    }

    async function assertActive(runGeneration, automaticTrigger) {
        if (runGeneration !== generation || !(await readState()).enabled
            || (automaticTrigger && !allowsAutomaticSync(await readPreferences(), automaticTrigger))) {
            const error = new Error('Google 동기화가 중지되었습니다.');
            error.name = 'GoogleSyncCancelledError';
            throw error;
        }
    }

    async function perform(options, runGeneration) {
        const access = await availability();
        if (!access.available || !access.configured) throw new Error(access.unavailableReason);
        let state = await readState();
        if (!options.connect && !state.enabled) return;
        if (options.automaticTrigger && !allowsAutomaticSync(await readPreferences(), options.automaticTrigger)) return;
        const drive = await GoogleBookDrive.create(!!options.connect);
        const account = await drive.account();
        if (runGeneration !== generation) return;
        if (state.accountId && state.accountId !== account.id) {
            throw new Error('연결된 Google 계정이 변경되었습니다. 연결을 끊은 뒤 원하는 계정으로 다시 연결해 주세요.');
        }
        if (options.connect) {
            state = await updateState({ enabled: true, accountId: account.id, accountEmail: account.email, error: '' });
            await reconcileAlarms();
        }
        await assertActive(runGeneration, options.automaticTrigger);
        await updateState({ state: 'syncing', error: '' });
        await enqueueBookMutation(() => bookStoreWithSyncLock(recoverPendingApply));
        state = await readState();
        const file = await drive.read();
        const remote = await remoteSnapshot(file);
        const local = await localSnapshot();
        await assertActive(runGeneration, options.automaticTrigger);
        let nextDirection = direction(state.baseHash, local, remote);
        const reason = reviewReason(state, local, remote, file, nextDirection);
        if (options.resolution) {
            const conflict = state.conflict;
            if (!conflict || options.conflictToken !== conflict.token
                || !matchesConflict(conflict, local, remote, file)) {
                await recordConflict(local, remote, file, reason || 'review-required', nextDirection);
                return;
            }
            if (options.resolution === 'remote' && !file) {
                throw new Error('Google Drive의 동기화 파일이 없어 해당 목록을 적용할 수 없습니다. 이 기기 목록을 확인해 주세요.');
            }
            nextDirection = options.resolution === 'local' ? 'upload' : 'download';
        } else if (reason) {
            await recordConflict(local, remote, file, reason, nextDirection);
            return;
        }
        let syncedHash = local.hash;
        let syncedFileId = file ? file.fileId : null;
        if (nextDirection === 'upload') {
            if (file) {
                await bookStoreBackupGoogleRemote(remote.books, {
                    accountId: account.id, fileId: file.fileId, etag: file.etag, hash: remote.hash
                });
            }
            const current = await localSnapshot();
            if (current.revision !== local.revision || current.hash !== local.hash
                || current.replacementRevision !== local.replacementRevision) {
                throw new Error('동기화를 준비하는 동안 이 기기 목록이 변경되었습니다. 최신 목록으로 다시 확인해 주세요.');
            }
            await assertActive(runGeneration, options.automaticTrigger);
            const written = await drive.write({
                format: 'book-manager-google-sync', version: 1,
                updatedAt: Date.now(), hash: local.hash, books: local.books
            }, file);
            syncedFileId = written.fileId;
        } else if (nextDirection === 'download') {
            syncedHash = remote.hash;
            await enqueueBookMutation(() => bookStoreWithSyncLock(async () => {
                await drive.assertUnchanged(file);
                await assertActive(runGeneration, options.automaticTrigger);
                const data = await chrome.storage.local.get({ missingVolsMap: {} });
                if (JSON.stringify(canonical(data.missingVolsMap)) !== JSON.stringify(canonical(local.missingVolsMap))) {
                    throw new Error('누락 권수가 변경되었습니다. 잠시 후 다시 동기화합니다.');
                }
                await bookStoreApplyGoogleSnapshot(remote.books, local.revision, {
                    bookList: local.bookList, missingVolsMap: local.missingVolsMap
                }, {
                    accountId: account.id, baseHash: syncedHash, baseFileId: syncedFileId,
                    reviewedLocalRevision: local.replacementRevision, lastSyncedAt: Date.now()
                });
                await recoverPendingApply();
            }));
        }
        await assertActive(runGeneration, options.automaticTrigger);
        await updateState({
            baseHash: syncedHash, baseFileId: syncedFileId, reviewedLocalRevision: local.replacementRevision,
            state: 'idle', conflict: null, error: '', lastSyncedAt: Date.now()
        });
    }

    function run(options = {}) {
        if (activeRun) return activeRun;
        const runGeneration = generation;
        activeRun = perform(options, runGeneration).catch(async error => {
            if (runGeneration === generation && error.name !== 'GoogleSyncCancelledError') {
                await updateState({ state: 'error', error: error.message || 'Google 동기화에 실패했습니다.' });
            }
            throw error;
        }).finally(async () => {
            activeRun = null;
            await updateState({ runCompletedAt: Date.now() });
        });
        return activeRun;
    }

    async function disconnect() {
        generation++;
        await updateState({ enabled: false, state: 'disabled', error: '', conflict: null });
        await reconcileAlarms();
        if (activeRun) await activeRun.catch(() => {});
        await enqueueBookMutation(() => bookStoreWithSyncLock(recoverPendingApply));
        await chrome.identity.clearAllCachedAuthTokens();
        await updateState({
            enabled: false, state: 'disabled', accountId: null, accountEmail: '',
            baseHash: null, baseFileId: null, reviewedLocalRevision: 0, lastSyncedAt: null, conflict: null, error: ''
        });
    }

    async function initialize({ syncOnStart = true } = {}) {
        const access = await availability();
        await reconcileAlarms();
        if (!access.available || !access.configured) return;
        await enqueueBookMutation(() => bookStoreWithSyncLock(recoverPendingApply));
        if (!(await readState()).enabled) return;
        if (syncOnStart) await run({ automaticTrigger: 'startup' });
    }

    function isOptionsSender(sender) {
        if (sender.id !== chrome.runtime.id || !sender.url) return false;
        try {
            const url = new URL(sender.url);
            return url.href.split(/[?#]/)[0] === chrome.runtime.getURL('options.html');
        } catch (_) {
            return false;
        }
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message.action !== 'string' || !message.action.startsWith('GOOGLE_SYNC_')) return;
        if (!isOptionsSender(sender)) {
            sendResponse({ ok: false, error: '설정 화면에서만 Google 동기화를 변경할 수 있습니다.' });
            return;
        }
        void (async () => {
            try {
                switch (message.action) {
                    case 'GOOGLE_SYNC_STATUS': break;
                    case 'GOOGLE_SYNC_CONNECT': await run({ connect: true }); break;
                    case 'GOOGLE_SYNC_NOW': await run(); break;
                    case 'GOOGLE_SYNC_DISCONNECT': await disconnect(); break;
                    case 'GOOGLE_SYNC_UPDATE_PREFERENCES': await updatePreferences(message.preferences); break;
                    case 'GOOGLE_SYNC_RESOLVE':
                        if (!['local', 'remote'].includes(message.resolution)) throw new Error('동기화할 목록을 선택해 주세요.');
                        await run({ resolution: message.resolution, conflictToken: message.conflictToken });
                        break;
                    default: throw new Error('지원하지 않는 동기화 요청입니다.');
                }
                sendResponse({ ok: true, status: await status() });
            } catch (error) {
                sendResponse({ ok: false, error: error.message, status: await status() });
            }
        })();
        return true;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || (!changes.bookStoreChange && !changes.missingVolsMap)) return;
        void scheduleChange().catch(() => {});
    });
    chrome.alarms.onAlarm.addListener(alarm => {
        if (alarm.name === ALARM || alarm.name === CHANGE_ALARM) {
            void run({ automaticTrigger: alarm.name === CHANGE_ALARM ? 'change' : 'periodic' }).catch(() => {});
        }
    });
    chrome.runtime.onStartup.addListener(() => { void initialize().catch(() => {}); });
    chrome.runtime.onInstalled.addListener(() => { void initialize().catch(() => {}); });

    return { initialize, status, run, disconnect };
})();
