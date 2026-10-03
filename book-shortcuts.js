const BookShortcuts = (() => {
    const PAGE_SIZE = 9;
    const downloadTriggers = new WeakSet();

    function clickDownload(button) {
        downloadTriggers.add(button);
        try {
            button.click();
        } finally {
            downloadTriggers.delete(button);
        }
    }

    function create({ sites, isContextValid }) {
        let enabled = false;
        let modal = null;

        function getSite() {
            const hostname = window.location.hostname.toLowerCase();
            return sites.find(site => site.shortcuts
                && (hostname === site.url || hostname.endsWith(`.${site.url}`)));
        }

        function isAvailable(element) {
            if (!element?.isConnected || element.matches(':disabled')
                || element.closest('[hidden], [inert], [aria-disabled="true"], [aria-busy="true"]')) return false;
            const style = window.getComputedStyle(element);
            if (style.pointerEvents === 'none' || style.visibility !== 'visible') return false;
            return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
                && element.getClientRects().length > 0;
        }

        function isEditing(event) {
            if (document.designMode === 'on') return true;
            const targets = [...event.composedPath(), document.activeElement];
            return targets.some(element => element?.nodeType === 1
                && (element.isContentEditable
                    || element.closest('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"]')));
        }

        function closeModal() {
            if (!modal) return;
            const { dialog, host, previousFocus } = modal;
            modal = null;
            dialog.close();
            host.remove();
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        }

        function selectDownload(button) {
            const canActivate = enabled && isContextValid() && getSite() && isAvailable(button);
            closeModal();
            if (canActivate) clickDownload(button);
        }

        function showDownloads(buttons) {
            if (modal) return;
            const previousFocus = document.activeElement;
            const host = document.createElement('div');
            host.id = 'bm-download-shortcut-modal';
            const shadow = host.attachShadow({ mode: 'open' });
            const style = document.createElement('style');
            style.textContent = `
                :host { all: initial; }
                * { box-sizing: border-box; }
                dialog { width: min(680px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 24px; border: 1px solid #dce3ed; border-radius: 16px; background: #fff; color: #243249; box-shadow: 0 16px 64px #18263a40; font: 14px/1.5 system-ui, sans-serif; }
                dialog::backdrop { background: #10182780; }
                header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
                h2 { margin: 0; font-size: 19px; }
                p { margin: 8px 0 18px; color: #64738a; }
                .rows { display: grid; gap: 8px; }
                .row { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px; border: 1px solid #e0e6ef; border-radius: 9px; background: #f8faff; }
                .url { overflow-wrap: anywhere; user-select: text; }
                kbd { padding: 3px 7px; border: 1px solid #c8d1df; border-radius: 5px; background: #fff; font: 600 13px/1.5 system-ui, sans-serif; text-align: center; }
                button { padding: 7px 12px; border: 1px solid #c8d1df; border-radius: 7px; background: #fff; color: #243249; font: inherit; cursor: pointer; white-space: nowrap; }
                .download { background: #365edc; border-color: #365edc; color: #fff; }
                button:hover { filter: brightness(.94); }
                button:focus-visible { outline: 2px solid #365edc; outline-offset: 3px; }
                button:disabled { opacity: .4; cursor: default; }
                footer { margin-top: 18px; }
                footer[hidden] { display: none; }
                @media (max-width: 480px) { dialog { padding: 16px; } .row { gap: 8px; padding: 10px; } button { padding: 6px 9px; } }
            `;
            const dialog = document.createElement('dialog');
            dialog.setAttribute('aria-labelledby', 'download-shortcut-title');
            dialog.setAttribute('aria-describedby', 'download-shortcut-help');
            dialog.innerHTML = `
                <header><h2 id="download-shortcut-title">다운로드 주소 선택</h2><button type="button" class="close" aria-label="닫기">닫기</button></header>
                <p id="download-shortcut-help">숫자 키 1~9 또는 다운로드 버튼으로 선택하세요. Esc로 닫습니다.</p>
                <div class="rows"></div>
                <footer><button type="button" class="previous">이전</button><span class="page" aria-live="polite"></span><button type="button" class="next">다음</button></footer>
            `;
            shadow.append(style, dialog);
            document.body.appendChild(host);
            modal = { host, dialog, buttons, page: 0, previousFocus };
            dialog.querySelector('.close').addEventListener('click', closeModal);
            dialog.querySelector('.previous').addEventListener('click', () => changePage(-1));
            dialog.querySelector('.next').addEventListener('click', () => changePage(1));
            dialog.addEventListener('cancel', event => {
                event.preventDefault();
                closeModal();
            });
            renderPage();
            dialog.showModal();
            dialog.querySelector('.download').focus();
        }

        function renderPage() {
            const { dialog, buttons, page } = modal;
            const rows = dialog.querySelector('.rows');
            rows.replaceChildren();
            buttons.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((button, index) => {
                const row = document.createElement('div');
                row.className = 'row';
                const key = document.createElement('kbd');
                key.textContent = String(index + 1);
                const address = document.createElement('span');
                address.className = 'url';
                address.textContent = button.dataset.downloadUrl || '주소를 확인할 수 없습니다.';
                const download = document.createElement('button');
                download.type = 'button';
                download.className = 'download';
                download.textContent = '다운로드';
                download.setAttribute('aria-label', `${index + 1}번 다운로드: ${address.textContent}`);
                download.addEventListener('click', () => selectDownload(button));
                row.append(key, address, download);
                rows.appendChild(row);
            });
            const pageCount = Math.ceil(buttons.length / PAGE_SIZE);
            dialog.querySelector('footer').hidden = pageCount <= 1;
            dialog.querySelector('.page').textContent = `${page + 1} / ${pageCount} · 방향키 ← →`;
            dialog.querySelector('.previous').disabled = page === 0;
            dialog.querySelector('.next').disabled = page === pageCount - 1;
        }

        function changePage(delta) {
            if (!modal) return;
            const next = modal.page + delta;
            if (next < 0 || next >= Math.ceil(modal.buttons.length / PAGE_SIZE)) return;
            modal.page = next;
            renderPage();
            modal.dialog.querySelector('.download').focus();
        }

        function consume(event) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }

        function handleKeydown(event) {
            if (!enabled || !isContextValid() || !getSite()) {
                closeModal();
                return;
            }
            if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229
                || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || isEditing(event)) return;

            if (modal) {
                if (!modal.buttons.some(isAvailable)) {
                    closeModal();
                    return;
                }
                if (event.key === 'Escape') {
                    consume(event);
                    closeModal();
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    consume(event);
                    changePage(event.key === 'ArrowLeft' ? -1 : 1);
                } else if (/^[1-9]$/.test(event.key)) {
                    const button = modal.buttons[modal.page * PAGE_SIZE + Number(event.key) - 1];
                    if (button) {
                        consume(event);
                        selectDownload(button);
                    }
                } else if (event.code === 'KeyD' || event.key.toLowerCase() === 'd') {
                    consume(event);
                }
                return;
            }

            if (event.code !== 'KeyD' && event.key.toLowerCase() !== 'd') return;
            if (Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')).some(isAvailable)) return;
            const { openSelector, downloadSelector } = getSite().shortcuts;
            const openButton = Array.from(document.querySelectorAll(openSelector)).find(isAvailable);
            if (openButton) {
                consume(event);
                openButton.click();
                return;
            }
            const downloads = Array.from(document.querySelectorAll(downloadSelector)).filter(isAvailable);
            if (!downloads.length) return;
            consume(event);
            if (downloads.length === 1) clickDownload(downloads[0]);
            else showDownloads(downloads);
        }

        function setEnabled(value) {
            enabled = value === true;
            document.removeEventListener('keydown', handleKeydown);
            if (enabled && getSite()) document.addEventListener('keydown', handleKeydown);
            else closeModal();
        }

        return { setEnabled };
    }

    return { create, isDownloadTrigger: button => downloadTriggers.has(button) };
})();
