(function () {
    'use strict';

    const API_ROOT = 'https://www.googleapis.com/drive/v2';
    const UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v2';
    const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
    const FILE_NAME = 'book-manager-db-v1.json';
    const REQUEST_TIMEOUT_MS = 25000;
    const ACCOUNT_PATH = '/about?fields=user(permissionId,emailAddress)';

    function syncError(message, name = 'GoogleSyncError', status) {
        const error = new Error(message);
        error.name = name;
        if (status !== undefined) error.status = status;
        return error;
    }

    function conflictError() {
        return syncError('다른 기기에서 Google Drive DB가 변경되었습니다. 다시 동기화해 주세요.', 'GoogleSyncConflictError');
    }

    function authError() {
        return syncError('Google 계정 인증이 필요합니다. 동기화 설정에서 다시 연결해 주세요.', 'GoogleSyncAuthError');
    }

    function getToken(interactive) {
        return new Promise((resolve, reject) => {
            if (!globalThis.chrome?.identity?.getAuthToken) {
                reject(authError());
                return;
            }
            try {
                chrome.identity.getAuthToken({ interactive: interactive === true, scopes: [SCOPE] }, result => {
                    const runtimeError = chrome.runtime?.lastError;
                    const token = typeof result === 'string' ? result : result?.token;
                    if (runtimeError || typeof token !== 'string' || !token) reject(authError());
                    else resolve(token);
                });
            } catch (_) {
                reject(authError());
            }
        });
    }

    function removeToken(token) {
        return new Promise((resolve, reject) => {
            try {
                chrome.identity.removeCachedAuthToken({ token }, () => {
                    if (chrome.runtime?.lastError) reject(authError());
                    else resolve();
                });
            } catch (_) {
                reject(authError());
            }
        });
    }

    function assertEtag(etag) {
        if (typeof etag !== 'string' || !/^"[^"\r\n]+"$/.test(etag)) {
            throw syncError('Google Drive 파일 버전을 확인할 수 없어 동기화를 중단했습니다.');
        }
    }

    function assertFileId(fileId) {
        if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
            throw syncError('Google Drive 파일 정보를 확인할 수 없습니다.');
        }
    }

    function parseAccount(data) {
        const user = data?.user;
        if (typeof user?.permissionId !== 'string' || !user.permissionId) {
            throw syncError('Google Drive 계정 정보를 확인할 수 없습니다.');
        }
        return { id: user.permissionId, email: typeof user.emailAddress === 'string' ? user.emailAddress : '' };
    }

    async function create(interactive = false) {
        let token = await getToken(interactive);
        let knownAccount = null;

        async function fetchJson(url, options = {}) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            try {
                const response = await fetch(url, {
                    ...options,
                    headers: { ...options.headers, Authorization: `Bearer ${token}` },
                    cache: 'no-store',
                    credentials: 'omit',
                    redirect: 'error',
                    signal: controller.signal
                });
                if (!response.ok) {
                    if (response.status === 412 || response.status === 404) throw conflictError();
                    if (response.status === 401) throw syncError(authError().message, 'GoogleSyncAuthError', 401);
                    if (response.status === 403) throw syncError('Google Drive 접근 권한 또는 저장 공간을 확인해 주세요.', 'GoogleSyncError', 403);
                    if (response.status === 429 || response.status >= 500) {
                        throw syncError('Google Drive가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.', 'GoogleSyncError', response.status);
                    }
                    throw syncError('Google Drive 요청을 처리할 수 없습니다.', 'GoogleSyncError', response.status);
                }
                // Keep the timeout active while downloading and parsing the response body.
                return await response.json();
            } catch (error) {
                if (error?.name?.startsWith('GoogleSync')) throw error;
                if (controller.signal.aborted) throw syncError('Google Drive 요청 시간이 초과되었습니다. 다시 시도해 주세요.');
                if (error?.name === 'SyntaxError') throw syncError('Google Drive DB 파일을 읽을 수 없습니다.');
                throw syncError('Google Drive에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.');
            } finally {
                clearTimeout(timeout);
            }
        }

        async function request(url, options) {
            try {
                return await fetchJson(url, options);
            } catch (error) {
                if (error.status !== 401) throw error;
                await removeToken(token);
                token = await getToken(false);
                if (knownAccount) {
                    const refreshedAccount = parseAccount(await fetchJson(API_ROOT + ACCOUNT_PATH));
                    if (refreshedAccount.id !== knownAccount.id) {
                        throw syncError('Google 계정이 변경되었습니다. 동기화 설정에서 다시 연결해 주세요.', 'GoogleSyncAccountChangedError');
                    }
                }
                // A second 401 is returned to the caller; never reopen the login prompt here.
                return fetchJson(url, options);
            }
        }

        async function account() {
            const current = parseAccount(await request(API_ROOT + ACCOUNT_PATH));
            if (knownAccount && current.id !== knownAccount.id) {
                throw syncError('Google 계정이 변경되었습니다. 동기화 설정에서 다시 연결해 주세요.', 'GoogleSyncAccountChangedError');
            }
            knownAccount = current;
            return { ...current };
        }

        async function findFile() {
            let file = null;
            let pageToken = '';
            const visitedPages = new Set();
            do {
                if (visitedPages.has(pageToken) || visitedPages.size >= 100) {
                    throw syncError('Google Drive 파일 목록을 끝까지 확인할 수 없습니다.');
                }
                visitedPages.add(pageToken);
                const params = new URLSearchParams({
                    spaces: 'appDataFolder',
                    q: `title = '${FILE_NAME}' and trashed = false`,
                    maxResults: '100',
                    fields: 'items(id),nextPageToken,incompleteSearch'
                });
                if (pageToken) params.set('pageToken', pageToken);
                const data = await request(`${API_ROOT}/files?${params}`);
                if (!data || typeof data !== 'object' || Array.isArray(data) || data.incompleteSearch ||
                    (data.items !== undefined && !Array.isArray(data.items))) {
                    throw syncError('Google Drive 파일 목록을 끝까지 확인할 수 없습니다.');
                }
                for (const item of data.items || []) {
                    assertFileId(item?.id);
                    if (file) {
                        throw syncError('Google Drive에 동기화 DB가 여러 개 있어 중단했습니다. 기기별 DB를 백업한 후 동기화 데이터를 확인해 주세요.', 'GoogleSyncDuplicateError');
                    }
                    file = item.id;
                }
                if (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string') {
                    throw syncError('Google Drive 파일 목록을 끝까지 확인할 수 없습니다.');
                }
                pageToken = data.nextPageToken || '';
            } while (pageToken);
            return file;
        }

        async function metadata(fileId) {
            const data = await request(`${API_ROOT}/files/${encodeURIComponent(fileId)}?fields=id,etag`);
            if (data?.id !== fileId) throw conflictError();
            assertEtag(data.etag);
            return data;
        }

        async function read() {
            const fileId = await findFile();
            if (!fileId) return null;
            const before = await metadata(fileId);
            const payload = await request(`${API_ROOT}/files/${encodeURIComponent(fileId)}?alt=media`);
            // Media and metadata can have different HTTP ETags. Verify the resource
            // before and after the download instead of mixing those two validators.
            const after = await metadata(fileId);
            if (before.etag !== after.etag) throw conflictError();
            if (await findFile() !== fileId) throw conflictError();
            return { fileId, etag: after.etag, payload };
        }

        async function assertUnchanged(remote) {
            if (remote !== null) {
                assertFileId(remote?.fileId);
                assertEtag(remote.etag);
            }
            const currentId = await findFile();
            if (currentId !== (remote?.fileId || null)) throw conflictError();
            if (remote === null) return;
            const current = await metadata(remote.fileId);
            if (current.etag !== remote.etag) throw conflictError();
        }

        async function write(payload, remote) {
            let body;
            try {
                body = JSON.stringify(payload);
            } catch (_) {
                throw syncError('동기화할 DB를 준비할 수 없습니다.');
            }
            if (typeof body !== 'string') throw syncError('동기화할 DB를 준비할 수 없습니다.');
            if (remote) {
                assertFileId(remote.fileId);
                assertEtag(remote.etag);
            }
            const currentId = await findFile();
            if (currentId !== (remote?.fileId || null)) throw conflictError();
            let result;
            if (remote) {
                result = await request(`${UPLOAD_ROOT}/files/${encodeURIComponent(remote.fileId)}?uploadType=media&fields=id,etag`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'If-Match': remote.etag },
                    body
                });
                if (result?.id !== remote.fileId) throw conflictError();
            } else {
                const boundary = `book_manager_${crypto.randomUUID().replace(/-/g, '')}`;
                const fileMetadata = { title: FILE_NAME, mimeType: 'application/json', parents: [{ id: 'appDataFolder' }] };
                const multipart = [
                    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(fileMetadata)}`,
                    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}`,
                    `--${boundary}--\r\n`
                ].join('\r\n');
                result = await request(`${UPLOAD_ROOT}/files?uploadType=multipart&fields=id,etag`, {
                    method: 'POST',
                    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
                    body: multipart
                });
                assertFileId(result?.id);
                // Drive does not enforce unique names. A concurrent first upload must
                // not select one of the resulting files and overwrite the other DB.
                if (await findFile() !== result.id) throw conflictError();
            }
            assertEtag(result?.etag);
            return { fileId: result.id, etag: result.etag, payload };
        }

        return Object.freeze({ account, read, assertUnchanged, write });
    }

    globalThis.GoogleBookDrive = Object.freeze({ create });
})();
