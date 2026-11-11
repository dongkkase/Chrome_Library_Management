const FileBackupFolder = (() => {
    const NAME = 'LibraryMatchingManagerBackups';
    let database;

    function open() {
        if (!database) {
            database = new Promise((resolve, reject) => {
                const request = indexedDB.open('LibraryMatchingBackupFolders', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('folders', { keyPath: 'id' });
                request.onsuccess = () => {
                    const db = request.result;
                    db.onversionchange = () => { db.close(); database = null; };
                    resolve(db);
                };
                request.onerror = () => { database = null; reject(request.error); };
            });
        }
        return database;
    }

    async function transaction(mode, operation) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('folders', mode);
            const request = operation(tx.objectStore('folders'));
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error || request.error);
            tx.onabort = () => reject(tx.error || new Error('백업 폴더 설정을 저장하지 못했습니다.'));
        });
    }

    async function get(id) {
        if (typeof id !== 'string' || !id) throw new Error('백업 폴더 설정이 올바르지 않습니다.');
        const record = await transaction('readonly', store => store.get(id));
        if (!record || record.handle?.kind !== 'directory' || record.handle.name !== NAME) {
            throw new Error('선택한 백업 폴더를 찾을 수 없습니다. 저장 폴더를 다시 선택해 주세요.');
        }
        return record;
    }

    async function requirePermission(handle) {
        if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
            throw new Error('백업 폴더에 접근할 수 없습니다. 설정 화면에서 폴더 접근을 다시 허용해 주세요.');
        }
    }

    async function storeSelection(parent) {
        if (parent?.kind !== 'directory') throw new Error('백업을 저장할 폴더를 선택해 주세요.');
        await requirePermission(parent);
        const handle = parent.name === NAME ? parent : await parent.getDirectoryHandle(NAME, { create: true });
        const record = {
            id: crypto.randomUUID(), handle,
            label: parent.name === NAME ? NAME : `${parent.name} → ${NAME}`
        };
        await transaction('readwrite', store => store.put(record));
        return { id: record.id, label: record.label };
    }

    async function describe(id) {
        const record = await get(id);
        return { id: record.id, label: record.label, permission: await record.handle.queryPermission({ mode: 'readwrite' }) };
    }

    function checkFilename(name) {
        if (typeof name !== 'string' || !/^book_manager_backup_[\w.-]+\.json$/.test(name)) {
            throw new Error('백업 파일 이름이 올바르지 않습니다.');
        }
    }

    async function readFile(id, name) {
        checkFilename(name);
        const { handle } = await get(id);
        await requirePermission(handle);
        try {
            return await (await handle.getFileHandle(name)).getFile();
        } catch (error) {
            if (error.name === 'NotFoundError') return null;
            throw error;
        }
    }

    async function writeFile(id, name, text) {
        checkFilename(name);
        const { handle } = await get(id);
        await requirePermission(handle);
        if (await readFile(id, name)) throw new Error('같은 이름의 백업 파일이 이미 있습니다. 다시 백업해 주세요.');
        const file = await handle.getFileHandle(name, { create: true });
        const writer = await file.createWritable();
        try {
            await writer.write(text);
            await writer.close();
        } catch (error) {
            try { await writer.abort(); } catch (_) {}
            throw error;
        }
    }

    return { NAME, get, storeSelection, describe, readFile, writeFile };
})();
