const listBody = document.getElementById('listBody');

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

let renderFrame;

function renderList(filter = "") {
  chrome.storage.local.get({ bookList: [], sortOption: 'id_desc' }, (data) => {
    if (renderFrame) cancelAnimationFrame(renderFrame); 
    listBody.innerHTML = '';
    
    let list = Array.isArray(data.bookList) ? data.bookList : [];
    
    const completeCount = list.filter(b => b.type === 'complete').length;
    const incompleteCount = list.filter(b => b.type === 'incomplete').length;
    const excludeCount = list.filter(b => b.type === 'exclude').length;
    
    document.getElementById('stat-total').innerText = list.length;
    document.getElementById('stat-complete').innerText = completeCount;
    document.getElementById('stat-incomplete').innerText = incompleteCount;
    document.getElementById('stat-exclude').innerText = excludeCount;

    const filteredList = list.filter(b => b && b.title && b.title.toLowerCase().includes(filter.toLowerCase()));
    const countDisplay = document.getElementById('listCountDisplay');
    if (countDisplay) {
        if (filter.trim() === "") {
            countDisplay.innerHTML = `검색 없이 모든 목록을 보고 있습니다.`;
        } else {
            countDisplay.innerHTML = `검색 결과: 총 <span style="color:#e83e8c;">${filteredList.length}</span>건`;
        }
    }

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

    filteredList.sort(sortFn);

    let index = 0;
    const chunkSize = 50; 

    function drawChunk() {
        const fragment = document.createDocumentFragment();
        const end = Math.min(index + chunkSize, filteredList.length);
        
        for (; index < end; index++) {
            const book = filteredList[index];
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>
                <select class="edit-type" data-id="${book.id}" style="padding: 4px;">
                  <option value="exclude" ${book.type==='exclude'?'selected':''}>제외</option>
                  <option value="incomplete" ${book.type==='incomplete'?'selected':''}>미완</option>
                  <option value="complete" ${book.type==='complete'?'selected':''}>완결</option>
                </select>
              </td>
              <td><input type="text" class="edit-title" value="${book.title}" data-id="${book.id}"></td>
              <td><input type="text" class="edit-res" value="${book.resolution||''}" data-id="${book.id}"></td>
              <td><input type="text" class="edit-vol" value="${book.lastVol||''}" data-id="${book.id}"></td>
              <td style="color:var(--text-muted); font-size:11px;">${formatDisplayDate(book.date)}</td>
              <td>
                  <button class="btn-save" data-id="${book.id}">수정</button>
                  <button class="btn-del" data-id="${book.id}">삭제</button>
              </td>
            `;
            fragment.appendChild(tr);
        }
        
        listBody.appendChild(fragment);
        
        if (index < filteredList.length) {
            renderFrame = requestAnimationFrame(drawChunk);
        }
    }
    
    renderFrame = requestAnimationFrame(drawChunk);
  });
}

function saveWithUndo(newList, successMsg) {
    chrome.storage.local.get({ bookList: [] }, (data) => {
        chrome.storage.local.set({ backupList: data.bookList }, () => {
            chrome.storage.local.set({ bookList: newList }, () => {
                if (successMsg) alert(successMsg);
                renderList(document.getElementById('searchInput').value);
                
                const undoBtn = document.getElementById('undoBtn');
                undoBtn.style.display = 'block';
                setTimeout(() => { undoBtn.style.display = 'none'; }, 15000);
            });
        });
    });
}

document.getElementById('undoBtn').onclick = () => {
    chrome.storage.local.get({ backupList: null }, (data) => {
        if (data.backupList) {
            chrome.storage.local.set({ bookList: data.backupList }, () => {
                alert('⏪ 방금 전 작업이 완벽하게 취소(복구)되었습니다.');
                renderList(document.getElementById('searchInput').value);
                document.getElementById('undoBtn').style.display = 'none';
            });
        }
    });
};

document.getElementById('batchUpdateBtn').onclick = () => {
    const targetType = document.getElementById('batchTypeSelect').value;
    const filter = document.getElementById('searchInput').value.toLowerCase();
    
    let typeNameKOR = targetType === 'exclude' ? '제외' : (targetType === 'complete' ? '완결' : '미완');
    if(!confirm(`현재 검색된 모든 항목을 [${typeNameKOR}] 타입으로 변경하시겠습니까?`)) return;

    chrome.storage.local.get({ bookList: [] }, (data) => {
        let list = Array.isArray(data.bookList) ? data.bookList : [];
        const today = new Date().toISOString(); 

        const updatedList = list.map(book => {
            if (book && book.title && book.title.toLowerCase().includes(filter)) {
                return { ...book, type: targetType, date: today };
            }
            return book;
        });

        saveWithUndo(updatedList, '일괄 수정이 완료되었습니다.');
    });
};

document.getElementById('exportBtn').onclick = () => {
    chrome.storage.local.get({ bookList: [] }, (data) => {
        const blob = new Blob([JSON.stringify(data.bookList, null, 2)], { type: 'application/json' });
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
            if (Array.isArray(importedData)) {
                saveWithUndo(importedData, '✅ 데이터 복구가 완료되었습니다.');
            } else {
                alert('❌ 올바른 JSON 형식이 아닙니다.');
            }
        } catch (err) {
            alert('❌ 파일을 읽는 중 오류가 발생했습니다.');
        }
        e.target.value = '';
    };
    reader.readAsText(file);
};

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
    const rangeMatch = line.match(/(\d+)\s*(?:권|화|부(?!터))?\s*[~-]\s*(\d+)/);
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
      .replace(/(\d+)?권/g, '')
      .replace(/(\d+)?완/g, '')
      .replace(/\s?권$/g, '')
      .replace(/\s?완$/g, '')
      .replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, ' ')
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
  
  // 💡 데이터가 많을 경우 브라우저 멈춤을 방지하기 위해 로딩 상태 표시
  const btn = document.getElementById('saveBtn');
  const originalBtnText = btn.innerText;
  btn.innerText = "⏳ 6만건 처리 중... (잠시만 기다려주세요)";
  btn.style.pointerEvents = 'none';

  // UI 텍스트가 바뀔 틈을 주기 위해 setTimeout으로 비동기 실행
  setTimeout(() => {
    chrome.storage.local.get({ bookList: [] }, (data) => {
      let currentList = Array.isArray(data.bookList) ? data.bookList : [];
      let skippedCount = 0;

      // 🚀 [최적화 1] 검색 속도 무한대 향상 (O(N) -> O(1))
      // 매번 findIndex로 찾지 않도록 기존 목록을 Map(사전) 형태로 미리 만들어 둡니다.
      const titleMap = new Map();
      currentList.forEach((book, idx) => {
          if (book && book.title) {
              const normalized = book.title.replace(/\s+/g, '').toLowerCase();
              titleMap.set(normalized, idx); // 제목을 키(Key)로, 인덱스를 값(Value)으로 저장
          }
      });

      // 🚀 [최적화 2] unshift 연산 제거
      // 매번 배열을 뒤로 미는 대신, 임시 배열에 일단 차곡차곡 쌓습니다(push).
      const newBooks = [];

      lines.forEach(line => {
        const resMatch = line.match(/\d{3,4}\s*px/gi);
        
        // 이전에 수정한 부(?!터) 정규식 그대로 유지
        const rangeMatch = line.match(/(\d+)\s*(?:권|화|부(?!터))?\s*[~-]\s*(\d+)/);
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
          .replace(/(\d+)?권/g, '')
          .replace(/(\d+)?완/g, '')
          .replace(/\s?권$/g, '')
          .replace(/\s?완$/g, '')
          .replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (!cleanTitle) {
            skippedCount++;
            return; 
        }

        const normalizedNewTitle = cleanTitle.replace(/\s+/g, '').toLowerCase();
        
        const bookData = { 
          type: targetType,
          title: cleanTitle, 
          resolution: resMatch ? Array.from(new Set(resMatch)).join(',') : "", 
          lastVol: parsedVol, 
          date: new Date().toISOString(), 
          id: Date.now() + Math.random() 
        };

        // 🚀 [최적화 1 적용] Map에서 즉시(0.0001초) 찾아냅니다.
        if (titleMap.has(normalizedNewTitle)) {
            const existingIdx = titleMap.get(normalizedNewTitle);
            currentList[existingIdx] = { ...currentList[existingIdx], ...bookData };
        } else {
            // 🚀 [최적화 2 적용] 무거운 unshift 대신 가벼운 push 사용
            newBooks.push(bookData);
            // 6만 건의 새 데이터 안에서 중복이 발생할 수도 있으니 Map에도 등록
            titleMap.set(normalizedNewTitle, -1); 
        }
      });

      // 🚀 [최적화 3] 마지막에 배열 합치기
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
        if (!newTitle) { alert('❌ 제목은 비워둘 수 없습니다!'); return; }

        list[idx] = { 
            ...list[idx], 
            type: row.querySelector('.edit-type').value, 
            title: newTitle, 
            resolution: row.querySelector('.edit-res').value.trim(), 
            lastVol: row.querySelector('.edit-vol').value.trim(),
            date: new Date().toISOString() 
        };
        saveWithUndo(list, '✅ 수정이 완료되었습니다.');
      }
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
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            const targetId = e.target.getAttribute('data-target');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');

            if (targetId === 'tab-history') {
                loadReleaseHistory();
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

    chrome.storage.local.get({ lastBackup: null, sortOption: 'id_desc' }, (data) => {
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) sortSelect.value = data.sortOption;

        renderList(); 
        renderSites(); 
        renderFilters(); 

        const timeSpan = document.getElementById('lastBackupTime');
        if (timeSpan) {
            if (data.lastBackup) {
                timeSpan.innerText = `최근 백업: ${data.lastBackup}`;
            } else {
                timeSpan.innerText = `최근 백업: 기록 없음`;
            }
        }
    });

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
              alert('이미 등록된 사이트입니다.');
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
                        alert('이미 등록된 금지어입니다.');
                    }
                });
            }
        };
    }

    const searchInput = document.getElementById('searchInput');
    let searchDebounceTimer;
    if (searchInput) {
        searchInput.oninput = (e) => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                renderList(e.target.value);
            }, 300);
        };
    }

    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.onchange = (e) => {
            chrome.storage.local.set({ sortOption: e.target.value }, () => {
                const filter = searchInput ? searchInput.value : '';
                renderList(filter);
            });
        };
    }

    initVersionCheck();

    const uiCheckbox = document.getElementById('showDownloadUICheckbox');
    const confirmCheckbox = document.getElementById('autoConfirmCheckbox');
    const folderCheckbox = document.getElementById('autoFolderCheckbox'); // 💡 신규 추가

    // 💡 옵션값 로드 (autoFolder 추가)
    chrome.storage.local.get({ showDownloadUI: true, autoConfirm: true, autoFolder: true }, (data) => {
        if (uiCheckbox) uiCheckbox.checked = data.showDownloadUI;
        if (confirmCheckbox) confirmCheckbox.checked = data.autoConfirm;
        if (folderCheckbox) folderCheckbox.checked = data.autoFolder; 
    });
    
    // 💡 옵션값 변경 시 저장 로직
    if (uiCheckbox) {
        uiCheckbox.addEventListener('change', (e) => {
            chrome.storage.local.set({ showDownloadUI: e.target.checked });
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
});

function initVersionCheck() {
  const manifest = chrome.runtime.getManifest();
  const currentVersion = manifest.version;
  const versionSpan = document.getElementById('current-version');
  if (versionSpan) versionSpan.textContent = "v" + currentVersion;

  const updateLink = document.getElementById('update-link');
  const manualBtn = document.getElementById('manual-check-btn');
  const statusMsg = document.getElementById('update-status-msg');
  
  const GITHUB_RAW_URL = "https://raw.githubusercontent.com/dongkkase/Chrome_Library_Management/main/version.json";

  const checkVersion = (isManual = false) => {
    if (isManual && statusMsg) {
      statusMsg.textContent = "⏳ 확인 중...";
      statusMsg.style.color = "#6c757d";
      statusMsg.style.display = "inline-block";
      if (updateLink) updateLink.style.display = "none";
    }

    chrome.storage.local.get(['lastVersionCheckTime', 'latestVersionInfo'], async (data) => {

      const now = Date.now();
      const updateInterval = 2 * 60 * 60 * 1000; 
      let latestData = data.latestVersionInfo;
      const shouldFetch = isManual || !data.lastVersionCheckTime || (now - data.lastVersionCheckTime > updateInterval);

      if (shouldFetch) {
        try {
          const response = await fetch(GITHUB_RAW_URL + "?t=" + now); 
          if (response.ok) {
            latestData = await response.json();
            chrome.storage.local.set({
              lastVersionCheckTime: now,
              latestVersionInfo: latestData
            });
          } else {
            throw new Error("서버 응답 오류");
          }
        } catch (error) {
          console.log("버전 체크 실패:", error);
          if (isManual && statusMsg) {
            statusMsg.textContent = "⚠️ 확인 실패 (인터넷 연결 오류)";
            statusMsg.style.color = "#dc3545";
            setTimeout(() => statusMsg.style.display = "none", 3000);
          }
          return;
        }
      }

      if (latestData && latestData.latest_version) {
        if (currentVersion !== latestData.latest_version) {
          if (updateLink) {
            updateLink.style.display = 'inline-block';
            updateLink.textContent = `📥 최신 파일 받기 (v${latestData.latest_version})`;
            
            updateLink.onclick = (e) => {
                e.preventDefault(); 
                
                const zipUrl = `https://github.com/dongkkase/Chrome_Library_Management/releases/download/v${latestData.latest_version}/libmanagement.zip`;             
                
                chrome.downloads.download({ url: zipUrl }, () => {
                    alert(`📥 [v${latestData.latest_version}] 업데이트 파일(.zip) 다운로드가 시작되었습니다!\n\n[수동 업데이트 방법]\n1. 다운로드된 압축 파일을 풉니다.\n2. 기존 확장프로그램 폴더에 파일들을 모두 덮어씌웁니다.\n3. 크롬 '확장프로그램 관리(chrome://extensions)' 페이지에서 [↻ 새로고침] 버튼을 누르면 적용됩니다.`);
                });
            };
          }
          if (statusMsg) statusMsg.style.display = "none";
        } else {
          if (updateLink) updateLink.style.display = "none";
          if (isManual && statusMsg) {
            statusMsg.textContent = "✅ 최신 버전입니다.";
            statusMsg.style.color = "#28a745";
            setTimeout(() => statusMsg.style.display = "none", 3000); 
          }
        }
      }
    });
  };

  checkVersion(false);

  if (manualBtn) {
    manualBtn.addEventListener('click', () => {
      checkVersion(true);
    });
  }
}