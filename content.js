// 👇 [사이트 분리 로직] 사이트별로 허용할 다운로드 모듈을 제한합니다.
const PRE_DEFINED_SITES = [
{ 
    url: "tcafe21.com", 
    selector: ".board-hot-posts, #fboardlist",
    thumbSelector: "img", 
    excludeThumbSelector: ".board-thumbnail",
    allowedDLs: ["giga", "gofile", "transfer"],
    autoConfirmKeywords: ["포인트", "열람"], 
    
    // 💡 기존 getHighResUrl 대신 아래의 getHighResUrlAsync 함수로 교체합니다.
    getHighResUrlAsync: async (thumb) => {
        const link = thumb.closest('a');
        if (!link || !link.href) return "";

        // 이미 가져온 주소가 있다면 캐시된 주소 반환 (네트워크 중복 요청 방지)
        if (thumb.dataset.cachedHighRes) return thumb.dataset.cachedHighRes;

        try {
            // 백그라운드에서 해당 게시글 페이지를 몰래 불러옵니다.
            const res = await fetch(link.href);
            const html = await res.text();
            
            // HTML을 분석하여 본문(.view-content)의 첫 번째 이미지를 찾습니다.
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const viewContent = doc.querySelector('.view-content');
            
            if (viewContent) {
                const firstImg = viewContent.querySelector('img');
                if (firstImg) {
                    // 상대 경로일 수 있으므로 절대 경로로 변환
                    const absoluteUrl = new URL(firstImg.getAttribute('src'), link.href).href;
                    thumb.dataset.cachedHighRes = absoluteUrl; // 캐시에 저장
                    return absoluteUrl;
                }
            }
        } catch (error) {
            console.error("고화질 썸네일 추출 실패:", error);
        }
        return "";
    },
    // 👇 이전 질문에서 추가하셨던 customCss는 그대로 유지하세요!
    customCss: `
        .well { 
            position: fixed !important; 
            z-index: 9000 !important; 
            bottom: 0 !important; 
            border-radius: 10px !important; 
            padding: 20px !important; 
            left: 50% !important;
            transform: translateX(-50%) !important;
            width: 95% !important;
            max-width: 1200px !important;
            background: rgba(255, 255, 255, 0.95) !important;
            box-shadow: 0 -5px 15px rgba(0,0,0,0.15) !important;
            backdrop-filter: blur(5px) !important;
        }
        body { padding-bottom: 120px !important; }
    `
  },
  { url: "ridibooks.com", selector: ".infinite-scroll-component", allowedDLs: [] },
  { url: "enterjoy.day", selector: ".list-board", allowedDLs: ["giga", "gofile"] }, 
  { 
    url: "hellkaiv.net", 
    selector: "#gall_ul", 
    autoConfirmKeywords: ["링크", "발급"], 
    allowedDLs: ["giga", "gofile", "hk"] 
  },
  { 
    url: "amazon.co.jp", 
    selector: ".a-carousel-card, div[data-asin], .s-result-item, #gridItemRoot, .a-cardui", 
    allowedDLs: [] 
  },
  { url: "example.com", selector: "#board_list", allowedDLs: [] }
];

let globalAllowedDLs = [];
let globalTargetSelector = 'a';
let globalDetailSelector = ''; 
let globalCustomCss = '';

let isTargetSite = false;
let exactMatchCache = {};
let cachedBookList = [];
let isDataLoaded = false;

let similarityCache = {};
let lastRightClickedLink = null; 
let lastRightClickedElement = null; 

let isDownloadUIEnabled = true; 

function initDataCache(data) {
    isDownloadUIEnabled = data.showDownloadUI !== false; 

    const hostname = window.location.hostname;
    let config = PRE_DEFINED_SITES.find(s => hostname.includes(s.url));
    const userSites = Array.isArray(data.allowedSites) ? data.allowedSites : [];
    const matchedUserSite = userSites.find(s => {
        const sUrl = typeof s === 'string' ? s : s.url;
        return hostname.includes(sUrl);
    });

    if (config) {
        isTargetSite = true;
        globalAllowedDLs = config.allowedDLs || [];
        globalTargetSelector = config.selector || 'a'; 
        globalCustomCss = config.customCss || '';
    } else if (matchedUserSite) {
        isTargetSite = true;
        globalAllowedDLs = ["giga", "gofile"]; 
        globalTargetSelector = 'a'; 
        globalCustomCss = matchedUserSite.customCss || '';
    } else {
        isTargetSite = false;
        globalAllowedDLs = [];
    }

    globalDetailSelector = (matchedUserSite && typeof matchedUserSite === 'object' && matchedUserSite.detailSelector) 
        ? matchedUserSite.detailSelector : (config && config.detailSelector ? config.detailSelector : '');

    exactMatchCache = {};
    similarityCache = {}; 

    cachedBookList = (Array.isArray(data.bookList) ? data.bookList : []).map(b => {
        const processedOriginal = b.title.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim();
        const processedNoSpace = processedOriginal.replace(/\s+/g, ''); 
        const enhanced = { ...b, _regBodyOriginal: processedOriginal, _regBodyNoSpace: processedNoSpace };
        
        if(!exactMatchCache[processedNoSpace]) exactMatchCache[processedNoSpace] = enhanced;
        return enhanced;
    });

    isDataLoaded = true;
}

function getOrCreateHoverContainer() {
  let container = document.getElementById('book-manager-hover-preview');
  if (!container) {
    const style = document.createElement('style');
    style.textContent = "@keyframes bmMgrSpin { 0% { transform: translate(-50%, -50%) rotate(0deg); } 100% { transform: translate(-50%, -50%) rotate(360deg); } }";
    document.head.appendChild(style);

    container = document.createElement('div');
    container.id = 'book-manager-hover-preview';
    container.style.cssText = "position: fixed; z-index: 9999999; display: none; max-width: 350px; max-height: 500px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); background: #111; overflow: hidden; pointer-events: none;";
    
    const previewImg = document.createElement('img');
    previewImg.id = 'book-manager-hover-img';
    previewImg.style.cssText = "display: block; max-width: 350px; max-height: 500px; width: auto; height: auto; object-fit: contain; transition: filter 0.3s ease-in-out;";
    
    const spinner = document.createElement('div');
    spinner.id = 'book-manager-hover-spinner';
    spinner.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 40px; height: 40px; border: 4px solid rgba(255, 255, 255, 0.3); border-top: 4px solid #fff; border-radius: 50%; animation: bmMgrSpin 1s linear infinite; z-index: 10; display: none;";

    container.appendChild(previewImg);
    container.appendChild(spinner);
    document.body.appendChild(container);
  }
  return container;
}

function getPureLinkText(link) {
  let safeHTML = link.innerHTML.replace(/<img[^>]*>/gi, '');
  const temp = document.createElement('div');
  temp.innerHTML = safeHTML;
  const unwantedElements = temp.querySelectorAll('.count, .book-badge, .comment-badge, .bm-quick-actions');
  unwantedElements.forEach(el => el.remove());
  const walker = document.createTreeWalker(temp, NodeFilter.SHOW_COMMENT, null, false);
  let commentNode;
  const commentsToRemove = [];
  while (commentNode = walker.nextNode()) { commentsToRemove.push(commentNode); }
  commentsToRemove.forEach(node => node.remove());
  return temp.textContent.trim();
}

const levRow0 = new Int32Array(256);
const levRow1 = new Int32Array(256);

function calculateLevenshtein(s, t) {
  if (s === t) return 100;
  const n = s.length, m = t.length;
  if (n === 0 || m === 0) return 0;
  
  if (n > 250 || m > 250) return 0; 
  if (Math.max(n, m) > Math.min(n, m) * 2.5) return 0;

  for (let i = 0; i <= m; i++) levRow0[i] = i;

  for (let i = 0; i < n; i++) {
    levRow1[0] = i + 1;
    for (let j = 0; j < m; j++) {
      const cost = (s[i] === t[j]) ? 0 : 1;
      levRow1[j + 1] = Math.min(levRow1[j] + 1, levRow0[j + 1] + 1, levRow0[j] + cost);
    }
    for (let j = 0; j <= m; j++) levRow0[j] = levRow1[j];
  }
  return (1 - levRow0[m] / Math.max(n, m)) * 100;
}

function getSimilarity(regBodyOriginal, siteBodyOriginal) {
  const regBody = regBodyOriginal.replace(/\s+/g, '');
  const siteBody = siteBodyOriginal.replace(/\s+/g, '');

  if (regBody === siteBody) return 100;

  if (siteBody.length <= 2) return 0; 
  
  if (regBody.length <= 2) {
      const sim = calculateLevenshtein(regBody, siteBody);
      return sim >= 90 ? sim : 0; 
  }

  const spinOffRegex = /(외전|이어\s*원|이어원|스핀오프|앤솔로지)/; 
  const isRegSpinOff = spinOffRegex.test(regBodyOriginal);
  const isSiteSpinOff = spinOffRegex.test(siteBodyOriginal);
  if (isRegSpinOff !== isSiteSpinOff) return 0; 

  const regNumbers = regBodyOriginal.match(/\d+/g) || [];
  const siteNumbers = siteBodyOriginal.match(/\d+/g) || [];
  if (regNumbers.length > 0) {
    const hasRequiredNumbers = regNumbers.every(num => siteNumbers.includes(num));
    if (!hasRequiredNumbers) return 0; 
  }

  const isSiteIncludesReg = siteBody.includes(regBody); 
  const isRegIncludesSite = regBody.includes(siteBody); 

  if (isSiteIncludesReg || isRegIncludesSite) {
    const lengthDiff = Math.abs(regBody.length - siteBody.length);
    if (lengthDiff <= 2) return 95;
    if (lengthDiff <= 4) return 85;

    const isPrefixOrSuffix = siteBody.startsWith(regBody) || siteBody.endsWith(regBody) || regBody.startsWith(siteBody) || regBody.endsWith(siteBody);
    
    if (regBody.length >= 3 && isPrefixOrSuffix && lengthDiff <= 10) {
        return 85; 
    }

    return 75; 
  }

  return calculateLevenshtein(regBody, siteBody);
}

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
    
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 350); 
  }, 7000);
}

function showToast(book, isDelete = false) {
  let container = document.getElementById('book-manager-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'book-manager-toast-container';
    container.style.cssText = "position: fixed; bottom: 120px; left: 50%; transform: translateX(-50%); z-index: 999999; display: flex; flex-direction: column; gap: 10px; pointer-events: none;";
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  
  let typeStr = '';
  let typeColor = '';

  if (isDelete) {
      typeStr = '삭제됨';
      typeColor = '#adb5bd';
  } else if (book.type === 'exclude') {
      typeStr = '제외';
      typeColor = '#ff6b6b';
  } else if (book.type === 'incomplete') {
      typeStr = '미완';
      typeColor = '#ff922b'; 
  } else if (book.type === 'complete') {
      typeStr = '완결';
      typeColor = '#4dabf7'; 
  }

  let details = [];
  if (book.resolution && !isDelete) details.push(book.resolution);
  if (book.lastVol && !isDelete) details.push(book.lastVol + '권');
  const detailStr = details.length > 0 ? ' <span style="color:#adb5bd; font-size:12px; font-weight:normal;">(' + details.join(' | ') + ')</span>' : '';

  toast.innerHTML = '<span style="color:' + typeColor + '; margin-right:5px;">[' + typeStr + ']</span>' + book.title + detailStr;
  toast.style.cssText = "background: rgba(33, 37, 41, 0.95); color: #fff; padding: 12px 24px; border-radius: 8px; font-size: 15px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.2); opacity: 0; transform: translateY(20px); transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); white-space: nowrap; text-align: center;";
  container.appendChild(toast);

  void toast.offsetWidth;

  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    
    setTimeout(() => {
        if(toast.parentNode) toast.remove();
    }, 350);
  }, 5000);
}

// 추출된 텍스트를 바탕으로 현재 도서의 상태(미완, 완결 등)를 알아내는 함수
function getBookTypeForTitle(titleStr) {
    if (!isDataLoaded || !titleStr) return null;
    
    let siteBodyOriginal = titleStr.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim();
    let siteBodyNoSpace = siteBodyOriginal.replace(/\s+/g, '');
    
    if (exactMatchCache[siteBodyNoSpace]) {
        return exactMatchCache[siteBodyNoSpace].type;
    }
    if (similarityCache[siteBodyNoSpace] !== undefined) {
        return similarityCache[siteBodyNoSpace].book ? similarityCache[siteBodyNoSpace].book.type : null;
    }
    
    let book = null;
    let maxScore = 0;
    for (let i = 0; i < cachedBookList.length; i++) {
        const b = cachedBookList[i];
        if (Math.abs(b._regBodyNoSpace.length - siteBodyNoSpace.length) > Math.min(b._regBodyNoSpace.length, siteBodyNoSpace.length) * 2.5) continue;
        
        const score = getSimilarity(b._regBodyOriginal, siteBodyOriginal);
        if (score >= 85 && score > maxScore) { 
            maxScore = score; book = b; 
            if (score === 100) break; 
        }
    }
    similarityCache[siteBodyNoSpace] = { book, maxScore };
    return book ? book.type : null;
}

function injectDirectDownloadButtons(allowedDLs) {
    if (!allowedDLs || allowedDLs.length === 0) return;

    let regexParts = [];
    if (allowedDLs.includes('giga')) regexParts.push('gigafile\\.nu|xgf\\.nu');
    if (allowedDLs.includes('gofile')) regexParts.push('gofile\\.io');
    if (allowedDLs.includes('hk')) regexParts.push('hellkdis\\.net\\/s\\/|hellkaiv\\.net\\/s\\/');
    if (allowedDLs.includes('transfer')) regexParts.push('transfer\\.it\\/s\\/|transfer\\.it\\/t\\/'); // 💡 Transfer.it 정규식 추가

    if (regexParts.length === 0) return;
    
    let regexStr = "(https?:\\/\\/(?:[a-zA-Z0-9-]+\\.)?(?:";
    regexStr += regexParts.join('|');
    regexStr += ")[^\\s\"'<>]+)";
    const targetRegex = new RegExp(regexStr, "i");

    function extractTargetBookTitle(element) {
        if (typeof globalDetailSelector !== 'undefined' && globalDetailSelector) {
            const detailEl = document.querySelector(globalDetailSelector);
            if (detailEl) {
                const temp = document.createElement('div');
                temp.innerHTML = detailEl.innerHTML.replace(/<img[^>]*>/gi, '');
                temp.querySelectorAll('.bm-quick-actions, .book-badge, button, .auto-dl-btn').forEach(e => e.remove());
                let title = cleanSiteTitle(temp.textContent);
                if (title && title.length > 1) return title;
            }
        }

        let container = element.closest('.bsx-body, tr, li, td, .list-item, div.item, .bo_v_atc') || element.parentElement;
        if (container) {
            const temp = document.createElement('div');
            temp.innerHTML = container.innerHTML.replace(/<img[^>]*>/gi, '');
            temp.querySelectorAll('.bm-quick-actions, .book-badge, .auto-dl-btn, button, .count').forEach(e => e.remove());
            let rawText = temp.textContent.replace(/탭열기|다운로드\s*링크\s*발급|복사|제외|미완|완결|삭제|검색/gi, ' ').replace(/\s+/g, ' ').trim();
            let title = cleanSiteTitle(rawText);
            if (title && title.length > 1) return title;
        }

        let pageTitle = document.title.split(/[-|]/)[0]; 
        return cleanSiteTitle(pageTitle) || "알수없는제목";
    }

    function extractPassword(element) {
        let targets = [
            element,
            element.parentElement,
            element.parentElement ? element.parentElement.parentElement : null,
            element.closest('.bsx-body, .list-board, .bo_v_atc, td, tr, div, section')
        ];
        
        for (let t of targets) {
            if (!t) continue;
            let text = t.textContent || "";
            let match = text.match(/(?:비밀번호|비번|pw|pass|password|암호)[\s:;\|"'\>]*([a-zA-Z0-9]{4,})/i);
            if (match) return match[1].trim();
            
            let inputs = Array.from(t.querySelectorAll('input[type="text"], input[type="password"]'));
            let urlInputIdx = inputs.findIndex(i => targetRegex.test(i.value));
            if (urlInputIdx > -1 && urlInputIdx + 1 < inputs.length) return inputs[urlInputIdx + 1].value.trim();
        }
        return "";
    }

    function createButton(insertAfterElement, url, pw, targetType, bookTitle) {
        if (insertAfterElement.nextElementSibling && insertAfterElement.nextElementSibling.classList.contains('auto-dl-btn')) return;
        
        const autoBtn = document.createElement('a');
        autoBtn.href = "#";
        autoBtn.className = "auto-dl-btn";
        
        let btnText = "⚡ 바로다운로드";
        let bgColor = "#17a2b8";
        
        if (targetType === 'HELLKDIS') {
            bgColor = "#6f42c1"; 
        } else if (targetType === 'TRANSFERIT') {
            bgColor = "#dc3545"; // 💡 Transfer.it 전용 색상 (빨간색 계열)
        }

        autoBtn.innerHTML = btnText;
        autoBtn.style.cssText = `display:inline-block; padding:3px 10px; margin-left:5px; background-color:${bgColor}; color:white; border-radius:3px; text-decoration:none; font-size:12px; font-weight:bold; cursor:pointer; vertical-align:middle; transition: background 0.2s;`;
        
        autoBtn.onclick = (e) => {
            e.preventDefault();
            
            if (targetType === 'HELLKDIS' && !pw) {
                showInfoToast("⚠️ 비밀번호 자동 추출 실패. 페이지가 열리면 수동으로 입력해주세요.", true);
                try { chrome.runtime.sendMessage({ action: "OPEN_HELLKDIS_WITH_PW", url: url, password: "" }).catch(()=>{}); } 
                catch(err) { showInfoToast("⚠️ 확장프로그램이 업데이트 되었습니다. 새로고침(F5) 해주세요.", true); }
                return;
            }

            autoBtn.innerHTML = "⏳ 요청 중...";
            autoBtn.style.backgroundColor = "#6c757d";
            autoBtn.style.pointerEvents = "none";
            
            const platformName = targetType === 'GOFILE' ? 'Gofile' : (targetType === 'HELLKDIS' ? 'Hellkdis' : (targetType === 'TRANSFERIT' ? 'Transfer.it' : 'Gigafile'));
            showInfoToast(`🚀 ${platformName} 서버로 직접 다운로드를 요청합니다...`);
            
            try {
                let finalTitle = bookTitle;
                let bType = getBookTypeForTitle(bookTitle);
                
                if (bType === 'incomplete') {
                    finalTitle = "(미완)" + bookTitle;
                }

                chrome.runtime.sendMessage({ action: "DOWNLOAD_" + targetType, url: url, password: pw, title: finalTitle }).catch(()=>{});
            } catch (err) {
                showInfoToast("⚠️ 확장프로그램이 새로고침 되었습니다. 현재 페이지를 새로고침(F5) 해주세요!", true);
            }

            setTimeout(() => {
                autoBtn.innerHTML = btnText;
                autoBtn.style.backgroundColor = bgColor;
                autoBtn.style.pointerEvents = "auto";
            }, 50000); 
        };
        
        insertAfterElement.insertAdjacentElement('afterend', autoBtn);
    }

    document.querySelectorAll('a').forEach(link => {
        if (link.nextElementSibling && link.nextElementSibling.classList.contains('auto-dl-btn')) return;
        if (link.classList.contains('auto-dl-btn')) return;
        if (link.children.length > 2 || link.querySelector('img')) return;

        let url = "";
        if (link.href && targetRegex.test(link.href)) {
            url = link.href;
        } else {
            let textMatch = (link.textContent || "").match(targetRegex);
            if (textMatch) url = textMatch[1];
        }

        if (url) {
            let targetType = "";
            let isHk = url.includes('hellkdis.net/s/') || url.includes('hellkaiv.net/s/');
            
            if (allowedDLs.includes('hk') && isHk) targetType = "HELLKDIS";
            else if (allowedDLs.includes('gofile') && url.includes('gofile.io')) targetType = "GOFILE";
            else if (allowedDLs.includes('giga') && (url.includes('gigafile') || url.includes('xgf'))) targetType = "GIGAFILE";
            else if (allowedDLs.includes('transfer') && url.includes('transfer.it')) targetType = "TRANSFERIT"; // 💡 판별 추가

            if(targetType){
                let pw = extractPassword(link);
                let titleStr = extractTargetBookTitle(link);
                createButton(link, url, pw, targetType, titleStr);
            }
        }
    });

    const specialBtns = Array.from(document.querySelectorAll('a, button, span, div')).filter(el => {
        let t = el.textContent.trim();
        if (t !== '탭열기' && t !== '다운로드 링크 발급') return false;
        let hasInnerMatch = Array.from(el.children).some(child => {
            let ct = child.textContent.trim();
            return ct === '탭열기' || ct === '다운로드 링크 발급';
        });
        return !hasInnerMatch;
    });

    specialBtns.forEach(btn => {
        if (btn.nextElementSibling && btn.nextElementSibling.classList.contains('auto-dl-btn')) return;

        let container = btn.closest('.bsx-body, tr, li, td, p, div') || btn.parentElement;
        if (!container) return;

        let url = "";
        let allInputs = Array.from(container.querySelectorAll('input'));
        let foundInput = allInputs.find(i => targetRegex.test(i.value) || (i.getAttribute('value') && targetRegex.test(i.getAttribute('value'))));
        
        if (foundInput) url = foundInput.value || foundInput.getAttribute('value');
        else {
            let textMatch = container.textContent.match(targetRegex);
            if (textMatch) url = textMatch[1];
        }

        if (url) {
            let targetType = "";
            let isHk = url.includes('hellkdis.net/s/') || url.includes('hellkaiv.net/s/');
            
            if (allowedDLs.includes('hk') && isHk) targetType = "HELLKDIS";
            else if (allowedDLs.includes('gofile') && url.includes('gofile.io')) targetType = "GOFILE";
            else if (allowedDLs.includes('giga') && (url.includes('gigafile') || url.includes('xgf'))) targetType = "GIGAFILE";
            else if (allowedDLs.includes('transfer') && url.includes('transfer.it')) targetType = "TRANSFERIT"; // 💡 판별 추가

            if(targetType){
                let pw = extractPassword(btn);
                let titleStr = extractTargetBookTitle(btn);
                createButton(btn, url, pw, targetType, titleStr);
            }
        }
    });
}

function removeBadge(link) {
    if (link.style.textDecoration || link.querySelector('.book-badge')) {
        link.style.removeProperty("text-decoration");
        link.style.removeProperty("color");
        link.style.removeProperty("opacity");
        link.style.removeProperty("font-weight");
        link.style.removeProperty("background-color");
        link.style.removeProperty("padding");
        link.style.removeProperty("border-radius");
        link.removeAttribute("title");
        
        const badge = link.querySelector('.book-badge');
        if (badge) badge.remove();
    }
}

function createQuickActions(linkData, hasBook) {
    const container = document.createElement('span');
    container.className = 'bm-quick-actions';
    container.style.cssText = "display: inline-flex; gap: 4px; margin-left: 8px; vertical-align: middle;";

    const btnStyle = "padding: 2px 5px; font-size: 11px; font-weight: bold; border-radius: 4px; cursor: pointer; color: white; border: none; text-decoration: none; line-height: 1.2; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: all 0.2s;";
    
    const buttons = [
        { label: '복사', color: '#845ef7', action: 'copy' },
        { label: '제외', color: '#ff6b6b', action: 'exclude' },
        { label: '미완', color: '#ff922b', action: 'incomplete' },
        { label: '완결', color: '#4dabf7', action: 'complete' },
        { label: '삭제', color: '#868e96', action: 'delete', display: hasBook }, 
        { label: '구글검색', color: '#20c997', action: 'search' },
        { label: '리디검색', color: '#1e90ff', action: 'ridi_preview' },
    ];

    buttons.forEach(btnInfo => {
        if (btnInfo.display === false) return;

        const btn = document.createElement('button');
        btn.textContent = btnInfo.label;
        btn.style.cssText = btnStyle + `background-color: ${btnInfo.color};`;
        
        btn.onmouseover = () => btn.style.transform = 'translateY(-1px)';
        btn.onmouseout = () => btn.style.transform = 'translateY(0)';
        
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            try {
                if (btnInfo.action === 'copy') {
                    const titleToCopy = linkData.pureTitle || (typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText);
                    
                    navigator.clipboard.writeText(titleToCopy).then(() => {
                        const originalText = btn.textContent;
                        const originalColor = btn.style.backgroundColor;
                        btn.textContent = '복사됨!';
                        btn.style.backgroundColor = '#20c997'; 
                        setTimeout(() => {
                            btn.textContent = originalText;
                            btn.style.backgroundColor = originalColor;
                        }, 1500);
                    });
                    return;
                }

                if (btnInfo.action === 'search' || btnInfo.action === 'ridi_preview') {
                    // 리디 검색의 경우 백그라운드 통신에 약간의 시간이 소요되므로 로딩 이모지를 띄워줍니다.
                    if (btnInfo.action === 'ridi_preview') {
                        const originalText = btn.textContent;
                        btn.textContent = '⏳';
                        btn.style.pointerEvents = 'none';
                        setTimeout(() => { 
                            btn.textContent = originalText; 
                            btn.style.pointerEvents = 'auto';
                        }, 2500);
                    }

                    chrome.runtime.sendMessage({ 
                        action: "QUICK_ACTION", 
                        type: btnInfo.action,
                        cleanTitle: typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText
                    }).catch(()=>{});
                } else {
                    chrome.runtime.sendMessage({ 
                        action: "QUICK_ACTION", 
                        type: btnInfo.action,
                        cleanTitle: typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText,
                        resolution: linkData.siteRes ? linkData.siteRes + "px" : "",
                        lastVol: linkData.siteVol ? linkData.siteVol.toString() : ""
                    }).catch(()=>{});
                    
                    linkData.raw = null; 
                    setTimeout(debouncedApplyStyles, 100);
                }
            } catch (err) {}
        };
        container.appendChild(btn);
    });

    return container;
}

function applyStyleToSingleLink(link) {
    const currentRawText = link.textContent || "";
    
    if (!link._bmData || link._bmData.raw !== currentRawText) {
        const originalText = getPureLinkText(link);
        const pureTitle = typeof cleanSiteTitle === 'function' ? cleanSiteTitle(originalText) : originalText;
        
        if (pureTitle.length < 2 || /^[ㄱ-ㅎㅏ-ㅣ\s]+$/.test(pureTitle)) {
            link._bmData = { skip: true, raw: currentRawText };
        } else {
            const siteBodyOriginal = pureTitle.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim();
            const siteBodyNoSpace = siteBodyOriginal.replace(/\s+/g, '');
            
            const siteResMatch = originalText.match(/(\d{3,4})\s*px/i);
            const siteRes = siteResMatch ? parseInt(siteResMatch[1], 10) : 0;
            
            let siteVol = 0;
            const rangeMatch = originalText.match(/(\d+)\s*(?:권|화|부(?!터))?\s*[~-]\s*(\d+)/);
            const singleMatch = originalText.match(/(\d+)\s*(?:권|화|부(?!터))/);
            const lastNumMatch = originalText.match(/(\d+)\s*(?=[\[\(]|$)/);
            if (rangeMatch) siteVol = parseInt(rangeMatch[2], 10);
            else if (singleMatch) siteVol = parseInt(singleMatch[1], 10);
            else if (lastNumMatch) siteVol = parseInt(lastNumMatch[1], 10);

            link._bmData = { skip: false, siteBodyOriginal, siteBodyNoSpace, siteRes, siteVol, raw: currentRawText, originalText };
        }
    }

    if (link._bmData.skip) {
        removeBadge(link);
        return;
    }

    const { siteBodyOriginal, siteBodyNoSpace, siteRes, siteVol } = link._bmData;
    
    let book = null;
    let maxScore = 0;
    
    if (exactMatchCache[siteBodyNoSpace]) {
        book = exactMatchCache[siteBodyNoSpace];
        maxScore = 100;
    } else if (similarityCache[siteBodyNoSpace] !== undefined) {
        book = similarityCache[siteBodyNoSpace].book;
        maxScore = similarityCache[siteBodyNoSpace].maxScore;
    } else {
        for (let i = 0; i < cachedBookList.length; i++) {
            const b = cachedBookList[i];
            
            if (Math.abs(b._regBodyNoSpace.length - siteBodyNoSpace.length) > Math.min(b._regBodyNoSpace.length, siteBodyNoSpace.length) * 2.5) continue;
            
            const score = getSimilarity(b._regBodyOriginal, siteBodyOriginal);
            if (score >= 85 && score > maxScore) { 
                maxScore = score; 
                book = b; 
                if (score === 100) break; 
            }
        }
        similarityCache[siteBodyNoSpace] = { book, maxScore }; 
    }
    
    let badgeStyle = '';
    let newBadgeHTML = '';

    if (book) {
        const regRes = book.resolution ? parseInt(book.resolution.replace(/[^0-9]/g, ''), 10) : 0;
        const regVol = book.lastVol ? parseInt(book.lastVol, 10) : 0;
        const displayScore = Math.round(maxScore);
        
        const resText = book.resolution || '-';
        const volText = book.lastVol ? book.lastVol + '권' : '-';

        link.style.removeProperty("background-color");
        link.style.removeProperty("padding");
        link.style.removeProperty("border-radius");
        link.style.removeProperty("text-decoration");
        link.style.removeProperty("color");
        link.style.removeProperty("opacity");
        link.style.removeProperty("font-weight");

        if (book.type === "exclude") {
          link.style.setProperty("text-decoration", "line-through", "important");
          link.style.setProperty("color", "#aaaaaa", "important");
          link.style.setProperty("font-weight", "normal", "important");
          link.style.setProperty("opacity", "0.5", "important");
          link.setAttribute("title", "[제외됨] " + book.title + " (매칭률: " + displayScore + "%)");
          
          newBadgeHTML = '<span style="color:#999;">' + resText + '</span>' + 
                         '<span style="color:#ccc;"> | </span>' + 
                         '<span style="color:#999;">' + volText + '</span>' + 
                         '<span style="color:#adb5bd;font-size:9px;margin-left:4px;" title="매칭률">(' + displayScore + '%)</span>';
          
          badgeStyle = "font-size:10px; background:#f8f9fa; border:1px solid #dee2e6; padding:2px 4px; border-radius:3px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2;";

        } else if (book.type === "incomplete") {
          const isResUp = siteRes > regRes && regRes > 0;
          const isVolUp = siteVol > regVol && regVol > 0;
          const hasUpgrade = isResUp || isVolUp;

          link.style.setProperty("text-decoration", "none", "important");
          link.style.setProperty("color", "#d9480f", "important"); 
          link.style.setProperty("font-weight", "800", "important");
          link.style.setProperty("opacity", "1", "important");
          link.setAttribute("title", "[미완] " + book.title + " (" + displayScore + "%)");
          
          let resHtml = isResUp 
              ? '<span style="color:#ffc107; font-weight:900;">' + resText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px; vertical-align:middle; line-height:1;">UP</b></span>'
              : '<span style="color:#ffffff; font-weight:bold;">' + resText + '</span>';
              
          let volHtml = isVolUp 
              ? '<span style="color:#ffc107; font-weight:900;">' + volText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px; vertical-align:middle; line-height:1;">UP</b></span>'
              : '<span style="color:#ffffff; font-weight:bold;">' + volText + '</span>';
          
          newBadgeHTML = resHtml + 
                         '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + 
                         volHtml + 
                         '<span style="color:rgba(255,255,255,0.8);font-size:9px;margin-left:4px;" title="매칭률">(' + displayScore + '%)</span>';
          
          let shadow = hasUpgrade ? "box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);" : "box-shadow: 0 1px 2px rgba(0,0,0,0.2);";
          badgeStyle = "font-size:10px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2; " + shadow;

        } else if (book.type === "complete") {
          const isResUp = siteRes > regRes && regRes > 0;
          const isVolUp = siteVol > regVol && regVol > 0;
          const hasUpgrade = isResUp || isVolUp;

          link.style.setProperty("text-decoration", "none", "important");
          link.style.setProperty("opacity", "1", "important");
          link.setAttribute("title", "[완결] " + book.title + " (" + displayScore + "%)");
          
          if (hasUpgrade) {
              link.style.setProperty("color", "#d9480f", "important"); 
              link.style.setProperty("font-weight", "800", "important");
              
              let resHtml = isResUp 
                  ? '<span style="color:#ffc107; font-weight:900;">' + resText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px; vertical-align:middle; line-height:1;">UP</b></span>'
                  : '<span style="color:#ffffff; font-weight:bold;">' + resText + '</span>';
                  
              let volHtml = isVolUp 
                  ? '<span style="color:#ffc107; font-weight:900;">' + volText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px; vertical-align:middle; line-height:1;">UP</b></span>'
                  : '<span style="color:#ffffff; font-weight:bold;">' + volText + '</span>';
              
              newBadgeHTML = resHtml + 
                             '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + 
                             volHtml + 
                             '<span style="color:rgba(255,255,255,0.8);font-size:9px;margin-left:4px;" title="매칭률">(' + displayScore + '%)</span>';
              
              badgeStyle = "font-size:10px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2; box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);";
                           
} else {
              link.style.setProperty("color", "#0056b3", "important"); 
              link.style.setProperty("font-weight", "600", "important");
              
              let resHtml = '<span style="color:#007bff; font-weight:normal;">' + resText + '</span>';
              let volHtml = '<span style="color:#007bff; font-weight:normal;">' + volText + '</span>';
              
              newBadgeHTML = resHtml + 
                             '<span style="color:#007bff; opacity:0.5; margin:0 4px;">|</span>' + 
                             volHtml + 
                             '<span style="color:#868e96;font-size:9px;margin-left:4px;" title="매칭률">(' + displayScore + '%)</span>';
              
              badgeStyle = "font-size:10px; background:#f0f7ff; border:1px solid #007bff; padding:2px 4px; border-radius:3px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2;";
          }
        }
    } else {
        removeBadge(link);
    }

    const existingBadge = link.querySelector('.book-badge');
    if (newBadgeHTML) {
        if (!existingBadge || existingBadge.dataset.html !== newBadgeHTML) {
            if (existingBadge) existingBadge.remove();
            const badge = document.createElement('span');
            badge.className = 'book-badge';
            badge.style.cssText = badgeStyle;
            badge.innerHTML = newBadgeHTML;
            badge.dataset.html = newBadgeHTML;
            link.appendChild(badge);
        }
    } else if (existingBadge) {
        existingBadge.remove();
    }
}

function applyStyleToDetailElement(el) {
    const currentRawText = el.textContent || "";
    
    if (!el._bmDetailData || el._bmDetailData.raw !== currentRawText) {
        const originalText = getPureLinkText(el);
        const pureTitle = typeof cleanSiteTitle === 'function' ? cleanSiteTitle(originalText) : originalText;
        
        if (pureTitle.length < 2 || /^[ㄱ-ㅎㅏ-ㅣ\s]+$/.test(pureTitle)) {
            el._bmDetailData = { skip: true, raw: currentRawText };
        } else {
            const siteBodyOriginal = pureTitle.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim();
            const siteBodyNoSpace = siteBodyOriginal.replace(/\s+/g, '');
            
            const siteResMatch = originalText.match(/(\d{3,4})\s*px/i);
            const siteRes = siteResMatch ? parseInt(siteResMatch[1], 10) : 0;
            
            let siteVol = 0;
            const rangeMatch = originalText.match(/(\d+)\s*(?:권|화|부(?!터))?\s*[~-]\s*(\d+)/);
            const singleMatch = originalText.match(/(\d+)\s*(?:권|화|부(?!터))/);
            const lastNumMatch = originalText.match(/(\d+)\s*(?=[\[\(]|$)/);
            if (rangeMatch) siteVol = parseInt(rangeMatch[2], 10);
            else if (singleMatch) siteVol = parseInt(singleMatch[1], 10);
            else if (lastNumMatch) siteVol = parseInt(lastNumMatch[1], 10);

            el._bmDetailData = { skip: false, pureTitle, siteBodyOriginal, siteBodyNoSpace, siteRes, siteVol, raw: currentRawText, originalText };
        }
    }

    if (el._bmDetailData.skip) {
        removeBadge(el);
        const act = el.querySelector('.bm-quick-actions');
        if (act) act.remove(); 
        return;
    }

    el.style.setProperty("white-space", "normal", "important");
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("text-overflow", "clip", "important");
    el.style.setProperty("word-break", "break-all", "important");
    el.style.setProperty("height", "auto", "important");
    
    if (window.getComputedStyle(el).display === 'inline') {
        el.style.setProperty("display", "inline-block", "important");
    }

    const { siteBodyOriginal, siteBodyNoSpace, siteRes, siteVol } = el._bmDetailData;
    let book = null;
    let maxScore = 0;
    
    if (exactMatchCache[siteBodyNoSpace]) {
        book = exactMatchCache[siteBodyNoSpace];
        maxScore = 100;
    } else if (similarityCache[siteBodyNoSpace] !== undefined) {
        book = similarityCache[siteBodyNoSpace].book;
        maxScore = similarityCache[siteBodyNoSpace].maxScore;
    } else {
        for (let i = 0; i < cachedBookList.length; i++) {
            const b = cachedBookList[i];
            if (Math.abs(b._regBodyNoSpace.length - siteBodyNoSpace.length) > Math.min(b._regBodyNoSpace.length, siteBodyNoSpace.length) * 2.5) continue;
            
            const score = getSimilarity(b._regBodyOriginal, siteBodyOriginal);
            if (score >= 85 && score > maxScore) { 
                maxScore = score; book = b; 
                if (score === 100) break; 
            }
        }
        similarityCache[siteBodyNoSpace] = { book, maxScore }; 
    }
    
    let badgeStyle = '';
    let newBadgeHTML = '';

    if (book) {
        const regRes = book.resolution ? parseInt(book.resolution.replace(/[^0-9]/g, ''), 10) : 0;
        const regVol = book.lastVol ? parseInt(book.lastVol, 10) : 0;
        const displayScore = Math.round(maxScore);
        const resText = book.resolution || '-';
        const volText = book.lastVol ? book.lastVol + '권' : '-';

        el.style.removeProperty("background-color");
        el.style.removeProperty("padding");
        el.style.removeProperty("border-radius");
        el.style.removeProperty("text-decoration");
        el.style.removeProperty("color");
        el.style.removeProperty("opacity");
        el.style.removeProperty("font-weight");

        if (book.type === "exclude") {
          el.style.setProperty("text-decoration", "line-through", "important");
          el.style.setProperty("color", "#aaaaaa", "important");
          el.style.setProperty("opacity", "0.5", "important");
          newBadgeHTML = '<span style="color:#999;">' + resText + '</span><span style="color:#ccc;"> | </span><span style="color:#999;">' + volText + '</span><span style="color:#adb5bd;font-size:9px;margin-left:4px;" title="매칭률">(' + displayScore + '%)</span>';
          badgeStyle = "font-size:11px; font-weight:bold; background:#f8f9fa; border:1px solid #dee2e6; padding:2px 5px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2; text-decoration:none !important; opacity:1 !important;";
        } else if (book.type === "incomplete") {
          const hasUpgrade = (siteRes > regRes && regRes > 0) || (siteVol > regVol && regVol > 0);
          el.style.setProperty("text-decoration", "none", "important");
          el.style.setProperty("color", "#d9480f", "important"); 
          el.style.setProperty("font-weight", "800", "important");
          let resHtml = (siteRes > regRes && regRes > 0) ? '<span style="color:#ffc107; font-weight:900;">' + resText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + resText + '</span>';
          let volHtml = (siteVol > regVol && regVol > 0) ? '<span style="color:#ffc107; font-weight:900;">' + volText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + volText + '</span>';
          newBadgeHTML = resHtml + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + volHtml + '<span style="color:rgba(255,255,255,0.8);font-size:9px;margin-left:4px;">(' + displayScore + '%)</span>';
          let shadow = hasUpgrade ? "box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);" : "box-shadow: 0 1px 2px rgba(0,0,0,0.2);";
          badgeStyle = "font-size:11px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2; " + shadow;
        } else if (book.type === "complete") {
          const hasUpgrade = (siteRes > regRes && regRes > 0) || (siteVol > regVol && regVol > 0);
          el.style.setProperty("text-decoration", "none", "important");
          if (hasUpgrade) {
              el.style.setProperty("color", "#d9480f", "important"); 
              el.style.setProperty("font-weight", "800", "important");
              let resHtml = (siteRes > regRes && regRes > 0) ? '<span style="color:#ffc107; font-weight:900;">' + resText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + resText + '</span>';
              let volHtml = (siteVol > regVol && regVol > 0) ? '<span style="color:#ffc107; font-weight:900;">' + volText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + volText + '</span>';
              newBadgeHTML = resHtml + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + volHtml + '<span style="color:rgba(255,255,255,0.8);font-size:9px;margin-left:4px;">(' + displayScore + '%)</span>';
              badgeStyle = "font-size:11px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2; box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);";
          } else {
              el.style.setProperty("color", "#0056b3", "important"); 
              el.style.setProperty("font-weight", "600", "important");
              newBadgeHTML = '<span style="color:#007bff; font-weight:normal;">' + resText + '</span><span style="color:#007bff; opacity:0.5; margin:0 4px;">|</span><span style="color:#007bff; font-weight:normal;">' + volText + '</span><span style="color:#868e96;font-size:9px;margin-left:4px;">(' + displayScore + '%)</span>';
              badgeStyle = "font-size:11px; background:#f0f7ff; border:1px solid #007bff; padding:2px 5px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2;";
          }
        }
    } else {
        removeBadge(el); 
    }

    // const br = document.createElement('br');
    // el.insertBefore(br, el.lastChild);
    el.style.setProperty("line-height", "1");
    el.style.setProperty("margin-bottom", "10px", "important"); // 💡 뱃지와 텍스트가 겹치는 경우를 방지하기 위해 패딩 추가

    const existingBadge = el.querySelector('.book-badge');
    let actions = el.querySelector('.bm-quick-actions'); 
    let existingBr = el.querySelector('.bm-badge-br'); // 💡 기존에 삽입된 줄바꿈 태그 찾기
    
    // 1. 뱃지 HTML이 있을 때 (책 데이터가 매칭되었을 때)
    if (newBadgeHTML) {
        if (!existingBadge || existingBadge.dataset.html !== newBadgeHTML) {
            if (existingBadge) existingBadge.remove();
            if (existingBr) existingBr.remove(); // 💡 업데이트를 위해 기존 br 삭제
            
            const br = document.createElement('br');
            br.className = 'bm-badge-br'; // 💡 중복 생성을 막기 위해 클래스명 부여

            const badge = document.createElement('span');
            badge.className = 'book-badge';
            
            badge.style.cssText = badgeStyle; 
            badge.innerHTML = newBadgeHTML;
            badge.dataset.html = newBadgeHTML; 
            
            if (actions) {
                el.insertBefore(badge, actions); // 💡 그 다음 뱃지 삽입
                el.insertBefore(br, actions);    // 💡 뱃지보다 먼저 br 태그 삽입
            } else {
                el.appendChild(badge);           // 💡 그 다음 뱃지 삽입
                el.appendChild(br);              // 💡 뱃지보다 먼저 br 태그 삽입
            }
        }
    } else if (existingBadge) {
        existingBadge.remove();
        if (existingBr) existingBr.remove(); // 💡 뱃지가 사라지면 br도 함께 제거
    }

    // 2. 퀵 액션 버튼(복사, 제외 등) 추가 및 갱신 로직
    if (!actions) {
        actions = createQuickActions(el._bmDetailData, !!book);

        actions.dataset.hasBook = !!book; // 💡 무한루프 방지용 속성 추가
        
        // 💡 뱃지가 없어서 br 태그가 안 만들어졌다면 액션 버튼 앞에 br 삽입
        if (!newBadgeHTML && !el.querySelector('.bm-badge-br')) {
            const br = document.createElement('br');
            br.className = 'bm-badge-br';
            el.appendChild(br);
        }
        
        // 💡 액션 버튼의 왼쪽 마진을 없애고 위쪽 마진을 주어 정렬
        actions.style.marginLeft = "0";
        actions.style.marginTop = "5px";
        el.appendChild(actions);
    } else {
        // const needsUpdate = (actions.children.length === 6 && !book) || (actions.children.length === 5 && !!book);
        const needsUpdate = actions.dataset.hasBook !== String(!!book);
        if (needsUpdate) {
            actions.remove();
            actions = createQuickActions(el._bmDetailData, !!book);
            actions.dataset.hasBook = !!book;
            
            // 💡 갱신될 때 br 태그가 누락되었다면 다시 추가
            if (!el.querySelector('.bm-badge-br')) {
                const br = document.createElement('br');
                br.className = 'bm-badge-br';
                el.appendChild(br);
            }
            
            actions.style.marginLeft = "0";
            actions.style.marginTop = "5px";
            el.appendChild(actions);
        }
    }
}

let applyStylesTimer = null;
let applyStylesFrame = null;

function debouncedApplyStyles() {
    if (applyStylesTimer) clearTimeout(applyStylesTimer);
    applyStylesTimer = setTimeout(() => {
        applyStyles();
    }, 10); 
}

function applyStyles() {
  if (!chrome.runtime?.id || !isDataLoaded || !isTargetSite) return;
  
  if (globalAllowedDLs.length > 0) {
      injectDirectDownloadButtons(globalAllowedDLs);
  }

  if (globalDetailSelector) {
      const detailEls = document.querySelectorAll(globalDetailSelector);
      for(let i=0; i<detailEls.length; i++) {
          applyStyleToDetailElement(detailEls[i]);
      }
  }

  const targetAreas = document.querySelectorAll(globalTargetSelector);
  let allLinks = [];

  targetAreas.forEach(area => {
    if (area.tagName === 'A') {
        allLinks.push(area);
    } else {
        const links = area.querySelectorAll('a');
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            if (globalTargetSelector === 'a' && link.closest('header, footer, nav, #navbar, #navFooter, .header, .footer, #nav-main')) continue;
            allLinks.push(link);
        }
    }
  });

  allLinks = [...new Set(allLinks)];

  if (applyStylesFrame) cancelAnimationFrame(applyStylesFrame);

  let index = 0;
  const maxOpsPerFrame = 30000;
  let currentBookCount = Math.max(1, cachedBookList.length);
  const chunkSize = Math.max(10, Math.floor(maxOpsPerFrame / currentBookCount)); 

  function processChunk() {
      const end = Math.min(index + chunkSize, allLinks.length);

      for (; index < end; index++) {
          applyStyleToSingleLink(allLinks[index]);
      }

      if (index < allLinks.length) {
          applyStylesFrame = requestAnimationFrame(processChunk);
      }
  }

  applyStylesFrame = requestAnimationFrame(processChunk);
}

function generateOptimalSelector(el) {
    if (!el) return '';
    if (el.nodeType === 3) el = el.parentElement; 
    
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    
    const classes = Array.from(el.classList).filter(c => !['hover','active','focus'].includes(c));
    if (classes.length > 0) return el.tagName.toLowerCase() + '.' + classes.join('.');
    
    if (el.parentElement) {
        const pClasses = Array.from(el.parentElement.classList).filter(c => !['hover','active','focus'].includes(c));
        if (pClasses.length > 0) return el.parentElement.tagName.toLowerCase() + '.' + pClasses.join('.') + ' > ' + el.tagName.toLowerCase();
    }
    
    return el.tagName.toLowerCase();
}

chrome.storage.local.get({ allowedSites: [], bookList: [], showDownloadUI: true }, (data) => {
    initDataCache(data);

    if (isTargetSite) {
        const fixStyle = document.createElement('style');
        let styleContent = ".list-subject > div[style*=\"float:left\"], .list-subject > div[style*=\"float: left\"] { position: relative !important; z-index: 10 !important; } .list-subject a.ellipsis { position: relative !important; z-index: 1 !important; }";
        
        // 💡 [신규 추가] 전역 변수에 저장된 커스텀 CSS가 있다면 스타일 태그에 덧붙입니다.
        if (globalCustomCss) {
            styleContent += "\n" + globalCustomCss;
        }

        fixStyle.textContent = styleContent;
        document.head.appendChild(fixStyle);

        applyStyles();
        
        new MutationObserver(() => {
            if (!chrome.runtime?.id) return; 
            debouncedApplyStyles(); 
        }).observe(document.body, { childList: true, subtree: true });

        document.addEventListener("contextmenu", (e) => {
            try {
                if (!chrome.runtime?.id) return; 
                lastRightClickedElement = e.target; 
                
                const link = e.target.closest('a');
                if (link) { 
                    lastRightClickedLink = link; 
                    chrome.runtime.sendMessage({ type: "RIGHT_CLICK_TITLE", title: getPureLinkText(link) }).catch(()=>{}); 
                } else if (e.target) {
                    chrome.runtime.sendMessage({ type: "RIGHT_CLICK_TITLE", title: getPureLinkText(e.target) }).catch(()=>{});
                }
            } catch (err) {}
        }, true);

        const config = PRE_DEFINED_SITES.find(site => window.location.hostname.includes(site.url));
        
        // 💡 조건문에 config.getHighResUrlAsync 를 추가합니다.
        if (config && config.thumbSelector && (config.getHighResUrl || config.getHighResUrlAsync)) {
            const hoverContainer = getOrCreateHoverContainer();
            const previewImg = document.getElementById('book-manager-hover-img');
            const hoverSpinner = document.getElementById('book-manager-hover-spinner'); 

            let hoverTimer = null;
            let currentThumb = null;

            // 💡 async 키워드 추가
            // 💡 async 키워드가 있는 mouseover 이벤트 전체를 아래 코드로 교체합니다.
            document.addEventListener('mouseover', async (e) => {
                const thumb = e.target.closest(config.thumbSelector);
                if (!thumb || thumb.tagName !== 'IMG') return;
                if (config.selector && !thumb.closest(config.selector)) return;
                if (config.excludeThumbSelector && config.excludeThumbSelector && thumb.closest(config.excludeThumbSelector)) return;
                
                currentThumb = thumb;

                // 💡 [신규] 이미 고화질 썸네일로 교체된 항목이라면 추출(스피너/통신)을 생략하고 즉시 띄움
                if (thumb.dataset.isHighResReplaced === "true") {
                    previewImg.src = thumb.src;
                    previewImg.style.filter = "none";
                    hoverContainer.style.display = 'block';
                    hoverSpinner.style.display = 'none';
                    return;
                }

                // 아직 추출되지 않은 썸네일: 블러 처리 및 빙글빙글 도는 스피너 표시
                previewImg.src = thumb.src;
                previewImg.style.filter = "blur(8px)";
                hoverContainer.style.display = 'block';
                hoverSpinner.style.display = 'block'; 

                if (hoverTimer) clearTimeout(hoverTimer);

                // 상세페이지 파싱(비동기) 로직 호출
                let highResSrc = "";
                if (config.getHighResUrlAsync) {
                    highResSrc = await config.getHighResUrlAsync(thumb);
                } else if (config.getHighResUrl) {
                    highResSrc = config.getHighResUrl(thumb.src);
                }

                // 이미지를 못 찾았거나, 로딩 중에 마우스가 다른 곳으로 이동한 경우 취소
                if (!highResSrc || currentThumb !== thumb) {
                    if (currentThumb === thumb) hoverSpinner.style.display = 'none';
                    return;
                }

                hoverTimer = setTimeout(() => {
                    const tempImg = new Image();
                    tempImg.src = highResSrc;
                    tempImg.onload = () => {
                        if (currentThumb === thumb) {
                            previewImg.src = highResSrc;
                            previewImg.style.filter = "none"; 
                            hoverSpinner.style.display = 'none'; 
                            
                            // 💡 [신규] 원본 썸네일 이미지의 src를 추출해 온 고화질 이미지로 영구 교체
                            thumb.src = highResSrc;
                            thumb.dataset.isHighResReplaced = "true"; // 다음번 호버 시 재추출 방지 플래그
                        }
                    };
                    tempImg.onerror = () => {
                        if (currentThumb === thumb) {
                            hoverSpinner.style.display = 'none';
                        }
                    };
                }, 50); 
            });

            document.addEventListener('mousemove', (e) => {
                if (hoverContainer.style.display === 'block') {
                    let x = e.clientX + 15, y = e.clientY + 15;
                    const rect = hoverContainer.getBoundingClientRect();
                    const w = rect.width || 350, h = rect.height || 500;
                    if (x + w > window.innerWidth) x = e.clientX - w - 10;
                    if (y + h > window.innerHeight) y = window.innerHeight - h - 10;
                    hoverContainer.style.left = x + 'px';
                    hoverContainer.style.top = y + 'px';
                }
            });

            document.addEventListener('mouseout', (e) => {
                const thumb = e.target.closest(config.thumbSelector);
                if (thumb) { 
                    if (hoverTimer) clearTimeout(hoverTimer);
                    currentThumb = null;
                    hoverContainer.style.display = 'none'; 
                    previewImg.src = ''; 
                    previewImg.style.filter = "none";
                    hoverSpinner.style.display = 'none'; 
                }
            });
        }
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.showDownloadUI !== undefined) {
            isDownloadUIEnabled = changes.showDownloadUI.newValue;
            if (!isDownloadUIEnabled) {
                let container = document.getElementById('book-manager-dl-overlay');
                if (container) container.style.display = 'none';
            }
        }
        
        if (changes.bookList || changes.allowedSites) {
            chrome.storage.local.get({ allowedSites: [], bookList: [], showDownloadUI: true }, (data) => {
                initDataCache(data);
                debouncedApplyStyles();
            });
        }
    }
});

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function updateDownloadUI(downloads) {
    let container = document.getElementById('book-manager-dl-overlay');
    
    if (!downloads || downloads.length === 0) {
        if (container) container.style.display = 'none';
        return;
    }

    if (!container) {
        container = document.createElement('div');
        container.id = 'book-manager-dl-overlay';
        container.style.cssText = "position: fixed; bottom: 20px; left: 20px; z-index: 9999999; background: rgba(33, 37, 41, 0.95); color: white; padding: 15px; border-radius: 10px; box-shadow: 0 8px 20px rgba(0,0,0,0.3); width: 320px; max-height: 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; font-family: sans-serif;";
        document.body.appendChild(container);
    }
    
    container.style.display = 'flex';
    container.innerHTML = `<div style="font-weight:bold; font-size:13px; border-bottom:1px solid #495057; padding-bottom:8px; margin-bottom:4px;">⬇️ 다운로드 현황 (${downloads.length}개)</div>`;

    downloads.forEach(dl => {
        let percent = dl.totalBytes > 0 ? Math.round((dl.bytesReceived / dl.totalBytes) * 100) : 0;
        let speedStr = dl.speed > 0 ? `${formatBytes(dl.speed)}/s` : "대기 중...";
        let sizeStr = dl.totalBytes > 0 ? `${formatBytes(dl.bytesReceived)} / ${formatBytes(dl.totalBytes)}` : formatBytes(dl.bytesReceived);
        
        let itemHtml = `
            <div style="display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; justify-content:space-between; font-size:12px;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px; font-weight:500;" title="${dl.filename}">${dl.filename}</span>
                    <span style="color:#ffc107; font-weight:bold;">${percent}%</span>
                </div>
                <div style="width:100%; background:#495057; height:6px; border-radius:3px; overflow:hidden;">
                    <div style="width:${percent}%; background:#20c997; height:100%; transition:width 0.3s ease;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:11px; color:#ced4da;">
                    <span>${sizeStr}</span>
                    <span>${speedStr}</span>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', itemHtml);
    });
}

try {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "GET_AND_REGISTER_SELECTOR") {
          const host = window.location.hostname.replace(/^www\./, '');
          const selector = generateOptimalSelector(lastRightClickedElement);
          
          if(!selector) {
              showInfoToast("❌ 요소 선택자를 추출할 수 없습니다.", true);
              return;
          }
          
          chrome.storage.local.get({ allowedSites: [] }, (data) => {
              let sites = Array.isArray(data.allowedSites) ? data.allowedSites : [];
              let existing = sites.find(s => (typeof s === 'string' ? s : s.url) === host);
              
              if (existing) {
                  if (typeof existing === 'string') {
                      existing = { url: existing, detailSelector: selector };
                  } else {
                      existing.detailSelector = selector;
                      delete existing.selector; 
                  }
                  sites = sites.map(s => (typeof s === 'string' ? s : s.url) === host ? existing : s);
              } else {
                  sites.push({ url: host, detailSelector: selector });
              }
              
              chrome.storage.local.set({ allowedSites: sites }, () => {
                  showInfoToast(`✅ [${host}] 상세페이지 제목이 등록되었습니다.<br><span style='font-size:12px; color:#ddd;'>추출: ${selector}</span>`);
                  setTimeout(() => window.location.reload(), 1500); 
              });
          });
      } else if (request.action === "SHOW_TOAST" && request.book) {
          showToast(request.book, request.isDelete);
      } else if (request.action === "SHOW_INFO_TOAST") {
          showInfoToast(request.msg, request.isError);
      } else if (request.action === "UPDATE_DOWNLOAD_PROGRESS") {
          if (isDownloadUIEnabled) {
              updateDownloadUI(request.downloads);
          }
      } else if (request.action === "DOWNLOAD_COMPLETE_TOAST") {
          if (isDownloadUIEnabled) {
              const fname = request.filename.split(/[\\/]/).pop();
              const btnId = "btn-open-folder-" + request.id;
              showInfoToast(`✅ 다운로드 완료!<br><span style="font-size:12px; color:#ddd;">${fname}</span><br><button id="${btnId}" style="margin-top:8px; padding:4px 10px; font-size:12px; font-weight:bold; background:#ffc107; color:#000; border:none; border-radius:4px; cursor:pointer; width:100%; pointer-events:auto; box-shadow:0 2px 5px rgba(0,0,0,0.3);">📂 다운로드 폴더 열기</button>`);
              
              setTimeout(() => {
                  const btn = document.getElementById(btnId);
                  if (btn) {
                      btn.onclick = () => {
                          chrome.runtime.sendMessage({action: 'OPEN_DOWNLOAD_FOLDER', downloadId: request.id});
                          btn.innerText = "열림!";
                      };
                  }
              }, 100);
          }
      }
    });
} catch(e) {}

chrome.storage.local.get({ autoConfirm: true }, (data) => {
    if (data.autoConfirm) {
        const currentHostname = window.location.hostname;
        const activeConfig = PRE_DEFINED_SITES.find(site => currentHostname.includes(site.url));

        if (activeConfig && activeConfig.autoConfirmKeywords && activeConfig.autoConfirmKeywords.length > 0) {
            try {
                chrome.runtime.sendMessage({ 
                    action: "INJECT_BYPASS_SCRIPT", 
                    keywords: activeConfig.autoConfirmKeywords 
                }).catch(()=>{});
            } catch (err) {}
        }
    }
});