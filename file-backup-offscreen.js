(() => {
    const urls = new Map();
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.target !== 'file-backup-offscreen' || message.action !== 'create') return;
        if (sender.id !== chrome.runtime.id || sender.tab
            || (sender.url && sender.url !== chrome.runtime.getURL('background.js'))) return;
        try {
            if (typeof message.text !== 'string' || typeof message.requestId !== 'string') {
                throw new Error('백업 파일 내용이 올바르지 않습니다.');
            }
            if (!urls.has(message.requestId)) {
                const blob = new Blob([message.text], { type: 'application/json;charset=utf-8' });
                urls.set(message.requestId, URL.createObjectURL(blob));
            }
            sendResponse({ ok: true, url: urls.get(message.requestId) });
        } catch (error) {
            sendResponse({ ok: false, error: error.message });
        }
    });
    window.addEventListener('unload', () => {
        for (const url of urls.values()) URL.revokeObjectURL(url);
    });
})();
