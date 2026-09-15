'use strict';

(() => {
    const samples = [
        { id: 'starlight', title: '별빛 도서관', category: '만화', volume: 5, resolution: 2000, owned: { type: 'incomplete', volume: 3, resolution: 1500, missing: [] } },
        { id: 'cloud', title: '구름 우체국', category: '만화', volume: 8, resolution: 2000, owned: { type: 'complete', volume: 8, resolution: 2000, missing: [] } },
        { id: 'wind', title: '바람의 기록', category: '소설', volume: 5, resolution: 1500, owned: { type: 'incomplete', volume: 5, resolution: 1500, missing: [2] } },
        { id: 'afternoon', title: '느린 오후의 지도', category: '만화', volume: 2, resolution: 1500, owned: { type: 'exclude', volume: 2, resolution: 1500, missing: [] } },
        { id: 'moon', title: '달빛 정원', category: '소설', volume: 1, resolution: 1800, owned: null },
        { id: 'sea', title: '바다의 작은 서점', category: '만화', volume: 6, resolution: 2400, owned: { type: 'complete', volume: 6, resolution: 1500, missing: [] } },
        { id: 'similar', title: '느린 오후 지도', category: '만화', volume: 2, resolution: 1500, score: 94, owned: { title: '느린 오후의 지도', type: 'exclude', volume: 2, resolution: 1500, missing: [] } },
        { id: 'translation', title: '숲속의 여행자', category: '번역', translated: true, volume: 3, resolution: 1800, owned: null },
        { id: 'station', title: '새벽역의 편지', category: '소설', volume: 4, resolution: 1500, owned: { type: 'incomplete', volume: 4, resolution: 1500, missing: [] } }
    ];
    const typeLabels = { exclude: '제외', incomplete: '미완', complete: '완결' };
    const rows = document.getElementById('exampleRows');
    const enabledInput = document.getElementById('demoEnabled');
    const hoverInput = document.getElementById('demoQuickHover');
    const feedback = document.getElementById('demoFeedback');
    const hiddenSettings = { hideExclude: false, hideComplete: false, hideIncomplete: false, hideTranslate: false, hideNew: false };
    let books = structuredClone(samples);
    let selectedId = books[0].id;
    let missingBookId = null;
    let missingOpener = null;

    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    function storedBook(book) {
        return book.owned ? {
            title: book.owned.title || book.title,
            type: book.owned.type,
            resolution: `${book.owned.resolution}px`,
            lastVol: String(book.owned.volume),
            missingVols: book.owned.missing
        } : null;
    }

    function isHidden(book) {
        return enabledInput.checked && BookMatchUI.shouldHidePost({
            book: storedBook(book), score: book.score ?? 100,
            siteRes: book.resolution, siteVol: book.volume, translated: !!book.translated
        }, hiddenSettings);
    }

    function getComparison(book) {
        if (!book.owned) return { summary: book.translated ? '번역 · 미등록' : '미등록 · 신작' };
        const upgrades = BookMatchUI.getUpgrades(storedBook(book), book.resolution, book.volume);
        const notes = [];
        if (book.owned.type === 'exclude') notes.push((book.score ?? 100) <= 95 ? '유사 매칭 · 제외 숨김 예외' : '관심 목록에서 제외');
        else {
            if (upgrades.volume) notes.push('새 권수');
            if (upgrades.resolution) notes.push('더 높은 해상도');
        }
        if (book.owned.missing.length) notes.push(`${book.owned.missing.join(', ')}권 누락`);
        return { ...upgrades, summary: notes.join(' · ') || '등록 정보와 같음' };
    }

    function getPostTitle(book) {
        return `${book.translated ? '[번역] ' : ''}${book.title} ${book.volume === 1 ? '1' : `1~${book.volume}`}권 ${book.resolution}px`;
    }

    function applyPresentation(title, badgeTarget, book, detail = false) {
        const presentation = BookMatchUI.getPresentation(storedBook(book), book.resolution, book.volume, book.score ?? 100, detail);
        title.removeAttribute('style');
        title.removeAttribute('title');
        if (!enabledInput.checked || !book.owned) return;
        Object.entries(presentation.titleStyles).forEach(([property, value]) => title.style.setProperty(property, value, 'important'));
        title.title = `등록된 책 제목: ${book.owned.title || book.title} (${presentation.score}%)`;
        const badge = element('span', undefined, 'book-badge');
        badge.style.cssText = presentation.style;
        badge.innerHTML = presentation.html;
        badgeTarget.appendChild(badge);
    }

    function createActions(book, detail = false) {
        const actions = element('span', undefined, `bm-quick-actions${detail ? '' : ' list-actions'}`);
        actions.setAttribute('role', 'group');
        actions.setAttribute('aria-label', `${book.title} 퀵 액션`);
        actions.style.cssText = `display:inline-flex; gap:4px; margin-left:0; margin-top:${detail ? 5 : 4}px; vertical-align:middle; flex-wrap:wrap;`;
        for (const definition of BookMatchUI.quickButtons) {
            if (!book.owned && ['delete', 'missing_vol', 'correct_title'].includes(definition.action)) continue;
            const button = element('button', definition.label);
            button.type = 'button';
            button.dataset.demoAction = definition.action;
            button.style.cssText = BookMatchUI.quickButtonStyle + `background-color:${definition.color};`;
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                runAction(book.id, definition.action, button);
            });
            actions.appendChild(button);
        }
        return actions;
    }

    function renderBoard() {
        rows.replaceChildren();
        document.querySelectorAll('#demo-quick-hide-panel input').forEach(input => { input.disabled = !enabledInput.checked; });
        hoverInput.disabled = !enabledInput.checked;
        let hiddenCount = 0;
        for (const book of books) {
            if (isHidden(book)) {
                hiddenCount++;
                continue;
            }
            const row = element('tr');
            row.appendChild(element('td', book.category));
            const titleCell = element('td');
            const title = element('a', getPostTitle(book), 'post-title');
            title.href = '#detail';
            title.dataset.sampleId = book.id;
            titleCell.appendChild(title);
            applyPresentation(title, title, book);
            if (enabledInput.checked) {
                titleCell.appendChild(element('br'));
                titleCell.appendChild(createActions(book));
            }
            row.appendChild(titleCell);
            row.appendChild(element('td', enabledInput.checked ? getComparison(book).summary : '적용 전', 'muted'));
            rows.appendChild(row);
        }
        if (hiddenCount === books.length) {
            const row = element('tr');
            const cell = element('td', '표시할 예시가 없습니다. 게시물 숨김 조건을 해제하거나 예시를 초기화하세요.');
            cell.colSpan = 3;
            row.appendChild(cell);
            rows.appendChild(row);
        }
        document.getElementById('demoSummary').textContent = `전체 ${books.length}개 중 ${books.length - hiddenCount}개 표시 · ${hiddenCount}개 숨김${enabledInput.checked ? ' · 배지는 내 소장 정보입니다.' : ' · 매칭 표시를 켜면 소장 정보와 비교합니다.'}`;
    }

    function renderDefinitionList(targetId, entries) {
        const target = document.getElementById(targetId);
        target.replaceChildren();
        for (const [label, value] of entries) {
            const row = element('div');
            row.append(element('dt', label), element('dd', value));
            target.appendChild(row);
        }
    }

    function renderDetail() {
        const book = books.find(item => item.id === selectedId);
        const title = document.getElementById('detailTitle');
        title.textContent = getPostTitle(book);
        const badgeTarget = document.getElementById('detailBadge');
        badgeTarget.replaceChildren();
        applyPresentation(title, badgeTarget, book, true);
        const actions = document.getElementById('detailActions');
        actions.replaceChildren();
        if (enabledInput.checked) actions.appendChild(createActions(book, true));
        renderDefinitionList('publishedData', [
            ['제목', book.title], ['권수', `${book.volume}권`], ['해상도', `${book.resolution}px`]
        ]);
        renderDefinitionList('ownedData', book.owned ? [
            ['제목', book.owned.title || book.title], ['분류', typeLabels[book.owned.type]], ['권수', `${book.owned.volume}권`],
            ['해상도', `${book.owned.resolution}px`], ['누락', book.owned.missing.length ? `${book.owned.missing.join(', ')}권` : '없음']
        ] : [['분류', '미등록'], ['소장 정보', '아직 등록하지 않은 작품입니다.']]);
        const comparison = getComparison(book);
        let explanation;
        if (!book.owned) explanation = '소장 목록에 없는 작품입니다. 제목을 확인한 뒤 원하는 타입으로 등록할 수 있습니다.';
        else if (book.owned.type === 'exclude') explanation = (book.score ?? 100) <= 95
            ? '유사 매칭 94% 예시입니다. 제외로 등록되어 있어도 매칭률이 95% 이하이면 제외 숨김으로 가려지지 않습니다. 등록된 책 제목을 먼저 확인하세요.'
            : '제외로 등록한 작품은 제목에 취소선과 투명도가 적용됩니다. 우측 하단에서 제외 숨김을 켜면 게시판 목록에서 사라집니다.';
        else if (comparison.volume || comparison.resolution) explanation = `${comparison.summary}: 노란 UP 표시와 배지 그림자로 강조됩니다. 미완·완결 숨김을 켜도 업그레이드가 있으면 목록에 표시됩니다.`;
        else if (book.owned.missing.length) explanation = `${comparison.summary}: 누락관리 버튼을 누르고 빠진 번호를 클릭하세요. 누락이 남아 있는 동안 미완·완결 숨김의 예외가 적용됩니다.`;
        else explanation = '게시물과 소장 정보가 같습니다. 선택한 타입의 숨김 스위치를 켜면 이 게시물은 목록에서 숨겨집니다.';
        document.getElementById('detailExplanation').textContent = explanation + (isHidden(book) ? ' 현재 게시판 목록에서는 숨겨져 있습니다. 열린 상세 예시는 계속 볼 수 있습니다.' : '');
    }

    const popover = element('div', undefined, 'bm-missing-popover');
    popover.id = 'demo-missing-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', '예시 누락관리');
    popover.style.cssText = BookMatchUI.missingPopoverStyle;
    document.body.appendChild(popover);

    function closeMissing(restoreFocus = false) {
        popover.style.display = 'none';
        missingBookId = null;
        if (restoreFocus) {
            if (missingOpener?.isConnected) missingOpener.focus();
            else document.getElementById('detailTitle').focus({ preventScroll: true });
        }
    }

    function openMissing(book, opener) {
        missingBookId = book.id;
        missingOpener = opener;
        popover.innerHTML = BookMatchUI.missingPopoverHtml(storedBook(book), 'demoClosePopoverBtn');
        popover.style.cssText = BookMatchUI.missingPopoverStyle;
        const rect = opener.getBoundingClientRect();
        const center = Math.max(135, Math.min(window.innerWidth - 135, rect.left + rect.width / 2));
        popover.style.top = `${rect.bottom + window.scrollY + 12}px`;
        popover.style.left = `${center + window.scrollX}px`;
        popover.style.display = 'block';
        popover.querySelector('#demoClosePopoverBtn').focus({ preventScroll: true });
    }

    popover.addEventListener('click', event => {
        event.stopPropagation();
        if (event.target.closest('#demoClosePopoverBtn')) return closeMissing(true);
        const button = event.target.closest('[data-vol]');
        if (!button || !missingBookId) return;
        const book = books.find(item => item.id === missingBookId);
        const volume = Number(button.dataset.vol);
        const missing = new Set(book.owned.missing);
        if (missing.has(volume)) missing.delete(volume);
        else missing.add(volume);
        book.owned.missing = [...missing].sort((a, b) => a - b);
        popover.innerHTML = BookMatchUI.missingPopoverHtml(storedBook(book), 'demoClosePopoverBtn');
        popover.querySelector(`[data-vol="${volume}"]`).focus({ preventScroll: true });
        renderBoard();
        renderDetail();
        feedback.textContent = `체험: ‘${book.title}’의 누락 권수를 ${book.owned.missing.length ? book.owned.missing.join(', ') + '권' : '없음'}으로 변경했습니다.`;
    });
    document.addEventListener('click', event => {
        if (!popover.contains(event.target) && !event.target.closest('[data-demo-action="missing_vol"]')) closeMissing();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMissing(true); });

    async function runAction(id, action, opener) {
        const book = books.find(item => item.id === id);
        if (action === 'missing_vol') return openMissing(book, opener);
        closeMissing();
        selectedId = id;
        if (action === 'copy') {
            try {
                await navigator.clipboard.writeText(book.owned?.title || book.title);
                feedback.textContent = `체험: ‘${book.owned?.title || book.title}’ 제목을 복사했습니다.`;
            } catch {
                feedback.textContent = `복사할 제목: ${book.owned?.title || book.title}`;
            }
        } else if (['search', 'ridi_preview', 'everything_search'].includes(action)) {
            const label = BookMatchUI.quickButtons.find(button => button.action === action).label;
            feedback.textContent = `체험: ${label}에 사용할 검색어는 ‘${book.owned?.title || book.title}’입니다. 실제 사이트에서는 해당 검색 기능을 실행합니다.`;
        } else if (action === 'correct_title') {
            const title = window.prompt('예시에서 정정할 제목을 입력하세요.', book.owned.title || book.title);
            if (title === null || !title.trim()) return;
            book.owned.title = title.trim();
            book.score = 100;
            feedback.textContent = `체험: 예시 소장 제목을 ‘${book.owned.title}’로 정정했습니다.`;
        } else if (action === 'delete') {
            book.owned = null;
            feedback.textContent = `체험: ‘${book.title}’을 예시 소장 목록에서 삭제했습니다. 게시물은 미등록으로 분류됩니다.`;
        } else if (Object.hasOwn(typeLabels, action)) {
            if (!book.owned) book.score = 100;
            book.owned = { ...book.owned, type: action, volume: book.volume, resolution: book.resolution, missing: book.owned ? [...book.owned.missing] : [] };
            feedback.textContent = `체험: ‘${book.title}’을 ‘${typeLabels[action]}’ 상태로 등록했습니다. 예시 소장 정보는 ${book.volume}권 / ${book.resolution}px입니다.`;
        }
        renderBoard();
        renderDetail();
        if (isHidden(book)) feedback.textContent += ' 현재 숨김 조건에 따라 게시판 목록에서는 숨겨집니다.';
        feedback.textContent += ' 실제 소장 목록과 설정은 변경되지 않습니다.';
        if (!opener.isConnected) {
            const replacement = document.querySelector(`#detailActions [data-demo-action="${action}"]`);
            (replacement || document.getElementById('detailTitle')).focus({ preventScroll: true });
        }
    }

    rows.addEventListener('click', event => {
        const link = event.target.closest('[data-sample-id]');
        if (!link) return;
        selectedId = link.dataset.sampleId;
        feedback.textContent = '';
        closeMissing();
        renderDetail();
        document.getElementById('detailTitle').focus({ preventScroll: true });
    });

    const hidePanel = BookMatchUI.createHidePanel(hiddenSettings, (key, checked) => {
        hiddenSettings[key] = checked;
        closeMissing();
        renderBoard();
        renderDetail();
    }, 'demo', true);
    document.body.appendChild(hidePanel);
    enabledInput.addEventListener('change', () => { closeMissing(); renderBoard(); renderDetail(); });
    hoverInput.addEventListener('change', () => document.body.classList.toggle('demo-quick-hover', hoverInput.checked));
    document.getElementById('resetDemo').addEventListener('click', () => {
        books = structuredClone(samples);
        selectedId = books[0].id;
        enabledInput.checked = true;
        hoverInput.checked = false;
        document.body.classList.remove('demo-quick-hover');
        Object.keys(hiddenSettings).forEach(key => { hiddenSettings[key] = false; });
        hidePanel.querySelectorAll('input').forEach(input => { input.checked = false; });
        const panelToggle = hidePanel.querySelector('.bm-qh-toggle-btn');
        if (panelToggle.getAttribute('aria-expanded') === 'false') panelToggle.click();
        closeMissing();
        feedback.textContent = '예시 데이터와 숨김 설정을 초기 상태로 되돌렸습니다.';
        renderBoard();
        renderDetail();
    });

    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    let savedTheme;
    function applyTheme() {
        const dark = typeof savedTheme === 'boolean' ? savedTheme : systemTheme.matches;
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        document.body.classList.toggle('dark-mode', dark);
    }
    applyTheme();
    systemTheme.addEventListener('change', applyTheme);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['darkMode'], data => {
            if (chrome.runtime.lastError) return;
            savedTheme = data.darkMode;
            applyTheme();
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.darkMode) {
                savedTheme = changes.darkMode.newValue;
                applyTheme();
            }
        });
    }

    const navigationLinks = document.querySelectorAll('.sidebar a');
    function updateNavigation() {
        const activeHash = window.location.hash || '#intro';
        navigationLinks.forEach(link => {
            if (link.getAttribute('href') === activeHash) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    }
    window.addEventListener('hashchange', updateNavigation);
    updateNavigation();
    renderBoard();
    renderDetail();
})();
