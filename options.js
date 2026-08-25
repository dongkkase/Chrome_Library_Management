const listBody = document.getElementById('listBody');

function showInfoToast(msg, isError = false) {
  let container = document.getElementById('book-manager-info-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'book-manager-info-toast-container';
    container.style.cssText = "position:fixed; bottom:20px; right:20px; z-index:999999; display:flex; flex-direction:column; gap:10px; pointer-events:none;";
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  const bgColor = isError ? '#dc3545' : '#17a2b8';
  
  toast.style.cssText = "background: " + bgColor + "; color: white; padding: 12px 35px 12px 20px; border-radius: 8px; font-size: 14px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3); opacity: 0; transform: translateX(20px); transition: all 0.3s ease; white-space: nowrap; pointer-events: auto; position: relative;";
  toast.innerHTML = msg;

  const closeBtn = document.createElement('span');
  closeBtn.innerHTML = "&times;";
  closeBtn.style.cssText = "position: absolute; top: 8px; right: 12px; font-size: 20px; font-weight: normal; cursor: pointer; opacity: 0.6; line-height: 1;";
  closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
  closeBtn.onmouseout = () => closeBtn.style.opacity = '0.6';
  closeBtn.onclick = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
  };
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  void toast.offsetWidth;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(0)';
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 350); 
  }, 3000);
}

function parseDateStr(str) {
    if (!str) return 0;
    let d = new Date(str).getTime();
    if (!isNaN(d)) return d;
    d = new Date(str.replace(/\.\s*/g, '/').replace(/\/$/, '')).getTime();
    return isNaN(d) ? 0 : d;
}

function formatDisplayDate(str) {
    if (!str) return '';
    if (str.includes('T') || str.includes('-')) {
        return new Date(str).toLocaleDateString('ko-KR');
    }
    return str; 
}

function renderSites() {
  chrome.storage.local.get({ allowedSites: [] }, (data) => {
    const sites = Array.isArray(data.allowedSites) ? data.allowedSites : [];
    document.getElementById('siteList').innerHTML = sites.map(s => {
        if (typeof s === 'object') {
            let detailTxt = s.detailSelector ? s.detailSelector : '<span style="color:#aaa;">미등록</span>';
            return `<span class="site-tag">
                      <b style="font-size:13px; color:#0d6efd;">${s.url}</b> 
                      <span style="color:var(--text-muted);">상세: <code>${detailTxt}</code></span> 
                      <b style="color:red; cursor:pointer; font-size:14px; margin-left:4px;" data-site="${s.url}">×</b>
                    </span>`;
        } else {
            return `<span class="site-tag"><b>${s}</b> <b style="color:red; cursor:pointer;" data-site="${s}">×</b></span>`;
        }
    }).join('');
  });
}

function renderFilters() {
  chrome.storage.local.get({ filterWords: [] }, (data) => {
    const filters = Array.isArray(data.filterWords) ? data.filterWords : [];
    document.getElementById('filterList').innerHTML = filters.map(f => {
        return `<span class="site-tag" style="background: rgba(220,53,69,0.05); border-color: rgba(220,53,69,0.2); margin:0;">
                  <b style="font-size:13px; color:#dc3545;">${f}</b> 
                  <b style="color:#dc3545; cursor:pointer; font-size:15px; margin-left:6px; opacity:0.7;" data-filter="${f}">×</b>
                </span>`;
    }).join('');
  });
}

function renderEditionKeywords() {
    chrome.storage.local.get({ editionKeywords: getDefaultEditionKeywords() }, (data) => {
        const keywords = Array.isArray(data.editionKeywords) ? data.editionKeywords : getDefaultEditionKeywords();
        const container = document.getElementById('editionKeywordList');
        if (!container) return;

        container.innerHTML = '';
        keywords.forEach(keyword => {
            const tag = document.createElement('span');
            tag.className = 'site-tag';
            tag.style.cssText = 'background: rgba(32,201,151,0.05); border-color: rgba(32,201,151,0.25); margin:0;';

            const label = document.createElement('b');
            label.style.cssText = 'font-size:13px; color:#20c997;';
            label.textContent = keyword;

            const removeButton = document.createElement('b');
            removeButton.style.cssText = 'color:#20c997; cursor:pointer; font-size:15px; margin-left:6px; opacity:0.8;';
            removeButton.dataset.editionKeyword = keyword;
            removeButton.textContent = '×';

            tag.appendChild(label);
            tag.appendChild(removeButton);
            container.appendChild(tag);
        });
    });
}

let renderFrame;

let currentPage = 1;
const itemsPerPage = 100; // 한 페이지에 보여줄 항목 수 (100개 권장)
let totalPages = 1;
let folderRulePreview;
let activeFolderRuleInput = null;
let folderRulePreviewHideTimer;

function normalizeTitleCorrectionKeyPart(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function getStoredCorrectionTitle(value) {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';
    return String(value.correctedTitle || value.title || '').trim();
}

function ensureFolderRulePreview() {
    if (folderRulePreview) return folderRulePreview;

    folderRulePreview = document.createElement('div');
    folderRulePreview.id = 'folderRulePreview';
    folderRulePreview.className = 'folder-rule-preview-popover';
    folderRulePreview.setAttribute('role', 'tooltip');
    folderRulePreview.setAttribute('aria-hidden', 'true');
    document.body.appendChild(folderRulePreview);

    return folderRulePreview;
}

function sanitizeFolderRulePreviewSegment(value) {
    return String(value || '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getFolderRulePreviewData(folderInput) {
    if (!folderInput) {
        return {
            title: '책 제목',
            ruleSegments: ['입력한 규칙'],
            usesPlaceholder: true
        };
    }

    const row = folderInput.closest('tr');
    const rawTitle = row ? (row.querySelector('.edit-title')?.value || '').trim() : '';
    const title = sanitizeFolderRulePreviewSegment(rawTitle) || '책 제목';
    const currentFolderRule = (folderInput.value || '').trim();
    const ruleSegments = currentFolderRule
        .replace(/\\/g, '/')
        .split('/')
        .map((segment) => sanitizeFolderRulePreviewSegment(segment))
        .filter(Boolean);

    return {
        title,
        ruleSegments: currentFolderRule ? ruleSegments : ['입력한 규칙'],
        usesPlaceholder: !currentFolderRule
    };
}

function createFolderRulePreviewPath(ruleSegments, title, usesPlaceholder = false) {
    const path = document.createElement('code');
    path.className = 'folder-rule-preview-path';
    const segments = [
        ...ruleSegments.map((segment) => ({ text: segment, type: 'rule' })),
        { text: title, type: 'title' }
    ];

    segments.forEach((segment, index) => {
        if (index > 0) {
            const separator = document.createElement('span');
            separator.className = 'folder-rule-preview-separator';
            separator.textContent = '/';
            path.appendChild(separator);
        }

        const value = document.createElement('span');
        value.className = `folder-rule-preview-segment is-${segment.type}`;
        if (usesPlaceholder && segment.type === 'rule') {
            value.classList.add('is-placeholder');
        }
        value.textContent = segment.text;
        path.appendChild(value);
    });

    return path;
}

function createFolderRulePreviewCase(labelText, ruleSegments, title, options = {}) {
    const item = document.createElement('div');
    item.className = `folder-rule-preview-case ${options.className || ''}`.trim();

    const label = document.createElement('span');
    label.className = 'folder-rule-preview-label';
    label.textContent = labelText;
    item.appendChild(label);
    item.appendChild(createFolderRulePreviewPath(ruleSegments, title, options.usesPlaceholder));

    return item;
}

function updateFolderRulePreviewContent(folderInput) {
    const preview = ensureFolderRulePreview();
    const data = getFolderRulePreviewData(folderInput);

    const heading = document.createElement('div');
    heading.className = 'folder-rule-preview-heading';
    heading.textContent = '저장 후 다운로드 폴더 예시';

    const examples = document.createElement('div');
    examples.className = 'folder-rule-preview-examples';
    examples.appendChild(createFolderRulePreviewCase(
        '규칙 입력',
        data.ruleSegments,
        data.title,
        { className: 'has-rule', usesPlaceholder: data.usesPlaceholder }
    ));
    examples.appendChild(createFolderRulePreviewCase(
        '규칙 미입력',
        [],
        data.title,
        { className: 'has-no-rule' }
    ));

    const guide = document.createElement('div');
    guide.className = 'folder-rule-preview-guide';

    const guideLabel = document.createElement('span');
    guideLabel.className = 'folder-rule-preview-guide-label';
    guideLabel.textContent = '여러 단계 예시';

    const guideInput = document.createElement('code');
    guideInput.textContent = '장르/작가';

    const guideArrow = document.createElement('span');
    guideArrow.className = 'folder-rule-preview-guide-arrow';
    guideArrow.textContent = '→';

    const guideResult = document.createElement('code');
    guideResult.textContent = '장르/작가/책 제목';

    guide.append(guideLabel, guideInput, guideArrow, guideResult);
    preview.replaceChildren(heading, examples, guide);
}

function updateFolderRulePreviewPosition(folderInput) {
    if (!folderInput || !folderInput.isConnected) return false;

    const preview = ensureFolderRulePreview();
    const inputRect = folderInput.getBoundingClientRect();

    preview.style.display = 'block';
    const previewRect = preview.getBoundingClientRect();
    const viewportTop = window.scrollY + 8;
    const viewportBottom = window.scrollY + window.innerHeight - 8;
    const roomBelow = window.innerHeight - inputRect.bottom;
    const roomAbove = inputRect.top;
    const placeAbove = roomBelow < previewRect.height + 12 && roomAbove > roomBelow;
    const preferredTop = placeAbove
        ? inputRect.top + window.scrollY - previewRect.height - 10
        : inputRect.bottom + window.scrollY + 10;

    let top = preferredTop;
    let left = inputRect.left + window.scrollX + (inputRect.width / 2) - (previewRect.width / 2);

    top = Math.max(viewportTop, Math.min(viewportBottom - previewRect.height, top));
    left = Math.max(window.scrollX + 8, Math.min(window.scrollX + window.innerWidth - previewRect.width - 8, left));

    const arrowLeft = Math.max(
        10,
        Math.min(previewRect.width - 20, inputRect.left + window.scrollX + (inputRect.width / 2) - left - 8)
    );

    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    preview.style.setProperty('--folder-rule-arrow-x', `${arrowLeft}px`);
    preview.classList.toggle('is-above', placeAbove);

    return true;
}

function showFolderRulePreview(folderInput) {
    if (!folderInput || !(folderInput instanceof HTMLInputElement) || !folderInput.isConnected) return;
    const preview = ensureFolderRulePreview();
    const wasOpen = preview.classList.contains('open');

    if (folderRulePreviewHideTimer) {
        clearTimeout(folderRulePreviewHideTimer);
        folderRulePreviewHideTimer = null;
    }

    updateFolderRulePreviewContent(folderInput);
    if (!updateFolderRulePreviewPosition(folderInput)) return;

    activeFolderRuleInput = folderInput;
    const descriptionIds = new Set(
        (folderInput.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
    );
    descriptionIds.add(preview.id);
    folderInput.setAttribute('aria-describedby', [...descriptionIds].join(' '));
    preview.setAttribute('aria-hidden', 'false');
    if (!wasOpen) {
        preview.classList.add('open');
    }
}

function hideFolderRulePreview() {
    const describedInput = activeFolderRuleInput;
    activeFolderRuleInput = null;
    if (describedInput) {
        const descriptionIds = (describedInput.getAttribute('aria-describedby') || '')
            .split(/\s+/)
            .filter((id) => id && id !== 'folderRulePreview');
        if (descriptionIds.length > 0) {
            describedInput.setAttribute('aria-describedby', descriptionIds.join(' '));
        } else {
            describedInput.removeAttribute('aria-describedby');
        }
    }
    if (!folderRulePreview) return;

    folderRulePreview.classList.remove('open');
    folderRulePreview.setAttribute('aria-hidden', 'true');
    if (folderRulePreviewHideTimer) {
        clearTimeout(folderRulePreviewHideTimer);
    }
    folderRulePreviewHideTimer = setTimeout(() => {
        if (!folderRulePreview.classList.contains('open') && !activeFolderRuleInput) {
            folderRulePreview.style.display = 'none';
        }
        folderRulePreviewHideTimer = null;
    }, 180);
}

function renderList(filter = "", resetPage = false) {
  if (resetPage) currentPage = 1; // 검색/정렬 시 페이지 1로 리셋

  chrome.storage.local.get({ bookList: [], missingVolsMap: {}, sortOption: 'id_desc' }, (data) => {
    listBody.innerHTML = '';
    hideFolderRulePreview();
    
    let list = Array.isArray(data.bookList) ? data.bookList : [];
    
    const completeCount = list.filter(b => b.type === 'complete').length;
    const incompleteCount = list.filter(b => b.type === 'incomplete').length;
    const excludeCount = list.filter(b => b.type === 'exclude').length;
    
    document.getElementById('stat-total').innerText = list.length;
    document.getElementById('stat-complete').innerText = completeCount;
    document.getElementById('stat-incomplete').innerText = incompleteCount;
    document.getElementById('stat-exclude').innerText = excludeCount;

    const folderRulePrefix = "#폴더규칙";
    const isDuplicateSearch = filter === "#중복";
    const isMissingSearch = filter === "#누락";
    const isFolderRuleSearch = filter === folderRulePrefix || filter.startsWith(folderRulePrefix + ":");
    const folderRuleKeyword = isFolderRuleSearch ? filter.slice(folderRulePrefix.length).replace(/^[:\s]*/, '').trim() : '';
    let duplicateIds = new Set();
    
    if (isDuplicateSearch) {
        const titleMap = new Map();
        list.forEach(b => {
            if (!b || !b.title) return;
            const normalized = getTitleMatchParts(b.title).matchKey;
            if (normalized.length === 0) return;
            if (titleMap.has(normalized)) {
                titleMap.get(normalized).push(b.id);
            } else {
                titleMap.set(normalized, [b.id]);
            }
        });
        
        titleMap.forEach(ids => {
            if (ids.length > 1) ids.forEach(id => duplicateIds.add(id));
        });
    }

    // 필터링 적용
    const normalizedFilter = filter.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim().replace(/\s+/g, '');
    const normalizedFolderRuleKeyword = isFolderRuleSearch ? folderRuleKeyword.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim().replace(/\s+/g, '') : '';
    const filteredList = list.filter(b => {
        if (!b || !b.title) return false;
        if (isDuplicateSearch) return duplicateIds.has(b.id);
        if (isMissingSearch) return getBookMissingVols(b, data.missingVolsMap).length > 0;
        if (isFolderRuleSearch) {
            const folderRule = (b.folderRule || '').trim();
            if (!folderRule) return false;
            if (!folderRuleKeyword) return true;
            if (folderRule.toLowerCase().includes(folderRuleKeyword.toLowerCase())) return true;
            const normalizedFolderRule = folderRule.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim().replace(/\s+/g, '');
            return normalizedFolderRule.includes(normalizedFolderRuleKeyword);
        }
        if (b.title.toLowerCase().includes(filter.toLowerCase())) return true;
        if (normalizedFilter) {
            const normalizedTitle = b.title.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim().replace(/\s+/g, '');
            return normalizedTitle.includes(normalizedFilter);
        }
        return false;
    });
    
    // 전체 페이지 계산 및 현재 페이지 보정
    totalPages = Math.ceil(filteredList.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const countDisplay = document.getElementById('listCountDisplay');
    if (countDisplay) {
        if (isDuplicateSearch) {
            countDisplay.innerHTML = `중복 의심 목록: 총 <span style="color:#fd7e14;">${filteredList.length}</span>건 (공백/기호 무시 시 동일한 항목 묶음)`;
        } else if (isMissingSearch) {
            countDisplay.innerHTML = `누락 권수 등록 목록: 총 <span style="color:#e83e8c;">${filteredList.length}</span>건 (누락 권수가 하나 이상인 도서)`;
        } else if (isFolderRuleSearch) {
            const keywordText = folderRuleKeyword ? `"${folderRuleKeyword}"(이)` : '등록된';
            countDisplay.innerHTML = `상위 폴더 규칙 ${keywordText}인 목록: 총 <span style="color:#20c997;">${filteredList.length}</span>건`;
        } else if (filter.trim() === "") {
            countDisplay.innerHTML = `전체 목록: 총 <span style="color:#0d6efd;">${filteredList.length}</span>건 (현재 <b style="color:var(--text);">${currentPage} / ${totalPages}</b> 페이지)`;
        } else {
            countDisplay.innerHTML = `검색 결과: 총 <span style="color:#e83e8c;">${filteredList.length}</span>건 (현재 <b style="color:var(--text);">${currentPage} / ${totalPages}</b> 페이지)`;
        }
    }

    // 정렬 로직 적용
    let sortFn;
    switch(data.sortOption) {
        case 'title_asc': sortFn = (a, b) => (a.title || '').localeCompare(b.title || ''); break;
        case 'title_desc': sortFn = (a, b) => (b.title || '').localeCompare(a.title || ''); break;
        case 'date_asc': sortFn = (a, b) => (parseDateStr(a.date) - parseDateStr(b.date)) || ((a.id || 0) - (b.id || 0)); break;
        case 'date_desc': sortFn = (a, b) => (parseDateStr(b.date) - parseDateStr(a.date)) || ((b.id || 0) - (a.id || 0)); break;
        case 'id_asc': sortFn = (a, b) => (a.id || 0) - (b.id || 0); break;
        case 'id_desc': 
        default: sortFn = (a, b) => (b.id || 0) - (a.id || 0); break;
    }
    
    if (isDuplicateSearch) {
        filteredList.sort((a, b) => {
            const normA = getTitleMatchParts(a.title || '').matchKey;
            const normB = getTitleMatchParts(b.title || '').matchKey;
            if (normA < normB) return -1;
            if (normA > normB) return 1;
            return sortFn(a, b);
        });
    } else {
        filteredList.sort(sortFn);
    }

    // 데이터 자르기 (Slice)
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredList.length);
    const pageItems = filteredList.slice(startIndex, endIndex);

    // 화면에 그리기
    const fragment = document.createDocumentFragment();
    let prevNorm = null;

    pageItems.forEach(book => {
        const displayMissingVols = getBookMissingVols(book, data.missingVolsMap);
        if (isDuplicateSearch) {
            const normTitle = getTitleMatchParts(book.title || '').matchKey;
            if (normTitle !== prevNorm) {
                prevNorm = normTitle;
                const groupTr = document.createElement('tr');
                groupTr.className = 'group-header-tr';
                groupTr.innerHTML = `<td colspan="7" style="text-align: left; padding: 6px 12px; font-weight: bold; font-size: 12px; background-color: rgba(127, 127, 127, 0.1); color: var(--text); border-bottom: 2px solid #fd7e14; border-top: 2px solid var(--border);">📦 동일 항목 그룹: <span style="color:#fd7e14;">${normTitle}</span></td>`;
                fragment.appendChild(groupTr);
            }
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <select class="edit-type" data-id="${book.id}" data-type="${book.type}" style="padding: 4px;">
              <option value="exclude" ${book.type==='exclude'?'selected':''}>제외</option>
              <option value="incomplete" ${book.type==='incomplete'?'selected':''}>미완</option>
              <option value="complete" ${book.type==='complete'?'selected':''}>완결</option>
            </select>
          </td>
          <td>
            <div class="title-correction-editor">
              <input type="text" class="edit-title" value="${book.title}" data-id="${book.id}">
              <button type="button" class="btn-title-correction-bulk" data-id="${book.id}">제목정정</button>
            </div>
          </td>
          <td>
            <div class="folder-rule-editor">
              <input type="text" class="edit-folder-rule" value="${book.folderRule || ''}" data-id="${book.id}" placeholder="상위 폴더 규칙">
              <button type="button" class="btn-folder-rule-bulk" data-id="${book.id}">일괄 수정</button>
            </div>
          </td>
          <td><input type="text" class="edit-res" value="${book.resolution||''}" data-id="${book.id}" placeholder="해상도" style="width:100%"></td>
          
          <td style="position:relative; vertical-align:middle; padding:0;">
            <div style="display:flex; align-items:center; justify-content:center; gap:4px; width:100%; height:100%;">
              <input type="text" class="edit-vol" value="${book.lastVol||''}" data-id="${book.id}" placeholder="권수" style="width:100%; min-width:52px; margin:0; padding:4px;">
              ${displayMissingVols.length > 0
                  ? `<span class="missing-badge" style="flex-shrink:0; padding:2px 4px;" data-id="${book.id}">${displayMissingVols.length}누락</span>`
                  : `<span class="missing-badge empty" style="flex-shrink:0; padding:2px 4px;" data-id="${book.id}">+누락</span>`}
            </div>
          </td>
          
          <td style="color:var(--text-muted); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${formatDisplayDate(book.date)}</td>
          <td>
              <button class="btn-save" data-id="${book.id}">수정</button>
              <button class="btn-del" data-id="${book.id}">삭제</button>
          </td>
        `;
        fragment.appendChild(tr);
    });
    
    listBody.appendChild(fragment);
    
    // 페이지네이션 버튼 렌더링 호출
    renderPagination();
  });
}

// 하단 페이지네이션 버튼 생성 로직
function renderPagination() {
    const container = document.getElementById('paginationContainer');
    if (!container) return;
    container.innerHTML = '';

    if (totalPages <= 1) return;

    const createBtn = (text, targetPage, disabled = false, active = false) => {
        const btn = document.createElement('button');
        btn.className = 'page-btn' + (active ? ' active' : '');
        btn.innerHTML = text;
        btn.disabled = disabled;
        
        if (!disabled && !active) {
            btn.onclick = () => {
                currentPage = targetPage;
                renderList(document.getElementById('searchInput').value, false);
                window.scrollTo({ top: 0, behavior: 'smooth' }); // 페이지 이동 시 맨 위로
            };
        }
        return btn;
    };

    // 처음, 이전 버튼
    container.appendChild(createBtn('«', 1, currentPage === 1));
    container.appendChild(createBtn('‹', currentPage - 1, currentPage === 1));

    // 페이지 숫자 목록 (현재 페이지 기준으로 +- 2개씩 표시, 최대 5개)
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    for (let i = startPage; i <= endPage; i++) {
        container.appendChild(createBtn(i, i, false, i === currentPage));
    }

    // 다음, 마지막 버튼
    container.appendChild(createBtn('›', currentPage + 1, currentPage === totalPages));
    container.appendChild(createBtn('»', totalPages, currentPage === totalPages));
}

function saveWithUndo(newList, successMsg, additionalValues = {}) {
    chrome.storage.local.get({ bookList: [], titleCorrections: {} }, (data) => {
        chrome.storage.local.set({ backupList: data.bookList, backupTitleCorrections: data.titleCorrections }, () => {
            chrome.storage.local.set({ bookList: newList, ...additionalValues }, () => {
                if (successMsg) showInfoToast(successMsg);
                // 수정/삭제 후 현재 페이지 유지 (false 전달)
                renderList(document.getElementById('searchInput').value, false); 
                
                const undoBtn = document.getElementById('undoBtn');
                undoBtn.style.display = 'block';
                setTimeout(() => { undoBtn.style.display = 'none'; }, 15000);
            });
        });
    });
}

document.getElementById('undoBtn').onclick = () => {
    chrome.storage.local.get({ backupList: null, backupTitleCorrections: {} }, (data) => {
        if (data.backupList) {
            chrome.storage.local.set({ bookList: data.backupList, titleCorrections: data.backupTitleCorrections }, () => {
                showInfoToast('⏪ 방금 전 작업이 완벽하게 취소(복구)되었습니다.');
                renderList(document.getElementById('searchInput').value, false);
                document.getElementById('undoBtn').style.display = 'none';
            });
        }
    });
};

document.getElementById('batchUpdateBtn').onclick = () => {
    const targetType = document.getElementById('batchTypeSelect').value;
    const filter = document.getElementById('searchInput').value.toLowerCase();
    const normalizedFilter = filter.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').trim().replace(/\s+/g, '');
    
    let typeNameKOR = targetType === 'exclude' ? '제외' : (targetType === 'complete' ? '완결' : '미완');
    if(!confirm(`현재 검색된 모든 항목을 [${typeNameKOR}] 타입으로 변경하시겠습니까?`)) return;

    chrome.storage.local.get({ bookList: [], missingVolsMap: {} }, (data) => {
        let list = Array.isArray(data.bookList) ? data.bookList : [];
        const today = new Date().toISOString(); 
        const isDuplicateSearch = filter === '#중복';
        const isMissingSearch = filter === '#누락';
        const folderRulePrefix = "#폴더규칙";
        const isFolderRuleSearch = filter === folderRulePrefix || filter.startsWith(folderRulePrefix + ":");
        const folderRuleKeyword = isFolderRuleSearch ? filter.slice(folderRulePrefix.length).replace(/^[:\s]*/, '').trim() : '';
        const normalizedFolderRuleKeyword = isFolderRuleSearch ? folderRuleKeyword.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim().replace(/\s+/g, '') : '';
        const duplicateTitleCounts = new Map();

        if (isDuplicateSearch) {
            list.forEach(book => {
                if (!book || !book.title) return;
                const matchKey = getTitleMatchParts(book.title).matchKey;
                duplicateTitleCounts.set(matchKey, (duplicateTitleCounts.get(matchKey) || 0) + 1);
            });
        }

        const updatedList = list.map(book => {
            if (book && book.title) {
                if (isDuplicateSearch) {
                    const matchKey = getTitleMatchParts(book.title).matchKey;
                    if ((duplicateTitleCounts.get(matchKey) || 0) > 1) {
                        return { ...book, type: targetType, date: today };
                    }
                    return book;
                }
                if (isMissingSearch) {
                    if (getBookMissingVols(book, data.missingVolsMap).length > 0) {
                        return { ...book, type: targetType, date: today };
                    }
                    return book;
                }
                if (isFolderRuleSearch) {
                    const folderRule = (book.folderRule || '').trim();
                    if (!folderRule) return book;
                    if (!folderRuleKeyword) return { ...book, type: targetType, date: today };
                    if (folderRule.toLowerCase().includes(folderRuleKeyword.toLowerCase())) {
                        return { ...book, type: targetType, date: today };
                    }
                    const normalizedFolderRule = folderRule.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim().replace(/\s+/g, '');
                    if (normalizedFolderRule.includes(normalizedFolderRuleKeyword)) {
                        return { ...book, type: targetType, date: today };
                    }
                    return book;
                }

                const lowerTitle = book.title.toLowerCase();
                const matchOriginal = lowerTitle.includes(filter);
                let matchNormalized = false;
                if (!matchOriginal && normalizedFilter) {
                    const normalizedTitle = lowerTitle.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').trim().replace(/\s+/g, '');
                    matchNormalized = normalizedTitle.includes(normalizedFilter);
                }
                if (matchOriginal || matchNormalized) {
                    return { ...book, type: targetType, date: today };
                }
            }
            return book;
        });

        saveWithUndo(updatedList, '일괄 수정이 완료되었습니다.');
    });
};

// ============================================================================
// [수정됨] 백업 (내보내기) 로직: 도서 목록 + 사이트 설정 + 금지어 설정 모두 포함
// ============================================================================
document.getElementById('exportBtn').onclick = () => {
    chrome.storage.local.get({ bookList: [], missingVolsMap: {}, allowedSites: [], filterWords: [], editionKeywords: getDefaultEditionKeywords() }, (data) => {
        // 객체(Object) 형태로 데이터를 묶어서 백업
        const exportData = {
            bookList: data.bookList,
            missingVolsMap: data.missingVolsMap,
            allowedSites: data.allowedSites,
            filterWords: data.filterWords,
            editionKeywords: data.editionKeywords
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'book_manager_backup.json'; 
        a.click();
        URL.revokeObjectURL(url);

        const now = new Date();
        const backupTime = now.toLocaleString('ko-KR'); 
        chrome.storage.local.set({ lastBackup: backupTime }, () => {
            const timeSpan = document.getElementById('lastBackupTime');
            if(timeSpan) timeSpan.innerText = `최근 백업: ${backupTime}`;
        });
    });
};

document.getElementById('importBtn').onclick = () => document.getElementById('fileInput').click();

// ============================================================================
// [수정됨] 복구 (불러오기) 로직: 신규 포맷 및 구버전 포맷(하위 호환) 완벽 지원
// ============================================================================
document.getElementById('fileInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm('경고: 파일의 데이터가 기존 데이터를 완전히 덮어씁니다. 계속하시겠습니까?\n(오류 시 우측 하단의 실행 취소 버튼으로 되돌릴 수 있습니다)')) {
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedData = JSON.parse(event.target.result);
            
            // 1. 신규 포맷 검사 (객체 형태: 도서 목록 + 사이트 설정 + 금지어)
            if (importedData && typeof importedData === 'object' && !Array.isArray(importedData)) {
                let hasSettings = false;
                
                // 사이트 설정이 존재하면 복구 및 화면 갱신
                if (Array.isArray(importedData.allowedSites)) {
                    chrome.storage.local.set({ allowedSites: importedData.allowedSites }, renderSites);
                    hasSettings = true;
                }
                
                // 필터(금지어) 설정이 존재하면 복구 및 화면 갱신
                if (Array.isArray(importedData.filterWords)) {
                    chrome.storage.local.set({ filterWords: importedData.filterWords }, renderFilters);
                    hasSettings = true;
                }

                if (Array.isArray(importedData.editionKeywords)) {
                    chrome.storage.local.set({ editionKeywords: importedData.editionKeywords }, renderEditionKeywords);
                    hasSettings = true;
                }

                if (importedData.missingVolsMap && typeof importedData.missingVolsMap === 'object' && !Array.isArray(importedData.missingVolsMap)) {
                    chrome.storage.local.set({ missingVolsMap: importedData.missingVolsMap });
                    hasSettings = true;
                }

                // 도서 목록이 존재하면 복구 (기존 saveWithUndo 재활용하여 취소 기능 유지)
                if (Array.isArray(importedData.bookList)) {
                    saveWithUndo(importedData.bookList, '✅ 도서 목록 및 추가 설정 복구가 완료되었습니다.');
                } else if (hasSettings) {
                    showInfoToast('✅ 추가 설정(사이트/금지어) 복구가 완료되었습니다.');
                } else {
                    showInfoToast('❌ 유효한 백업 데이터가 없습니다.', true);
                }
            } 
            // 2. 구버전 포맷 검사 (배열 형태: 과거에 도서 목록만 백업했던 파일)
            else if (Array.isArray(importedData)) {
                saveWithUndo(importedData, '✅ 도서 목록 복구가 완료되었습니다. (구버전 백업 파일 호환 적용)');
            } 
            else {
                showInfoToast('❌ 올바른 백업 파일 형식이 아닙니다.', true);
            }
        } catch (err) {
            showInfoToast('❌ 파일을 읽는 중 오류가 발생했습니다. (JSON 파싱 에러)', true);
        }
        e.target.value = '';
    };
    reader.readAsText(file);
};

// ============================================================================
// [신규 추가] 타임머신 스냅샷 렌더링 및 복원 로직
// ============================================================================
async function renderSnapshots() {
    const container = document.getElementById('snapshotList');
    if (!container) return;
    try {
        const snapshots = await db.snapshots.orderBy('timestamp').reverse().toArray();
        if (snapshots.length === 0) {
            container.innerHTML = '<li style="font-size: 13px; color: var(--text-muted);">저장된 스냅샷이 없습니다. (자동 백업은 1일 뒤부터 생성됩니다)</li>';
            return;
        }
        container.innerHTML = snapshots.map(snap => {
            const date = new Date(snap.timestamp);
            const displayTime = `${date.getFullYear()}년 ${date.getMonth()+1}월 ${date.getDate()}일 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
            const bookCount = snap.data && snap.data.bookList ? snap.data.bookList.length : 0;
            return `
                <li style="display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); border:1px solid var(--border); padding:10px 15px; border-radius:6px;">
                    <div>
                        <strong style="color:var(--text); font-size:13px;">📅 ${snap.dateStr} 자동 백업</strong><br>
                        <span style="color:var(--text-muted); font-size:11px;">저장 시간: ${displayTime} | 도서 데이터: ${bookCount}건</span>
                    </div>
                    <button class="btn-restore-snap" data-id="${snap.id}" style="background:#fd7e14; padding:5px 12px; font-size:12px; border:none;">이 시점으로 복원</button>
                </li>`;
        }).join('');
        
        document.querySelectorAll('.btn-restore-snap').forEach(btn => {
            btn.onclick = async (e) => {
                const id = parseInt(e.target.dataset.id, 10);
                if (confirm('정말로 이 시점의 데이터로 되돌리시겠습니까?\n현재 저장된 모든 데이터는 해당 시점의 데이터로 덮어씌워집니다.')) {
                    const snap = await db.snapshots.get(id);
                    if (snap && snap.data) {
                        let hasSettings = false;
                        if (Array.isArray(snap.data.allowedSites)) { chrome.storage.local.set({ allowedSites: snap.data.allowedSites }, renderSites); hasSettings = true; }
                        if (Array.isArray(snap.data.filterWords)) { chrome.storage.local.set({ filterWords: snap.data.filterWords }, renderFilters); hasSettings = true; }
                        if (Array.isArray(snap.data.editionKeywords)) { chrome.storage.local.set({ editionKeywords: snap.data.editionKeywords }, renderEditionKeywords); hasSettings = true; }
                        if (snap.data.missingVolsMap && typeof snap.data.missingVolsMap === 'object') { chrome.storage.local.set({ missingVolsMap: snap.data.missingVolsMap }); hasSettings = true; }
                        if (Array.isArray(snap.data.bookList)) { saveWithUndo(snap.data.bookList, '✅ 선택한 시점으로 복원이 완료되었습니다.'); } 
                        else if (hasSettings) { showInfoToast('✅ 추가 설정(사이트/금지어) 복구가 완료되었습니다.'); } 
                    }
                }
            };
        });
    } catch (err) {
        container.innerHTML = '<li style="font-size: 13px; color: #dc3545;">스냅샷을 불러오는 데 실패했습니다.</li>';
    }
}

const bulkInput = document.getElementById('bulkInput');
const bulkPreview = document.getElementById('bulkPreview');

bulkInput.addEventListener('input', () => {
    const lines = bulkInput.value.split('\n').filter(t => t.trim());
    if (lines.length === 0) { 
        bulkPreview.style.display = 'none'; 
        return; 
    }
    
    bulkPreview.style.display = 'block';
    const line = lines[0]; 
    
    const resMatch = line.match(/\d{3,4}\s*px/gi);
    const rangeMatch = line.match(/(\d+)\s*(?:권|화|부(?!터))?\s*[~\-ㅡ]\s*(\d+)(?!\d|\s*(?:px|p)\b)/i);
    const singleMatch = line.match(/(\d+)\s*(?:권|완결|화|부(?!터))/);
    const endNumMatch = line.match(/(\d+)\s*$/);
    
    let parsedVol = "";
    if (rangeMatch) parsedVol = parseInt(rangeMatch[2], 10).toString();
    else if (singleMatch) parsedVol = parseInt(singleMatch[1], 10).toString();
    else if (endNumMatch) parsedVol = parseInt(endNumMatch[1], 10).toString();
    
    let cleanTitle = cleanSiteTitle(line)
      .replace(/\d+\s*권/g, '')
      .replace(/완결/g, '')
      .replace(/개$/g, '')
      .replace(/(\d+)?완/g, '')
      .replace(/\s?완$/g, '')
      .replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let extras = lines.length > 1 ? `<span style="color:var(--text-muted); float:right;">(+ 외 ${lines.length - 1}건)</span>` : '';
    
    bulkPreview.innerHTML = `
        <span style="display:inline-block; margin-bottom:5px;"><b>👀 첫 번째 줄 파싱 결과</b> ${extras}</span><br>
        📚 제목: <span style="color:#0d6efd; font-weight:bold;">${cleanTitle || '(없음)'}</span> | 
        📑 권수: <span style="color:#e83e8c; font-weight:bold;">${parsedVol || '(없음)'}</span> | 
        📺 해상도: <span style="color:#20c997; font-weight:bold;">${resMatch ? Array.from(new Set(resMatch)).join(',') : '(없음)'}</span>
    `;
});

document.getElementById('saveBtn').onclick = () => {
  const lines = document.getElementById('bulkInput').value.split('\n').filter(t => t.trim());
  const selectedTypeSelect = document.getElementById('bulkTypeSelect');
  const targetType = selectedTypeSelect ? selectedTypeSelect.value : 'exclude';
  
  // 데이터가 많을 경우 브라우저 멈춤을 방지하기 위해 로딩 상태 표시
  const btn = document.getElementById('saveBtn');
  const originalBtnText = btn.innerText;
  btn.innerText = "⏳ 처리 중... (잠시만 기다려주세요)";
  btn.style.pointerEvents = 'none';

  chrome.storage.local.set({ lastBulkType: targetType });

  // UI 텍스트가 바뀔 틈을 주기 위해 setTimeout으로 비동기 실행
  setTimeout(() => {
    chrome.storage.local.get({ bookList: [] }, (data) => {
      let currentList = Array.isArray(data.bookList) ? data.bookList : [];
      let skippedCount = 0;

      // [최적화 1] 검색 속도 무한대 향상 (O(N) -> O(1))
      // 매번 findIndex로 찾지 않도록 기존 목록을 Map(사전) 형태로 미리 만들어 둡니다.
      const titleMap = new Map();
      currentList.forEach((book, idx) => {
          if (book && book.title) {
              const normalized = getTitleMatchParts(book.title).matchKey;
              titleMap.set(normalized, idx); // 제목을 키(Key)로, 인덱스를 값(Value)으로 저장
          }
      });

      // [최적화 2] unshift 연산 제거
      // 매번 배열을 뒤로 미는 대신, 임시 배열에 일단 차곡차곡 쌓습니다(push).
      const newBooks = [];

      lines.forEach(line => {
        const resMatch = line.match(/\d{3,4}\s*px/gi);
        
        // 이전에 수정한 부(?!터) 정규식 그대로 유지
        const rangeMatch = line.match(/(\d+)\s*(?:권|화|부(?!터))?\s*[~\-ㅡ]\s*(\d+)(?!\d|\s*(?:px|p)\b)/i);
        const singleMatch = line.match(/(\d+)\s*(?:권|완결|화|부(?!터))/);
        const endNumMatch = line.match(/(\d+)\s*$/);
        
        let parsedVol = "";
        if (rangeMatch) parsedVol = parseInt(rangeMatch[2], 10).toString();
        else if (singleMatch) parsedVol = parseInt(singleMatch[1], 10).toString();
        else if (endNumMatch) parsedVol = parseInt(endNumMatch[1], 10).toString();
        
        let cleanTitle = cleanSiteTitle(line)
          .replace(/\d+\s*권/g, '')
          .replace(/완결/g, '')
          .replace(/개$/g, '')
          .replace(/(\d+)?완/g, '')
          .replace(/\s?완$/g, '')
          .replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥()]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (!cleanTitle) {
            skippedCount++;
            return; 
        }

        const normalizedNewTitle = getTitleMatchParts(cleanTitle).matchKey;
        
        const bookData = { 
          type: targetType,
          title: cleanTitle, 
          folderRule: "",
          resolution: resMatch ? Array.from(new Set(resMatch)).join(',') : "", 
          lastVol: parsedVol, 
          date: new Date().toISOString(), 
          id: Date.now() + Math.random() 
        };

        // [최적화 1 적용] Map에서 즉시(0.0001초) 찾아냅니다.
        if (titleMap.has(normalizedNewTitle)) {
            const existingIdx = titleMap.get(normalizedNewTitle);
            currentList[existingIdx] = { ...currentList[existingIdx], ...bookData };
        } else {
            // [최적화 2 적용] 무거운 unshift 대신 가벼운 push 사용
            newBooks.push(bookData);
            // 6만 건의 새 데이터 안에서 중복이 발생할 수도 있으니 Map에도 등록
            titleMap.set(normalizedNewTitle, -1); 
        }
      });

      // [최적화 3] 마지막에 배열 합치기
      // 기존 unshift처럼 최신 항목이 위로 오게 하려면, 새 책들을 뒤집은(reverse) 후 기존 목록 앞에 붙이면 됩니다.
      currentList = [...newBooks.reverse(), ...currentList];

      let typeNameKOR = targetType === 'exclude' ? '제외' : (targetType === 'complete' ? '완결' : '미완');
      let alertMsg = `✅ [${typeNameKOR}] 타입으로 일괄 저장이 완료되었습니다.`;
      if (skippedCount > 0) alertMsg += `\n(단, 제목을 식별할 수 없는 ${skippedCount}개의 항목은 제외됨)`;

      saveWithUndo(currentList, alertMsg);
      
      document.getElementById('bulkInput').value = ''; 
      const bulkPreview = document.getElementById('bulkPreview');
      if (bulkPreview) bulkPreview.style.display = 'none';

      // 버튼 상태 원상복구
      btn.innerText = originalBtnText;
      btn.style.pointerEvents = 'auto';
    });
  }, 50); // 렌더링에 50ms 양보
};

document.body.onclick = (e) => {
  const id = parseFloat(e.target.dataset.id);
  const site = e.target.dataset.site;
  const filterWord = e.target.dataset.filter; 
  const editionKeyword = e.target.dataset.editionKeyword;

  if (id && e.target.classList.contains('btn-del')) {
    chrome.storage.local.get({ bookList: [] }, (data) => {
      const list = Array.isArray(data.bookList) ? data.bookList : [];
      saveWithUndo(list.filter(b => b.id !== id), null);
    });
  } else if (id && e.target.classList.contains('btn-save')) {
    chrome.storage.local.get({ bookList: [] }, (data) => {
      const list = Array.isArray(data.bookList) ? data.bookList : [];
      const idx = list.findIndex(b => b.id === id);
      const row = e.target.closest('tr');
      if (idx > -1) {
        const newTitle = row.querySelector('.edit-title').value.trim();
        if (!newTitle) { showInfoToast('❌ 제목은 비워둘 수 없습니다!', true); return; }

        list[idx] = { 
            ...list[idx], 
            type: row.querySelector('.edit-type').value, 
            title: newTitle, 
            resolution: row.querySelector('.edit-res').value.trim(), 
            lastVol: row.querySelector('.edit-vol').value.trim(),
            folderRule: row.querySelector('.edit-folder-rule').value.trim(),
            date: new Date().toISOString() 
        };
        saveWithUndo(list, '✅ 수정이 완료되었습니다.');
      }
    });
  } else if (id && e.target.classList.contains('btn-title-correction-bulk')) {
    chrome.storage.local.get({ bookList: [], titleCorrections: {} }, (data) => {
        const list = Array.isArray(data.bookList) ? data.bookList : [];
        const baseIndex = list.findIndex(b => b.id === id);
        if (baseIndex < 0) return;

        const row = e.target.closest('tr');
        if (!row) return;

        const nextTitle = (row.querySelector('.edit-title')?.value || '').trim();
        const baseTitle = String(list[baseIndex].title || '').trim();
        if (!nextTitle) {
            showInfoToast('❌ 제목은 비워둘 수 없습니다!', true);
            return;
        }
        if (baseTitle === nextTitle) {
            showInfoToast('⚠️ 변경값이 동일해 제목을 정정할 대상이 없습니다.');
            return;
        }

        const targetCount = list.filter(book => String(book.title || '').trim() === baseTitle).length;
        if (targetCount <= 0) return;
        if (!confirm(`"${baseTitle}" 제목으로 등록된 ${targetCount}건을 "${nextTitle}"(으)로 정정할까요?`)) return;

        const now = new Date().toISOString();
        const updatedList = list.map(book => {
            if (String(book.title || '').trim() !== baseTitle) return book;
            return { ...book, title: nextTitle, date: now };
        });
        const nextCorrections = { ...(data.titleCorrections || {}) };
        Object.keys(nextCorrections).forEach(key => {
            if (getStoredCorrectionTitle(nextCorrections[key]) === baseTitle) {
                nextCorrections[key] = typeof nextCorrections[key] === 'object'
                    ? { ...nextCorrections[key], correctedTitle: nextTitle, editionKey: getTitleMatchParts(nextTitle).editionKey }
                    : nextTitle;
            }
        });
        const globalCorrectionKey = `*::${normalizeTitleCorrectionKeyPart(baseTitle)}`;
        nextCorrections[globalCorrectionKey] = {
            correctedTitle: nextTitle,
            bookId: list[baseIndex].id,
            editionKey: getTitleMatchParts(nextTitle).editionKey
        };

        saveWithUndo(
            updatedList,
            `✅ ${targetCount}건의 도서 제목을 "${nextTitle}"(으)로 정정했습니다.`,
            { titleCorrections: nextCorrections }
        );
    });
  } else if (id && e.target.classList.contains('btn-folder-rule-bulk')) {
    chrome.storage.local.get({ bookList: [] }, (data) => {
        const list = Array.isArray(data.bookList) ? data.bookList : [];
        const baseIndex = list.findIndex(b => b.id === id);
        if (baseIndex < 0) return;

        const row = e.target.closest('tr');
        if (!row) return;

        const nextRule = (row.querySelector('.edit-folder-rule')?.value || '').trim();
        const baseRule = String(list[baseIndex].folderRule || '').trim();

        if (baseRule === nextRule) {
          showInfoToast('⚠️ 변경값이 동일해 일괄 수정할 대상이 없습니다.');
          return;
        }

        const targetCount = list.filter(book => String(book.folderRule || '').trim() === baseRule).length;
        if (targetCount <= 0) return;

        const targetLabel = baseRule || '(미설정)';
        const changedLabel = nextRule || '(비움)';
        if (!confirm(`"[${targetLabel}]" 규칙으로 등록된 ${targetCount}건을 "${changedLabel}"(으)로 일괄 수정할까요?`)) return;

        const now = new Date().toISOString();
        const updatedList = list.map(book => {
          const currentRule = String(book.folderRule || '').trim();
          if (currentRule !== baseRule) return book;
          return { ...book, folderRule: nextRule, date: now };
        });
        saveWithUndo(updatedList, `✅ 규칙 "${changedLabel}"(으)로 ${targetCount}건의 상위 폴더 규칙을 일괄 수정했습니다.`);
    });
  } else if (site) {
    chrome.storage.local.get({ allowedSites: [] }, (data) => {
      const sites = Array.isArray(data.allowedSites) ? data.allowedSites : [];
      const newSites = sites.filter(s => {
          const sUrl = typeof s === 'string' ? s : s.url;
          return sUrl !== site;
      });
      chrome.storage.local.set({ allowedSites: newSites }, renderSites);
    });
  } else if (filterWord) {
    chrome.storage.local.get({ filterWords: [] }, (data) => {
        const filters = Array.isArray(data.filterWords) ? data.filterWords : [];
        const newFilters = filters.filter(f => f !== filterWord);
        chrome.storage.local.set({ filterWords: newFilters }, renderFilters);
    });
  } else if (editionKeyword !== undefined) {
    chrome.storage.local.get({ editionKeywords: getDefaultEditionKeywords() }, (data) => {
        const keywords = Array.isArray(data.editionKeywords) ? data.editionKeywords : getDefaultEditionKeywords();
        const newKeywords = keywords.filter(keyword => keyword !== editionKeyword);
        chrome.storage.local.set({ editionKeywords: newKeywords }, renderEditionKeywords);
    });
  }
};

async function loadReleaseHistory() {
    const container = document.getElementById('releaseHistoryContainer');
    if (container.dataset.loaded === "true") return; 

    try {
        const response = await fetch('https://api.github.com/repos/dongkkase/Chrome_Library_Management/releases');
        if (!response.ok) throw new Error('GitHub API 응답 오류');
        const releases = await response.json();

        if (releases.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">등록된 업데이트 내역이 없습니다.</div>';
            return;
        }

        let html = '';
        releases.forEach(rel => {
            const date = new Date(rel.published_at).toLocaleDateString('ko-KR');
            
            let lines = (rel.body || '').split('\n');
            let htmlLines = [];
            let inList = false;

            lines.forEach(line => {
                let trimmedLine = line.trimRight();
                
                let safeLine = trimmedLine.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                safeLine = safeLine.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
                
                let h3Match = safeLine.match(/^\s*###\s+(.*)/);
                let h2Match = safeLine.match(/^\s*##\s+(.*)/);
                let h1Match = safeLine.match(/^\s*#\s+(.*)/);
                let listMatch = safeLine.match(/^(\s*)[-*]\s+(.*)/);

                if (h3Match) {
                    if (inList) { htmlLines.push('</ul>'); inList = false; }
                    htmlLines.push('<h4>' + h3Match[1] + '</h4>');
                } else if (h2Match) {
                    if (inList) { htmlLines.push('</ul>'); inList = false; }
                    htmlLines.push('<h3>' + h2Match[1] + '</h3>');
                } else if (h1Match) {
                    if (inList) { htmlLines.push('</ul>'); inList = false; }
                    htmlLines.push('<h3>' + h1Match[1] + '</h3>');
                } else if (listMatch) {
                    if (!inList) { htmlLines.push('<ul>'); inList = true; }
                    let indent = listMatch[1].length;
                    let text = listMatch[2];
                    let liClass = indent > 0 ? ' class="sub-li"' : '';
                    htmlLines.push(`<li${liClass}>${text}</li>`);
                } else if (safeLine.trim() === '') {
                    if (inList) { htmlLines.push('</ul>'); inList = false; }
                } else {
                    if (inList) { htmlLines.push('</ul>'); inList = false; }
                    htmlLines.push('<p>' + safeLine + '</p>');
                }
            });
            if (inList) htmlLines.push('</ul>');
            
            let bodyHtml = htmlLines.join('\n');

            html += `
                <div class="release-item">
                    <div class="release-version">
                        <span>🏷️ ${rel.name || rel.tag_name}</span>
                        <span class="release-date">${date}</span>
                    </div>
                    <div class="release-body">${bodyHtml}</div>
                </div>
            `;
        });
        container.innerHTML = html;
        container.dataset.loaded = "true";
    } catch (error) {
        container.innerHTML = `<div style="text-align: center; color: #dc3545; padding: 30px;">오류가 발생했습니다.<br>${error.message}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', () => { 
    const syncCompactListLayout = () => {
        document.body.classList.toggle('compact-list-mode', window.innerWidth <= 900);
    };

    syncCompactListLayout();
    window.addEventListener('resize', syncCompactListLayout);

    if (window.location.hash === '#sidepanel') {
        document.body.classList.add('side-panel-mode');
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            const targetId = e.target.getAttribute('data-target');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');

            if (targetId === 'tab-history') {
                loadReleaseHistory();
            } else if (targetId === 'tab-backup') {
                renderSnapshots(); // 백업 탭 열릴 때 스냅샷 목록 갱신
            }
        });
    });

    const themeToggle = document.getElementById('themeToggle');
    const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");

    chrome.storage.local.get(['darkMode'], (data) => {
        let isDark = data.darkMode;
        if (isDark === undefined) {
            isDark = prefersDarkScheme.matches; 
        }
        themeToggle.checked = isDark;
        if (isDark) document.body.classList.add('dark-mode');
    });

    themeToggle.addEventListener('change', (e) => {
        const isDark = e.target.checked;
        if (isDark) document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');
        chrome.storage.local.set({ darkMode: isDark });
    });

    chrome.storage.local.get({ lastBackup: null, sortOption: 'id_desc', lastBulkType: 'exclude' }, (data) => {
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) sortSelect.value = data.sortOption;
        
        const bulkTypeSelect = document.getElementById('bulkTypeSelect');
        if (bulkTypeSelect) {
            bulkTypeSelect.value = data.lastBulkType;
            bulkTypeSelect.addEventListener('change', (e) => {
                chrome.storage.local.set({ lastBulkType: e.target.value });
            });
        }

        renderList('', true); 
        renderSites();
        renderFilters(); 
        renderEditionKeywords();
        renderSnapshots();

        const timeSpan = document.getElementById('lastBackupTime');
        if (timeSpan) {
            if (data.lastBackup) {
                timeSpan.innerText = `최근 백업: ${data.lastBackup}`;
            } else {
                timeSpan.innerText = `최근 백업: 기록 없음`;
            }
        }
    });

    // 라이브 타입 변경 색상 반영을 위한 이벤트 리스너
    if (listBody) {
        listBody.addEventListener('change', (e) => {
            if (e.target.classList.contains('edit-type')) {
                e.target.setAttribute('data-type', e.target.value);
            }
        });

        listBody.addEventListener('focusin', (e) => {
            if (e.target.classList.contains('edit-folder-rule')) {
                showFolderRulePreview(e.target);
            }
        });

        listBody.addEventListener('input', (e) => {
            if (e.target.classList.contains('edit-folder-rule')) {
                showFolderRulePreview(e.target);
            }
        });

        listBody.addEventListener('focusout', (e) => {
            if (!e.target.classList.contains('edit-folder-rule')) return;
            hideFolderRulePreview();
        });

        window.addEventListener('scroll', () => {
            if (!activeFolderRuleInput) return;
            updateFolderRulePreviewPosition(activeFolderRuleInput);
        }, true);

        window.addEventListener('resize', () => {
            if (!activeFolderRuleInput) return;
            updateFolderRulePreviewPosition(activeFolderRuleInput);
        });
    }

    const addSiteBtn = document.getElementById('addSiteBtn');
    if (addSiteBtn) {
      addSiteBtn.onclick = () => {
        const siteInput = document.getElementById('siteInput');
        if (!siteInput) return;
        const val = siteInput.value.trim().replace(/^https?:\/\//, '').split('/')[0];
        if (val) {
          chrome.storage.local.get({ allowedSites: [] }, (data) => { 
            const currentSites = Array.isArray(data.allowedSites) ? data.allowedSites : [];
            const exists = currentSites.some(s => (typeof s === 'string' ? s : s.url) === val);
            if (!exists) {
              chrome.storage.local.set({ allowedSites: [...currentSites, { url: val, detailSelector: "" }] }, () => { 
                siteInput.value = ''; 
                renderSites(); 
              });
            } else {
              showInfoToast('❌ 이미 등록된 사이트입니다.', true);
            }
          });
        }
      };
    }

    const addFilterBtn = document.getElementById('addFilterBtn');
    if (addFilterBtn) {
        addFilterBtn.onclick = () => {
            const filterInput = document.getElementById('filterInput');
            if (!filterInput) return;
            const val = filterInput.value.trim();
            if (val) {
                chrome.storage.local.get({ filterWords: [] }, (data) => {
                    const currentFilters = Array.isArray(data.filterWords) ? data.filterWords : [];
                    if (!currentFilters.includes(val)) {
                        chrome.storage.local.set({ filterWords: [...currentFilters, val] }, () => {
                            filterInput.value = '';
                            renderFilters();
                        });
                    } else {
                        showInfoToast('❌ 이미 등록된 금지어입니다.', true);
                    }
                });
            }
        };
    }

    const addEditionKeywordBtn = document.getElementById('addEditionKeywordBtn');
    const editionKeywordInput = document.getElementById('editionKeywordInput');
    const addEditionKeyword = () => {
        if (!editionKeywordInput) return;
        const value = editionKeywordInput.value.trim();
        const normalizedValue = normalizeTitleText(value);
        if (!normalizedValue) return;

        chrome.storage.local.get({ editionKeywords: getDefaultEditionKeywords() }, (data) => {
            const currentKeywords = Array.isArray(data.editionKeywords) ? data.editionKeywords : getDefaultEditionKeywords();
            const alreadyExists = currentKeywords.some(keyword => normalizeTitleText(keyword) === normalizedValue);
            if (alreadyExists) {
                showInfoToast('❌ 이미 등록된 판본 키워드입니다.', true);
                return;
            }

            chrome.storage.local.set({ editionKeywords: [...currentKeywords, value] }, () => {
                editionKeywordInput.value = '';
                renderEditionKeywords();
            });
        });
    };

    if (addEditionKeywordBtn) addEditionKeywordBtn.onclick = addEditionKeyword;
    if (editionKeywordInput) {
        editionKeywordInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                addEditionKeyword();
            }
        });
    }

    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const searchToolsBtn = document.getElementById('searchToolsBtn');
    const searchToolsMenu = document.getElementById('searchToolsMenu');
    const searchToolsLabel = searchToolsBtn ? searchToolsBtn.querySelector('.search-tools-label') : null;
    let searchDebounceTimer;

    const updateSearchToolsLabel = value => {
        if (!searchToolsLabel) return;
        if (value === '#중복') searchToolsLabel.textContent = '중복 찾기';
        else if (value === '#누락') searchToolsLabel.textContent = '누락 찾기';
        else if (value === '#폴더규칙' || value.startsWith('#폴더규칙:')) searchToolsLabel.textContent = '폴더 규칙 찾기';
        else searchToolsLabel.textContent = '목록 찾기';
    };

    const closeSearchToolsMenu = () => {
        if (searchToolsMenu) searchToolsMenu.classList.remove('open');
        if (searchToolsBtn) searchToolsBtn.setAttribute('aria-expanded', 'false');
    };

    if (searchToolsBtn && searchToolsMenu) {
        searchToolsBtn.onclick = event => {
            event.stopPropagation();
            const willOpen = !searchToolsMenu.classList.contains('open');
            searchToolsMenu.classList.toggle('open', willOpen);
            searchToolsBtn.setAttribute('aria-expanded', String(willOpen));
            if (willOpen) {
                const firstMenuItem = searchToolsMenu.querySelector('[data-special-filter]');
                if (firstMenuItem) firstMenuItem.focus();
            }
        };

        searchToolsMenu.onclick = event => {
            event.stopPropagation();
            const menuItem = event.target.closest('[data-special-filter]');
            if (!menuItem || !searchInput) return;

            const specialFilter = menuItem.dataset.specialFilter || '';
            searchInput.value = specialFilter;
            searchInput.dispatchEvent(new Event('input'));
            closeSearchToolsMenu();
            searchInput.focus();
            if (typeof searchInput.setSelectionRange === 'function') {
                const len = searchInput.value.length;
                searchInput.setSelectionRange(len, len);
            }
        };

        document.addEventListener('click', closeSearchToolsMenu);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                closeSearchToolsMenu();
                searchToolsBtn.focus();
            }
        });
    }

    if (searchInput) {
        if (clearSearchBtn) {
            clearSearchBtn.style.display = searchInput.value ? 'block' : 'none';
        }
        updateSearchToolsLabel(searchInput.value);
        searchInput.oninput = (e) => {
            if (clearSearchBtn) {
                clearSearchBtn.style.display = e.target.value ? 'block' : 'none';
            }
            updateSearchToolsLabel(e.target.value);
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                // 검색어 입력 시 1페이지로 리셋 (true 전달)
                renderList(e.target.value, true); 
            }, 300);
        };
    }

    if (clearSearchBtn && searchInput) {
        clearSearchBtn.onclick = () => {
            searchInput.value = '';
            clearSearchBtn.style.display = 'none';
            updateSearchToolsLabel('');
            renderList('', true);
        };
    }

    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.onchange = (e) => {
            chrome.storage.local.set({ sortOption: e.target.value }, () => {
                const filter = searchInput ? searchInput.value : '';
                // 💡 정렬 변경 시 1페이지로 리셋 (true 전달)
                renderList(filter, true); 
            });
        };
    }

    initVersionCheck();

    const uiCheckbox = document.getElementById('showDownloadUICheckbox');
    const confirmCheckbox = document.getElementById('autoConfirmCheckbox');
    const folderCheckbox = document.getElementById('autoFolderCheckbox'); 
    const focusLeftCheckbox = document.getElementById('focusLeftTabCheckbox');
    const slidePanelCheckbox = document.getElementById('openSlidePanelCheckbox');
    const hideUselessCommentsCheckbox = document.getElementById('hideUselessCommentsCheckbox');
    const connectEverythingCheckbox = document.getElementById('connectEverythingCheckbox');
    const showListQuickBtnCheckbox = document.getElementById('showListQuickBtnCheckbox');
    const showListQuickBtnHoverCheckbox = document.getElementById('showListQuickBtnHoverCheckbox');
    const customThemeCheckbox = document.getElementById('useCustomThemeCheckbox');
    const supportSingleCharCheckbox = document.getElementById('supportSingleCharCheckbox');
    const hideExcludeCheckbox = document.getElementById('hideExcludeCheckbox');
    const hideCompleteCheckbox = document.getElementById('hideCompleteCheckbox');
    const hideIncompleteCheckbox = document.getElementById('hideIncompleteCheckbox');
    const hideTranslateCheckbox = document.getElementById('hideTranslateCheckbox');
    const hideNewCheckbox = document.getElementById('hideNewCheckbox');
    const hideQuickMenuCheckbox = document.getElementById('hideQuickMenuCheckbox');

    chrome.storage.local.get({ showDownloadUI: true, autoConfirm: true, autoFolder: true, focusLeftTab: false, openSlidePanel: false, hideUselessComments: true, connectEverything: false, showListQuickBtn: false, showListQuickBtnHover: false, useCustomTheme: false, supportSingleChar: false, hideExclude: false, hideComplete: false, hideIncomplete: false, hideTranslate: false, hideNew: false, hideQuickMenu: false }, (data) => {
        if (uiCheckbox) uiCheckbox.checked = data.showDownloadUI;
        if (confirmCheckbox) confirmCheckbox.checked = data.autoConfirm;
        if (folderCheckbox) folderCheckbox.checked = data.autoFolder; 
        if (focusLeftCheckbox) focusLeftCheckbox.checked = data.focusLeftTab;
        if (slidePanelCheckbox) slidePanelCheckbox.checked = data.openSlidePanel;
        if (hideUselessCommentsCheckbox) hideUselessCommentsCheckbox.checked = data.hideUselessComments;
        if (connectEverythingCheckbox) connectEverythingCheckbox.checked = data.connectEverything;
        if (showListQuickBtnCheckbox) showListQuickBtnCheckbox.checked = data.showListQuickBtn;
        if (showListQuickBtnHoverCheckbox) showListQuickBtnHoverCheckbox.checked = data.showListQuickBtnHover;
        if (customThemeCheckbox) customThemeCheckbox.checked = data.useCustomTheme;
        if (supportSingleCharCheckbox) supportSingleCharCheckbox.checked = data.supportSingleChar;
        if (hideExcludeCheckbox) hideExcludeCheckbox.checked = data.hideExclude;
        if (hideCompleteCheckbox) hideCompleteCheckbox.checked = data.hideComplete;
        if (hideIncompleteCheckbox) hideIncompleteCheckbox.checked = data.hideIncomplete;
        if (hideTranslateCheckbox) hideTranslateCheckbox.checked = data.hideTranslate;
        if (hideNewCheckbox) hideNewCheckbox.checked = data.hideNew;
        if (hideQuickMenuCheckbox) hideQuickMenuCheckbox.checked = data.hideQuickMenu;
    });
    
    // 옵션값 변경 시 저장 로직
    if (uiCheckbox) {
        uiCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ showDownloadUI: e.target.checked });
        });
    }
    if (supportSingleCharCheckbox) {
        supportSingleCharCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ supportSingleChar: e.target.checked });
        });
    }
    if (confirmCheckbox) {
        confirmCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ autoConfirm: e.target.checked });
        });
    }
    if (folderCheckbox) {
        folderCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ autoFolder: e.target.checked });
        });
    }
    if (hideUselessCommentsCheckbox) {
        hideUselessCommentsCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ hideUselessComments: e.target.checked });
        });
    }
    // 왼쪽 탭 포커스 저장 로직 추가
    if (focusLeftCheckbox) {
        focusLeftCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ focusLeftTab: e.target.checked });
        });
    }
    // 슬라이드 패널 저장 로직 수정 (레이스 컨디션 방지 및 백그라운드 이관)
    if (slidePanelCheckbox) {
        slidePanelCheckbox.addEventListener('change', (e) => {
            const isSlide = e.target.checked;
            chrome.storage.local.set({ openSlidePanel: isSlide }, () => {
                if (isSlide) {
                    chrome.windows.getCurrent({ populate: false }, (currentWindow) => {
                        if (chrome.sidePanel && chrome.sidePanel.open) {
                            chrome.sidePanel.open({ windowId: currentWindow.id })
                                .then(() => {
                                    window.close();
                                })
                                .catch((err) => {
                                    console.error(err);
                                    window.close();
                                });
                        } else {
                            window.close();
                        }
                    });
                } else {
                    // 확장 프로그램 아이콘을 프로그래밍 방식으로 강제 클릭(트리거)하여 원래의 팝업 말풍선을 엽니다.
                    if (chrome.action && chrome.action.openPopup) {
                        chrome.action.setPopup({ popup: "options.html" }, () => {
                            chrome.action.openPopup()
                                .then(() => {
                                    window.close();
                                })
                                .catch((err) => {
                                    console.error("Popup trigger failed:", err);
                                    // API 지원이 안 되거나 권한 문제 시 기존 단독 창 모드로 대체
                                    chrome.windows.create({
                                        url: "options.html",
                                        type: "popup",
                                        width: 760,
                                        height: 850
                                    }, () => {
                                        window.close();
                                    });
                                });
                        });
                    } else {
                        // 하위 버전 크롬 호환용 폴백
                        chrome.windows.create({
                            url: "options.html",
                            type: "popup",
                            width: 760,
                            height: 850
                        }, () => {
                            window.close();
                        });
                    }
                }
            });
        });
    }

    if (connectEverythingCheckbox) {
        connectEverythingCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ connectEverything: e.target.checked });
        });
    }
    if (showListQuickBtnCheckbox) {
        showListQuickBtnCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ showListQuickBtn: e.target.checked });
        });
    }
    if (showListQuickBtnHoverCheckbox) {
        showListQuickBtnHoverCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ showListQuickBtnHover: e.target.checked });
        });
    }
    if (customThemeCheckbox) {
        customThemeCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ useCustomTheme: e.target.checked });
        });
    }
    if (hideExcludeCheckbox) {
        hideExcludeCheckbox.addEventListener('change', e => chrome.storage.local.set({ hideExclude: e.target.checked }));
    }
    if (hideCompleteCheckbox) {
        hideCompleteCheckbox.addEventListener('change', e => chrome.storage.local.set({ hideComplete: e.target.checked }));
    }
    if (hideIncompleteCheckbox) {
        hideIncompleteCheckbox.addEventListener('change', e => chrome.storage.local.set({ hideIncomplete: e.target.checked }));
    }
    if (hideTranslateCheckbox) {
        hideTranslateCheckbox.addEventListener('change', e => chrome.storage.local.set({ hideTranslate: e.target.checked }));
    }
    if (hideNewCheckbox) {
        hideNewCheckbox.addEventListener('change', e => chrome.storage.local.set({ hideNew: e.target.checked }));
    }
    if (hideQuickMenuCheckbox) {
        hideQuickMenuCheckbox.addEventListener('change', e => chrome.storage.local.set({ hideQuickMenu: e.target.checked }));
    }

    // [신규 추가] '보기' 버튼 클릭을 통해 접근 시 포커스 애니메이션 처리
    function focusUselessCommentsOption() {
        const tabBtn = document.querySelector('.tab-btn[data-target="tab-settings"]');
        if (tabBtn) tabBtn.click();
        
        setTimeout(() => {
            const targetLabel = document.getElementById('hideUselessCommentsContainer');
            if (targetLabel) {
                targetLabel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                let blinkCount = 0;
                targetLabel.style.transition = 'background-color 0.3s ease';
                const blinkInterval = setInterval(() => {
                    targetLabel.style.backgroundColor = blinkCount % 2 === 0 ? 'rgba(255, 193, 7, 0.4)' : 'transparent';
                    targetLabel.style.borderRadius = '8px';
                    targetLabel.style.padding = '5px';
                    blinkCount++;
                    if (blinkCount > 6) {
                        clearInterval(blinkInterval);
                        targetLabel.style.backgroundColor = 'transparent';
                    }
                }, 300);
            }
        }, 300);
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('focus') === 'hideUselessComments') focusUselessCommentsOption();

    chrome.storage.local.get(['pendingFocus'], (data) => {
        if (data.pendingFocus === 'hideUselessComments') {
            focusUselessCommentsOption();
            chrome.storage.local.remove('pendingFocus');
        }
    });

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === "FOCUS_USELESS_COMMENTS") {
            focusUselessCommentsOption();
            chrome.storage.local.remove('pendingFocus');
        }
    });
});

async function initVersionCheck() {
    const manifest = chrome.runtime.getManifest();
    const currentVersion = manifest.version;
    const versionSpan = document.getElementById('current-version');
    if (versionSpan) versionSpan.textContent = "v" + currentVersion;

    const updateLink = document.getElementById('update-link');
    const manualBtn = document.getElementById('manual-check-btn');
    const statusMsg = document.getElementById('update-status-msg');

    let extensionInfo;
    try {
        extensionInfo = await chrome.management.getSelf();
    } catch (error) {
        console.log("설치 유형 확인 실패:", error);
        return;
    }

    const isManualInstall = extensionInfo.installType === 'development';
    const isStoreInstall = extensionInfo.installType === 'normal';

    if (manualBtn) {
        manualBtn.textContent = isStoreInstall
            ? "업데이트 확인"
            : isManualInstall
                ? "업데이트 확인"
                : "GitHub 버전 확인";
        manualBtn.style.display = 'inline-block';
    }

    const GITHUB_RAW_URL = "https://raw.githubusercontent.com/dongkkase/Chrome_Library_Management/main/version.json";
    let statusHideTimer = null;
    let storeUpdateUiTimeout = null;
    let isApplyingStoreUpdate = false;

    const showStatus = (message, color = "#6c757d", hideAfter = 0) => {
        if (!statusMsg) return;
        if (statusHideTimer) clearTimeout(statusHideTimer);
        statusMsg.textContent = message;
        statusMsg.style.color = color;
        statusMsg.style.display = "inline-block";

        if (hideAfter > 0) {
            statusHideTimer = setTimeout(() => {
                statusMsg.style.display = "none";
            }, hideAfter);
        }
    };

    const hideUpdateAction = () => {
        if (!updateLink) return;
        updateLink.style.display = "none";
        updateLink.onclick = null;
    };

    const setControlsBusy = (isBusy) => {
        if (manualBtn) manualBtn.disabled = isBusy;
        if (updateLink) {
            updateLink.style.pointerEvents = isBusy ? "none" : "auto";
            updateLink.style.opacity = isBusy ? "0.65" : "1";
            updateLink.setAttribute("aria-disabled", String(isBusy));
        }
    };

    const setNewVersionBadge = (hasNewVersion) => {
        if (!chrome.action || !chrome.action.setBadgeText) return;
        chrome.action.setBadgeText({ text: hasNewVersion ? "NEW" : "" });
        if (hasNewVersion) chrome.action.setBadgeBackgroundColor({ color: "#dc3545" });
    };

    const downloadGitHubUpdate = (latestVersion) => {
        const zipUrl = `https://github.com/dongkkase/Chrome_Library_Management/releases/download/v${latestVersion}/libmanagement.zip`;
        chrome.downloads.download({ url: zipUrl }, () => {
            if (chrome.runtime.lastError) {
                showStatus("업데이트 파일 다운로드에 실패했습니다.", "#dc3545");
                return;
            }

            alert(`📥 [v${latestVersion}] 업데이트 파일(.zip) 다운로드가 시작되었습니다!\n\n[수동 업데이트 방법]\n1. 다운로드된 압축 파일을 풉니다.\n2. 기존 확장프로그램 폴더에 파일들을 모두 덮어씌웁니다.\n3. 크롬 '확장프로그램 관리(chrome://extensions)' 페이지에서 [↻ 새로고침] 버튼을 누르면 적용됩니다.`);
        });
    };

    const requestStoreUpdate = async (latestVersion) => {
        if (storeUpdateUiTimeout) {
            clearTimeout(storeUpdateUiTimeout);
            storeUpdateUiTimeout = null;
        }
        isApplyingStoreUpdate = true;
        setControlsBusy(true);
        showStatus(`Chrome 웹 스토어에서 v${latestVersion} 업데이트를 확인하는 중...`);

        try {
            const result = await chrome.runtime.sendMessage({ action: "REQUEST_STORE_UPDATE" });
            if (!result || !result.ok) {
                if (result && result.status === "unsupported_install_type") {
                    showStatus("현재 설치 방식에서는 웹 스토어 자동 업데이트를 요청할 수 없습니다.", "#dc3545");
                } else if (result && result.status === "unsupported_api") {
                    showStatus("현재 브라우저는 즉시 업데이트 확인 기능을 지원하지 않습니다.", "#dc3545");
                } else {
                    showStatus("Chrome 웹 스토어 업데이트 확인에 실패했습니다.", "#dc3545");
                }
                isApplyingStoreUpdate = false;
                return;
            }

            if (result.status === "update_available") {
                const updateVersion = result.version || latestVersion;
                showStatus(`v${updateVersion} 업데이트를 다운로드합니다. 준비되면 자동으로 적용됩니다.`, "#28a745");
                storeUpdateUiTimeout = setTimeout(() => {
                    isApplyingStoreUpdate = false;
                    storeUpdateUiTimeout = null;
                    setControlsBusy(false);
                    showStatus("업데이트 준비가 지연되고 있습니다. 잠시 후 다시 확인해 주세요.", "#d9480f");
                }, 2 * 60 * 1000);
                return;
            }

            if (result.status === "no_update") {
                showStatus(`GitHub에는 v${latestVersion}이 있지만 웹 스토어 배포가 아직 준비되지 않았습니다.`, "#d9480f");
            } else if (result.status === "throttled") {
                showStatus("Chrome이 업데이트 확인 요청을 제한했습니다. 잠시 후 다시 시도해 주세요.", "#d9480f");
            } else {
                showStatus("Chrome 웹 스토어에서 설치 가능한 업데이트를 찾지 못했습니다.", "#d9480f");
            }
            isApplyingStoreUpdate = false;
        } catch (error) {
            console.log("웹 스토어 업데이트 요청 실패:", error);
            showStatus("Chrome 웹 스토어 업데이트 확인에 실패했습니다.", "#dc3545");
            isApplyingStoreUpdate = false;
        } finally {
            if (!isApplyingStoreUpdate) setControlsBusy(false);
        }
    };

    const configureUpdateAction = (latestVersion) => {
        if (!updateLink) return;

        if (isManualInstall) {
            updateLink.textContent = `📥 최신 파일 받기 (v${latestVersion})`;
            updateLink.onclick = (event) => {
                event.preventDefault();
                downloadGitHubUpdate(latestVersion);
            };
        } else if (isStoreInstall) {
            updateLink.textContent = `웹 스토어 업데이트 (v${latestVersion})`;
            updateLink.onclick = (event) => {
                event.preventDefault();
                requestStoreUpdate(latestVersion);
            };
        } else {
            hideUpdateAction();
            return;
        }

        updateLink.style.display = "inline-block";
    };

    const checkVersion = async (isManual = false) => {
        if (isManual) {
            setControlsBusy(true);
            hideUpdateAction();
            showStatus("GitHub에서 최신 버전을 확인하는 중...");
        }

        try {
            const data = await chrome.storage.local.get(['lastVersionCheckTime', 'latestVersionInfo']);
            const now = Date.now();
            const updateInterval = 2 * 60 * 60 * 1000;
            let latestData = data.latestVersionInfo;
            const shouldFetch = isManual || !data.lastVersionCheckTime || (now - data.lastVersionCheckTime > updateInterval);

            if (shouldFetch) {
                const response = await fetch(GITHUB_RAW_URL + "?t=" + now);
                if (!response.ok) throw new Error("서버 응답 오류");

                latestData = await response.json();
                await chrome.storage.local.set({
                    lastVersionCheckTime: now,
                    latestVersionInfo: latestData
                });
            }

            if (!latestData || !latestData.latest_version) throw new Error("버전 정보가 올바르지 않습니다.");

            const latestVersion = latestData.latest_version;
            const hasNewVersion = isNewerExtensionVersion(latestVersion, currentVersion);
            setNewVersionBadge(hasNewVersion);

            if (hasNewVersion) {
                configureUpdateAction(latestVersion);

                if (isStoreInstall) {
                    if (isManual) await requestStoreUpdate(latestVersion);
                    else showStatus(`GitHub에서 v${latestVersion} 신규 버전을 확인했습니다.`, "#dc3545");
                } else if (isManualInstall) {
                    showStatus(`GitHub에서 v${latestVersion} 신규 버전을 확인했습니다.`, "#dc3545");
                } else {
                    showStatus(`GitHub에는 v${latestVersion}이 있습니다. 브라우저 관리 정책에서 업데이트해야 합니다.`, "#d9480f");
                }
                return;
            }

            hideUpdateAction();
            if (isManual) {
                showStatus("최신 버전입니다.", "#28a745", 3000);
            } else if (isStoreInstall) {
                showStatus("Chrome 웹 스토어 설치본 · 최신 버전", "#28a745");
            } else if (!isManualInstall) {
                showStatus("브라우저 관리 설치본 · 최신 GitHub 버전", "#28a745");
            }
        } catch (error) {
            console.log("버전 체크 실패:", error);
            if (isManual) showStatus("버전 확인에 실패했습니다. 인터넷 연결을 확인해 주세요.", "#dc3545", 3000);
        } finally {
            if (!isApplyingStoreUpdate) setControlsBusy(false);
        }
    };

    checkVersion(false);

    if (manualBtn) {
        manualBtn.addEventListener('click', () => checkVersion(true));
    }
}


// ============================================================================
// [신규 추가] 실시간 데이터 동기화 리스너
// 우클릭 메뉴 등 외부(백그라운드)에서 데이터가 변경되었을 때, 
// 열려있는 슬라이드 패널(또는 옵션창)의 리스트를 즉시 새로고침합니다.
// ============================================================================
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.missingVolsMap && changes.missingVolsUpdate) {
        const searchInput = document.getElementById('searchInput');
        if (searchInput && searchInput.value === '#누락') {
            renderList('#누락', false);
            return;
        }

        updateMissingBadge(changes.missingVolsUpdate.newValue);
        return;
    }

    if (areaName === 'local' && changes.bookList) {
        const searchInput = document.getElementById('searchInput');
        const filter = searchInput ? searchInput.value : '';
        
        // 검색어가 유지된 상태로 현재 페이지 위치에서 리스트를 다시 그립니다.
        renderList(filter, false);
    }
});


// 누락 권수 관리 팝오버 초기화 및 이벤트 리스너 추가
let missingVolSaveTimer = null;
let pendingMissingVolSave = null;
let missingVolSaveQueue = Promise.resolve();

function updateMissingBadge(update) {
    if (!update || update.bookId === undefined) return;

    const badge = Array.from(document.querySelectorAll('.missing-badge')).find(element => {
        return Number(element.dataset.id) === Number(update.bookId);
    });
    if (!badge) return;

    const missingCount = Array.isArray(update.missingVols) ? update.missingVols.length : 0;
    badge.classList.toggle('empty', missingCount === 0);
    badge.textContent = missingCount > 0 ? `${missingCount}누락` : '+누락';
}

function scheduleMissingVolSave(missingVolsMap, bookId, missingVols) {
    pendingMissingVolSave = {
        missingVolsMap,
        bookId,
        missingVols: [...missingVols].sort((a, b) => a - b)
    };

    if (missingVolSaveTimer) clearTimeout(missingVolSaveTimer);
    missingVolSaveTimer = setTimeout(flushPendingMissingVolSave, 350);
}

function flushPendingMissingVolSave() {
    if (missingVolSaveTimer) {
        clearTimeout(missingVolSaveTimer);
        missingVolSaveTimer = null;
    }
    if (!pendingMissingVolSave) return missingVolSaveQueue;

    const pending = pendingMissingVolSave;
    pendingMissingVolSave = null;

    const save = () => new Promise(resolve => {
        const updatedMissingVolsMap = { ...pending.missingVolsMap };
        updatedMissingVolsMap[String(pending.bookId)] = pending.missingVols;

        const marker = {
            bookId: pending.bookId,
            missingVols: pending.missingVols,
            timestamp: Date.now()
        };

        chrome.storage.local.set({ missingVolsMap: updatedMissingVolsMap, missingVolsUpdate: marker }, resolve);
    });

    missingVolSaveQueue = missingVolSaveQueue.then(save, save);
    return missingVolSaveQueue;
}

let volPopover = document.getElementById('missingPopover');
if (!volPopover) {
    volPopover = document.createElement('div');
    volPopover.id = 'missingPopover';
    document.body.appendChild(volPopover);
    
    // 팝오버 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (!volPopover.contains(e.target) && !e.target.closest('.missing-badge')) {
            flushPendingMissingVolSave();
            volPopover.style.display = 'none';
        }
    });
}

window.addEventListener('pagehide', flushPendingMissingVolSave);

// 리스트 내의 누락 배지 클릭 감지
if (listBody) {
    listBody.addEventListener('click', (e) => {
        const badge = e.target.closest('.missing-badge');
        if (badge) {
            const id = parseFloat(badge.dataset.id);
            openMissingPopover(id, badge);
        }
    });
}

function openMissingPopover(bookId, badgeElement) {
    flushPendingMissingVolSave().then(() => chrome.storage.local.get({ bookList: [], missingVolsMap: {} }, (data) => {
        const list = data.bookList;
        const bookIndex = list.findIndex(b => b.id === bookId);
        const book = bookIndex > -1 ? list[bookIndex] : null;
        if (!book) return;

        const lastVol = parseInt(book.lastVol, 10);
        if (isNaN(lastVol) || lastVol <= 0) {
            showInfoToast('❌ 권수를 먼저 숫자로 입력하고 [수정] 버튼으로 저장한 뒤에 이용해주세요.', true);
            return;
        }

        const missingVolSet = new Set(getBookMissingVols(book, data.missingVolsMap));

        // 팝오버 내부 HTML 구성 (입력된 최대 권수까지 번호표 렌더링)
        volPopover.innerHTML = `
            <div class="popover-header">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${book.title} (총 ${lastVol}권)</span>
                <button id="closePopoverBtn" style="background:transparent; color:var(--text); padding:0; margin-left:5px; font-size:14px; box-shadow:none; cursor:pointer;">✕</button>
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px;">빈틈이 발생한 누락 번호를 클릭하세요.</div>
            <div class="vol-grid">
                ${Array.from({length: lastVol}, (_, i) => i + 1).map(v => `
                    <div class="vol-item ${missingVolSet.has(v) ? 'missing' : ''}" data-vol="${v}">${v}</div>
                `).join('')}
            </div>
        `;

        // 클릭된 배지 위치를 계산하여 팝오버 띄우기
        const rect = badgeElement.getBoundingClientRect();
        volPopover.style.display = 'block';
        volPopover.style.top = `${rect.bottom + window.scrollY + 8}px`;
        let leftPos = rect.left + window.scrollX - 180;
        if (leftPos < 10) leftPos = 10; // 화면 왼쪽 벗어남 방지
        volPopover.style.left = `${leftPos}px`;

        document.getElementById('closePopoverBtn').onclick = () => {
            flushPendingMissingVolSave();
            volPopover.style.display = 'none';
        };
        
        const volumeGrid = volPopover.querySelector('.vol-grid');
        volumeGrid.onclick = (event) => {
            const item = event.target.closest('.vol-item');
            if (!item) return;

            const vol = parseInt(item.dataset.vol, 10);
            if (missingVolSet.has(vol)) {
                missingVolSet.delete(vol);
                item.classList.remove('missing');
            } else {
                missingVolSet.add(vol);
                item.classList.add('missing');
            }

            const missingVols = Array.from(missingVolSet).sort((a, b) => a - b);
            updateMissingBadge({ bookId, missingVols });
            scheduleMissingVolSave(data.missingVolsMap, bookId, missingVols);
        };
    }));
}
