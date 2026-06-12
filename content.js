// [사이트 분리 로직] 사이트별로 허용할 다운로드 모듈을 제한합니다.
const PRE_DEFINED_SITES = [
{ 
    url: "tcafe21.com", 
    selector: ".board-hot-posts, #fboardlist",
    thumbSelector: "img", 
    excludeThumbSelector: ".board-thumbnail",
    allowedDLs: ["giga", "gofile", "transfer"],
    autoConfirmKeywords: ["포인트", "열람"], 
    boardFilter: /[?&]bo_table=D2002(?:&|#|$)/i,
    commentSelector: ".media-content",
    commentWrapperSelector: ".media",
    
    getHighResUrlAsync: async (thumb) => {
        const link = thumb.closest('a');
        if (!link || !link.href) return "";
        if (thumb.dataset.cachedHighRes) return thumb.dataset.cachedHighRes;

        try {
            const res = await fetch(link.href);
            const html = await res.text();
            // 최적화: 무거운 DOMParser 대신 정규표현식을 사용하여 추출 속도 대폭 향상
            const match = html.match(/class=["'][^"']*view-content[^"']*["'][\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
            if (match && match[1]) {
                const absoluteUrl = new URL(match[1], link.href).href;
                thumb.dataset.cachedHighRes = absoluteUrl; 
                return absoluteUrl;
            }
        } catch (error) {
            console.log("고화질 썸네일 추출 실패:", error);
        }
        return "";
    },
    customCss: `
        .well { 
            border-radius: 10px !important; 
            padding: 20px !important; 
            width: 100% !important;
            max-width: 1200px !important;
            background: rgba(255, 255, 255, 0.95) !important;
            box-shadow: 0 -2px 5px rgba(0,0,0,0.15) !important;
            backdrop-filter: blur(5px) !important;
        }
        body { padding-bottom: 120px !important; }
        .bm-badge-br.list-br { display: block !important; height: 0 !important; margin-top: 8px !important; }
        .bm-quick-actions.list-actions { display: flex !important; flex-wrap: wrap !important; gap: 4px !important; margin-top: 5px !important; width: auto !important; }
        .bm-quick-actions.list-actions button { margin: 0 !important; flex-shrink: 0 !important; font-weight: 400 !important; opacity: 0.7; }

        #fboardlist table th:nth-child(1),#fboardlist table td:nth-child(1),
        #fboardlist table th:nth-child(4), #fboardlist table td:nth-child(4),
        #fboardlist table th:nth-child(6), #fboardlist table td:nth-child(6),
        #fboardlist table th:nth-child(7), #fboardlist table td:nth-child(7) {
            display: none !important;
        }


        
    `,
    themeCss: `
        @import url('https://fonts.googleapis.com/css2?family=Jua&display=swap');
        
        .div-table.table > tbody > tr > td,
        #fboardlist table  td{padding:12px 8px !important;border-bottom: 1px solid #ddd;}
        table.list-pc .list-subject a,
        #fboardlist .list-subject a{font-family: "Jua", sans-serif;}
        #fboardlist .list-subject a button{font-weight:400 !important;}

        .view-content{font-family: "Jua" !important, sans-serif !important;}
        .view-img img,
        .view-content img{display:block;width:98%;max-width:calc(400px - 1.1%);float:left;margin-right:1%;border-radius:15px;box-shadow: 5px 5px 10px rgba(0, 0, 0, 0.1);border: 1px solid rgba(0, 0, 0, 0.11);}
        .view-content a{display:contents}
        .view-content:after{content:"";display:block;clear:both}

        @media screen and (max-width: 1000px) {
            .view-img img,
            .view-content img{max-width:calc(50% - 1.1%);}
        }


        @media screen and (max-width: 480px) {
           .view-img img,
            .view-content img{max-width:calc(100% - 1.1%);}
        }
    `
  },
{ 
    url: "127.0.0.1", 
    selector: "#data_list",
    thumbSelector: "img", 
    excludeThumbSelector: ".thumbnail",
    allowedDLs: ["giga", "gofile", "transfer"],
    autoConfirmKeywords: ["포인트", "열람"], 
    
    getHighResUrlAsync: async (thumb) => {
        const link = thumb.closest('a');
        if (!link || !link.href) return "";
        if (thumb.dataset.cachedHighRes) return thumb.dataset.cachedHighRes;

        try {
            const res = await fetch(link.href);
            const html = await res.text();
            // 최적화: 무거운 DOMParser 대신 정규표현식을 사용하여 추출 속도 대폭 향상
            const match = html.match(/class=["'][^"']*view-content[^"']*["'][\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
            if (match && match[1]) {
                const absoluteUrl = new URL(match[1], link.href).href;
                thumb.dataset.cachedHighRes = absoluteUrl; 
                return absoluteUrl;
            }
        } catch (error) {
            console.log("고화질 썸네일 추출 실패:", error);
        }
        return "";
    },
  },
{
    url: "ridibooks.com", selector: ".infinite-scroll-component", allowedDLs: []
},
{
    url: "enterjoy.day", 
    selector: "#fboardlist .list-board", 
    allowedDLs: ["giga", "gofile", "transfer"],
    autoConfirmKeywords: ["열람하시겠습니까"], 
    boardFilter: /[?&]bo_table=(sub_manga|manga_jic|joy_new|joy_mh|joy_lv|joy_rofan|books|joy_fan|joy_ai|19novel|joy_bell|joy_fan_request)(?:&|#|$)/i,
    commentSelector: ".media-content",
    commentWrapperSelector: ".media",
    themeCss: `
        #fboardlist > ul, #fboardlist .board-list, #fboardlist > div,
        #fboardlist table, #fboardlist table tbody {
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)) !important;
            gap: 16px !important;
            padding: 0 !important;
            border: none !important;
            background: transparent !important;
        }
        #fboardlist table thead { display: none !important; }
        #fboardlist .list-board li{margin-bottom:5px}
        #fboardlist .list-item, 
        #fboardlist .list-board li,
        #fboardlist table tbody tr {
            display: flex !important;
            flex-direction: column !important;
            background: #ffffff !important;
            border: 1px solid #e9ecef !important;
            border-radius: 12px !important;
            padding: 16px !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.04) !important;
            transition: all 0.2s ease-in-out !important;
            border-bottom: 1px solid #e9ecef !important;
            width: auto !important;
            align-items: flex-start !important;
        }
        #fboardlist .list-item:hover, 
        #fboardlist .list-board li:hover,
        #fboardlist table tbody tr:hover {
            transform: translateY(-4px) !important;
            box-shadow: 0 12px 24px rgba(0,0,0,0.1) !important;
            border-color: #80bdff !important;
            z-index: 10;
        }
        #fboardlist table td {
            display: block !important;
            border: none !important;
            padding: 0 !important;
            width: 100% !important;
            text-align: left !important;
        }
        #fboardlist .wr-subject,
        #fboardlist table td.td_subject,
        #fboardlist table td.list-subject {
            flex-grow: 1 !important;
            margin-bottom: 12px !important;
            padding: 0 !important;
            width: 100% !important;
        }
        #fboardlist .wr-subject a,
        #fboardlist table td.td_subject a,
        #fboardlist table td.list-subject a {
            display: block !important;
            font-size: 15px !important;
            font-weight: 700 !important;
            line-height: 1.5 !important;
            color: #212529 !important;
            word-break: keep-all !important;
            text-decoration: none !important;
        }
        #fboardlist .wr-subject a:hover,
        #fboardlist table td.td_subject a:hover {
            color: #0d6efd !important;
        }
        /* 작성자, 날짜 영역 하단 배치 */
        #fboardlist .wr-name, 
        #fboardlist .wr-date,
        #fboardlist table td.td_name,
        #fboardlist table td.td_datetime {
            display: inline-block !important;
            font-size: 12px !important;
            color: #868e96 !important;
            margin-top: 8px !important;
        }
        #fboardlist .wr-name,
        #fboardlist table td.td_name { margin-right: 10px !important; }
        
        /* 기존 리스트 헤더 및 불필요 항목 숨김 */
        #fboardlist .list-header,
        .list-item .wr-good,
        .list-item .wr-hit,
        .list-item .wr-num,
        #fboardlist table td.td_num,
        #fboardlist table td.td_m_id,
        #fboardlist table td.td_hit,
        #fboardlist table td.td_good {
            display: none !important;
        }
        
        /* 뱃지 및 퀵 버튼 여백 조정 */
        .bm-badge-br.list-br { display: block !important; height: 0 !important; margin-top: 8px !important; }
        .bm-quick-actions.list-actions { display: flex !important; flex-wrap: wrap !important; gap: 4px !important; margin-top: 8px !important; width: auto !important; }
        .bm-quick-actions.list-actions button { margin: 0 !important; flex-shrink: 0 !important; font-weight: 400 !important; opacity: 0.7; }
    `,
}, 
{ 
    url: "hellkaiv.net", 
    selector: "#gall_ul .bo_tit", 
    autoConfirmKeywords: ["링크", "발급"], 
    allowedDLs: ["giga", "gofile", "hk"],
    customCss: `
        .bm-quick-actions.list-actions {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 4px !important;
            margin-top: 6px !important;
            width: 100% !important;
        }
        .bm-quick-actions.list-actions button {
            margin: 0 !important;
            flex-shrink: 0 !important;
        }
    `,
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
let globalThemeCss = '';

let isTargetSite = false;
let exactMatchCache = {};
let cachedBookList = [];
let isDataLoaded = false;

let similarityCache = {};
let lastRightClickedLink = null; 
let lastRightClickedElement = null; 

let isDownloadUIEnabled = true; 
let titleProcessingCache = new Map(); 
let isEverythingEnabled = false;
let isShowListQuickBtn = false;
let isShowListQuickBtnHover = false;
let isCustomThemeEnabled = false;
let isAllowedBoard = true;
let isSupportSingleCharEnabled = false;
let isHideUselessCommentsEnabled = true;

function initDataCache(data) {
    isDownloadUIEnabled = data.showDownloadUI !== false; 
    isEverythingEnabled = !!data.connectEverything;
    isShowListQuickBtn = !!data.showListQuickBtn;
    isShowListQuickBtnHover = !!data.showListQuickBtnHover;
    isCustomThemeEnabled = !!data.useCustomTheme;
    isSupportSingleCharEnabled = !!data.supportSingleChar;
    isHideUselessCommentsEnabled = data.hideUselessComments !== false;

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
        globalThemeCss = config.themeCss || '';
        isAllowedBoard = config.boardFilter ? config.boardFilter.test(window.location.href) : true;
    } else if (matchedUserSite) {
        isTargetSite = true;
        globalAllowedDLs = ["giga", "gofile"]; 
        globalTargetSelector = 'a'; 
        globalCustomCss = matchedUserSite.customCss || '';
        globalThemeCss = matchedUserSite.themeCss || '';
        isAllowedBoard = true;
    } else {
        isTargetSite = false;
        globalAllowedDLs = [];
        isAllowedBoard = true;
    }

    globalDetailSelector = (matchedUserSite && typeof matchedUserSite === 'object' && matchedUserSite.detailSelector) 
        ? matchedUserSite.detailSelector : (config && config.detailSelector ? config.detailSelector : '');

    exactMatchCache = {};
    similarityCache = {}; 

    cachedBookList = (Array.isArray(data.bookList) ? data.bookList : []).map(b => {
        let processedOriginal, processedNoSpace;
        
        if (titleProcessingCache.has(b.title)) {
            const cached = titleProcessingCache.get(b.title);
            processedOriginal = cached.original;
            processedNoSpace = cached.nospace;
        } else {
            processedOriginal = b.title.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim();
            processedNoSpace = processedOriginal.replace(/\s+/g, ''); 
            titleProcessingCache.set(b.title, { original: processedOriginal, nospace: processedNoSpace });
        }

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

let uselessCommentCount = 0;

function processUselessComments() {
    if (!isHideUselessCommentsEnabled || !isTargetSite) return;
    if (!isTargetSite) return;

    const hostname = window.location.hostname;
    const config = PRE_DEFINED_SITES.find(s => hostname.includes(s.url));
    if (!config || !config.commentSelector) return;

    // 옵션이 꺼졌을 때, 이미 숨겨진 댓글들을 다시 보여주고 카운트 초기화
    if (!isHideUselessCommentsEnabled) {
        document.querySelectorAll('[data-bm-hidden]').forEach(el => {
            el.style.display = '';
            el.removeAttribute('data-bm-hidden');
        });
        uselessCommentCount = 0;
        return;
    }

    let newlyHidden = 0;
    document.querySelectorAll(config.commentSelector).forEach(el => {
        if (el.dataset.bmHidden) return;
        
        const text = el.textContent.trim();
        if (isUselessComment(text)) {
            let wrapper = config.commentWrapperSelector ? el.closest(config.commentWrapperSelector) : el;
            if (wrapper && wrapper.style.display !== 'none') {
                wrapper.style.display = 'none';
                wrapper.dataset.bmHidden = 'true';
                el.dataset.bmHidden = 'true';
                newlyHidden++;
                uselessCommentCount++;
            }
        }
    });

    if (newlyHidden > 0) {
        const msg = `의미없는 댓글 <b>${uselessCommentCount}</b>개를 숨김처리했습니다. 해당 댓글들을 다시 보시겠습니까? ` +
                    `<button class="bm-useless-show-btn" style="background:#20c997; color:#fff; border:none; border-radius:4px; padding:3px 8px; margin-left:8px; font-weight:bold; cursor:pointer;">[보기]</button>` +
                    `<button class="bm-useless-opt-btn" style="background:#ffc107; color:#000; border:none; border-radius:4px; padding:3px 8px; margin-left:4px; font-weight:bold; cursor:pointer;">[설정]</button>`;
        showInfoToast(msg);

        setTimeout(() => {
            document.querySelectorAll('.bm-useless-opt-btn').forEach(btn => {
                btn.onclick = () => chrome.runtime.sendMessage({ action: "OPEN_OPTIONS_FOR_COMMENTS" }).catch(()=>{});
            });
            document.querySelectorAll('.bm-useless-show-btn').forEach(btn => {
                btn.onclick = () => {
                    document.querySelectorAll('[data-bm-hidden="true"]').forEach(el => {
                        el.style.display = '';
                        el.dataset.bmHidden = 'revealed'; // 다시 숨김 처리되는 것을 방지
                    });
                    const toastDiv = btn.closest('div');
                    if (toastDiv) {
                        toastDiv.style.opacity = '0';
                        toastDiv.style.transform = 'translateX(20px)';
                        setTimeout(() => { if (toastDiv.parentNode) toastDiv.remove(); }, 300);
                    }
                };
            });
        }, 100);
    }
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
    if (regBody.length >= 3 && isPrefixOrSuffix && lengthDiff <= 10) return 85; 
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
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 350); 
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
  // 누락 정보 추가 로직
  if (book.missingVols && book.missingVols.length > 0 && !isDelete) {
      details.push('누락:' + book.missingVols.join(','));
  }
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
    setTimeout(() => { if(toast.parentNode) toast.remove(); }, 350);
  }, 5000);
}

function getBookTypeForTitle(titleStr) {
    if (!isDataLoaded || !titleStr) return null;
    
    let siteBodyOriginal = titleStr.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim();
    let siteBodyNoSpace = siteBodyOriginal.replace(/\s+/g, '');
    
    if (exactMatchCache[siteBodyNoSpace]) return exactMatchCache[siteBodyNoSpace].type;
    if (similarityCache[siteBodyNoSpace] !== undefined) return similarityCache[siteBodyNoSpace].book ? similarityCache[siteBodyNoSpace].book.type : null;
    
    let book = null;
    let maxScore = 0;
    for (let i = cachedBookList.length - 1; i >= 0; i--) {
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
    if (allowedDLs.includes('transfer')) regexParts.push('transfer\\.it\\/s\\/|transfer\\.it\\/t\\/'); 

    if (regexParts.length === 0) return;
    
    let regexStr = "(https?:\\/\\/(?:[a-zA-Z0-9-]+\\.)?(?:";
    regexStr += regexParts.join('|');
    regexStr += ")[^\\s\"'<>]+)";
    const targetRegex = new RegExp(regexStr, "i");

    function extractTargetBookTitle(element) {
        let hasTranslation = false;

        if (typeof globalDetailSelector !== 'undefined' && globalDetailSelector) {
            const detailEl = document.querySelector(globalDetailSelector);
            if (detailEl) {
                const temp = document.createElement('div');
                temp.innerHTML = detailEl.innerHTML.replace(/<img[^>]*>/gi, '');
                temp.querySelectorAll('.bm-quick-actions, .book-badge, button, .auto-dl-btn').forEach(e => e.remove());
                let rawText = temp.textContent;
                if (rawText.includes('번역')) hasTranslation = true;
                let title = cleanSiteTitle(rawText);
                let skip = false;
                if (!title || title.length < 1) skip = true;
                else if (!isSupportSingleCharEnabled && title.length < 2) skip = true;
                else if (isSupportSingleCharEnabled && title.length === 1 && /^[a-zA-Z0-9]$/.test(title)) skip = true;
                if (!skip) return { title: title, hasTranslation: hasTranslation };
            }
        }

        let container = element.closest('.bsx-body, tr, li, td, .list-item, div.item, .bo_v_atc') || element.parentElement;
        if (container) {
            const temp = document.createElement('div');
            temp.innerHTML = container.innerHTML.replace(/<img[^>]*>/gi, '');
            temp.querySelectorAll('.bm-quick-actions, .book-badge, .auto-dl-btn, button, .count').forEach(e => e.remove());
            let rawText = temp.textContent.replace(/탭열기|다운로드\s*링크\s*발급|복사|제외|미완|완결|삭제|검색/gi, ' ').replace(/\s+/g, ' ').trim();
            if (rawText.includes('번역')) hasTranslation = true;
            let title = cleanSiteTitle(rawText);
            let skip = false;
            if (!title || title.length < 1) skip = true;
            else if (!isSupportSingleCharEnabled && title.length < 2) skip = true;
            else if (isSupportSingleCharEnabled && title.length === 1 && /^[a-zA-Z0-9]$/.test(title)) skip = true;
            if (!skip) return { title: title, hasTranslation: hasTranslation };
        }

        let pageTitle = document.title.split(/[-|]/)[0]; 
        if (pageTitle.includes('번역')) hasTranslation = true;
        return { title: cleanSiteTitle(pageTitle) || "알수없는제목", hasTranslation: hasTranslation };
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

    function createButton(insertAfterElement, url, pw, targetType, bookTitle, hasTranslation) {
        if (insertAfterElement.nextElementSibling && insertAfterElement.nextElementSibling.classList.contains('auto-dl-btn')) return;
        
        const autoBtn = document.createElement('a');
        autoBtn.href = "#";
        autoBtn.className = "auto-dl-btn";
        
        let btnText = "⚡ 바로다운로드";
        let bgColor = "#17a2b8";
        
        if (targetType === 'HELLKDIS') bgColor = "#6f42c1"; 
        else if (targetType === 'TRANSFERIT') bgColor = "#dc3545"; 

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
                if (hasTranslation) finalTitle += "(번역)";
                let bType = getBookTypeForTitle(bookTitle);
                if (bType === 'incomplete') finalTitle = "(미완)" + finalTitle;
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
        if (link.href && targetRegex.test(link.href)) url = link.href;
        else {
            let textMatch = (link.textContent || "").match(targetRegex);
            if (textMatch) url = textMatch[1];
        }

        if (url) {
            let targetType = "";
            let isHk = url.includes('hellkdis.net/s/') || url.includes('hellkaiv.net/s/');
            if (allowedDLs.includes('hk') && isHk) targetType = "HELLKDIS";
            else if (allowedDLs.includes('gofile') && url.includes('gofile.io')) targetType = "GOFILE";
            else if (allowedDLs.includes('giga') && (url.includes('gigafile') || url.includes('xgf'))) targetType = "GIGAFILE";
            else if (allowedDLs.includes('transfer') && url.includes('transfer.it')) targetType = "TRANSFERIT"; 

            if(targetType){
                let pw = extractPassword(link);
                let extracted = extractTargetBookTitle(link);
                createButton(link, url, pw, targetType, extracted.title, extracted.hasTranslation);
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
            else if (allowedDLs.includes('transfer') && url.includes('transfer.it')) targetType = "TRANSFERIT";

            if(targetType){
                let pw = extractPassword(btn);
                let extracted = extractTargetBookTitle(btn);
                createButton(btn, url, pw, targetType, extracted.title, extracted.hasTranslation);
            }
        }
    });
}

function removeBadge(link) {
    if (link.style.textDecoration || link.querySelector(':scope > .book-badge')) {
        link.style.removeProperty("text-decoration");
        link.style.removeProperty("color");
        link.style.removeProperty("opacity");
        link.style.removeProperty("font-weight");
        link.style.removeProperty("background-color");
        link.style.removeProperty("padding");
        link.style.removeProperty("border-radius");
        link.removeAttribute("title");
        const badge = link.querySelector(':scope > .book-badge');
        if (badge) badge.remove();
    }
}

// [전면 수정] 상세페이지 누락관리 팝오버 말풍선 디자인 및 애니메이션 적용 로직
let contentVolPopover = null;

function openMissingPopoverContent(targetNoSpace, badgeElement) {
    if (!contentVolPopover) {
        contentVolPopover = document.createElement('div');
        contentVolPopover.id = 'bm-missing-popover';
        document.body.appendChild(contentVolPopover);
        
        // 말풍선 삼각형 및 애니메이션 효과를 위한 스타일 동적 주입 (최초 1회)
        if (!document.getElementById('bm-popover-style')) {
            const style = document.createElement('style');
            style.id = 'bm-popover-style';
            style.innerHTML = `
                @keyframes bmPopIn {
                    0% { opacity: 0; transform: translate(-50%, -20px) scale(0.9); }
                    60% { opacity: 1; transform: translate(-50%, 5px) scale(1.03); }
                    100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
                }
                #bm-missing-popover {
                    animation: bmPopIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                    transform-origin: top center; /* 푱! 효과 시 기준점을 상단 중앙으로 설정 */
                }
                /* 말풍선 삼각형 꼬리 - 테두리 부분 */
                #bm-missing-popover::after {
                    content: ''; position: absolute; bottom: 100%; left: 50%;
                    transform: translateX(-50%); border: 10px solid transparent;
                    border-bottom-color: #dee2e6; /* 테두리 색상 */
                }
                /* 말풍선 삼각형 꼬리 - 내부 배경 부분 */
                #bm-missing-popover::before {
                    content: ''; position: absolute; bottom: 100%; left: 50%;
                    transform: translateX(-50%); border: 9px solid transparent;
                    border-bottom-color: #fff; /* 내부 배경 색상 */
                    z-index: 1; /* 테두리보다 위에 배치 */
                }
            `;
            document.head.appendChild(style);
        }

        document.addEventListener('click', (e) => {
            if (contentVolPopover && !contentVolPopover.contains(e.target) && !e.target.closest('button')) {
                contentVolPopover.style.display = 'none';
            }
        });
    }

    chrome.storage.local.get({ bookList: [] }, (data) => {
        const list = data.bookList;
        const dbBook = list.find(b => {
            const noSpace = b.title.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim().replace(/\s+/g, '');
            return noSpace === targetNoSpace;
        });

        if (!dbBook) {
            showInfoToast('도서 데이터가 아직 저장되지 않았습니다. 잠시 후 다시 시도해주세요.', true);
            return;
        }

        const lastVol = parseInt(dbBook.lastVol, 10);
        if (isNaN(lastVol) || lastVol <= 0) {
            showInfoToast('권수를 먼저 옵션창에서 숫자로 저장한 뒤에 이용해주세요.', true);
            return;
        }

        let missingVols = dbBook.missingVols || [];

        contentVolPopover.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; font-weight:bold; border-bottom:1px solid #dee2e6; padding-bottom:8px; margin-bottom:8px; color:#333;">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${dbBook.title} (총 ${lastVol}권)</span>
                <button id="bmClosePopoverBtn" style="background:transparent; color:#333; padding:0; margin-left:5px; font-size:16px; border:none; cursor:pointer;">✕</button>
            </div>
            <div style="font-size:11px; color:#6c757d; margin-bottom:8px;">빈틈이 발생한 누락 번호를 클릭하세요.</div>
            <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:5px; max-height:200px; overflow-y:auto; padding-right:4px; box-sizing:border-box;">
                ${Array.from({length: lastVol}, (_, i) => i + 1).map(v => `
                    <div class="bm-vol-item ${missingVols.includes(v) ? 'missing' : ''}" data-vol="${v}" style="text-align:center; padding:6px 0; font-size:12px; background:${missingVols.includes(v) ? '#ffe3e3' : '#f8f9fa'}; border:1px solid ${missingVols.includes(v) ? '#ffa8a8' : '#dee2e6'}; border-radius:4px; cursor:pointer; user-select:none; color:${missingVols.includes(v) ? '#e03131' : '#333'}; font-weight:500; transition:all 0.1s; ${missingVols.includes(v) ? 'text-decoration:line-through; opacity:0.8;' : ''}">${v}</div>
                `).join('')}
            </div>
        `;

        // 애니메이션이 적용되도록 하기 위해 display:none 상태에서 즉시 스타일 적용 후 block 처리
        contentVolPopover.style.cssText = "position:absolute; display:none; background:#fff; border:1px solid #dee2e6; border-radius:10px; padding:15px; box-shadow:0 6px 18px rgba(0,0,0,0.2); z-index:9999999; width:250px; box-sizing:border-box;";

        const rect = badgeElement.getBoundingClientRect();
        // 버튼의 중앙 하단에 말풍선이 오도록 좌표 계산
        const topPos = rect.bottom + window.scrollY + 12; // 삼각형 높이를 고려해 여백 부여
        const leftPos = rect.left + (rect.width / 2) + window.scrollX;

        contentVolPopover.style.top = `${topPos}px`;
        contentVolPopover.style.left = `${leftPos}px`;
        contentVolPopover.style.transform = `translateX(-50%)`; // 수평 중앙 정렬 고정
        contentVolPopover.style.display = 'block';

        document.getElementById('bmClosePopoverBtn').onclick = () => contentVolPopover.style.display = 'none';
        
        contentVolPopover.querySelectorAll('.bm-vol-item').forEach(item => {
            item.onclick = (e) => {
                const vol = parseInt(e.target.dataset.vol, 10);
                if (e.target.classList.contains('missing')) {
                    e.target.classList.remove('missing');
                    e.target.style.cssText = "text-align:center; padding:6px 0; font-size:12px; background:#f8f9fa; border:1px solid #dee2e6; border-radius:4px; cursor:pointer; user-select:none; color:#333; font-weight:500; transition:all 0.1s;";
                    missingVols = missingVols.filter(v => v !== vol);
                } else {
                    e.target.classList.add('missing');
                    e.target.style.cssText = "text-align:center; padding:6px 0; font-size:12px; background:#ffe3e3; border:1px solid #ffa8a8; border-radius:4px; cursor:pointer; user-select:none; color:#e03131; font-weight:500; transition:all 0.1s; text-decoration:line-through; opacity:0.8;";
                    missingVols.push(vol);
                }
                
                const updatedList = list.map(b => b.id === dbBook.id ? { ...b, missingVols } : b);
                chrome.storage.local.set({ bookList: updatedList }); 
            };
        });
    });
}

function createQuickActions(linkData, hasBook) {
    const container = document.createElement('span');
    container.className = 'bm-quick-actions';
    container.style.cssText = "display: inline-flex; gap: 4px; margin-left: 8px; vertical-align: middle;";

    const btnStyle = "padding: 2px 5px; font-size: 11px; font-weight: bold; border-radius: 4px; cursor: pointer; color: white; border: none; text-decoration: none; line-height: 1.2; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: all 0.2s; flex-shrink: 0;";
    
    const buttons = [
        { label: '복사', color: '#845ef7', action: 'copy' },
        { label: '제외', color: '#ff6b6b', action: 'exclude' },
        { label: '미완', color: '#ff922b', action: 'incomplete' },
        { label: '완결', color: '#4dabf7', action: 'complete' },
        { label: '삭제', color: '#868e96', action: 'delete', display: hasBook }, 
        { label: '누락관리', color: '#f06595', action: 'missing_vol', display: hasBook },
        { label: '구글검색', color: '#20c997', action: 'search' },
        { label: '리디검색', color: '#1e90ff', action: 'ridi_preview' },
        { label: '에브리띵검색', color: '#495057', action: 'everything_search', display: true }
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

                if (btnInfo.action === 'everything_search') {
                    if (!isEverythingEnabled) {
                        showInfoToast("⚠️ [사이트 및 설정] 탭에서 '에브리띵 연결' 옵션을 먼저 체크해주세요.", true);
                        return;
                    }
                    const cleanTitle = typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText;
                    let iframe = document.getElementById('bm-everything-iframe');
                    if (!iframe) {
                        iframe = document.createElement('iframe');
                        iframe.id = 'bm-everything-iframe';
                        iframe.style.display = 'none';
                        document.body.appendChild(iframe);
                    }
                    iframe.src = "es:" + encodeURIComponent(cleanTitle);
                    return;
                }

                if (btnInfo.action === 'missing_vol') {
                    const pureCleanTitle = typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText;
                    const targetNoSpace = pureCleanTitle.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim().replace(/\s+/g, '');
                    openMissingPopoverContent(targetNoSpace, btn);
                    return;
                }

                if (btnInfo.action === 'search' || btnInfo.action === 'ridi_preview' || btnInfo.action === 'everything_search') {
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
                    // [낙관적 UI] 삭제 포함 즉시 캐시 갱신
                    const pureCleanTitle = typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText;
                    const targetNoSpace = pureCleanTitle.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim().replace(/\s+/g, '');
                    
                    if (btnInfo.action === 'delete') {
                        if (exactMatchCache[targetNoSpace]) delete exactMatchCache[targetNoSpace];
                        cachedBookList = cachedBookList.filter(b => b._regBodyNoSpace !== targetNoSpace);
                    } else {
                        if (exactMatchCache[targetNoSpace]) {
                            exactMatchCache[targetNoSpace].type = btnInfo.action;
                        } else {
                            let found = false;
                            for (let i = 0; i < cachedBookList.length; i++) {
                                if (cachedBookList[i]._regBodyNoSpace === targetNoSpace) {
                                    cachedBookList[i].type = btnInfo.action;
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) { 
                                const newBook = {
                                    title: pureCleanTitle, type: btnInfo.action,
                                    resolution: linkData.siteRes ? linkData.siteRes + "px" : "",
                                    lastVol: linkData.siteVol ? linkData.siteVol.toString() : "",
                                    _regBodyOriginal: pureCleanTitle.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim(),
                                    _regBodyNoSpace: targetNoSpace
                                };
                                cachedBookList.push(newBook);
                                exactMatchCache[targetNoSpace] = newBook;
                            }
                        }
                    }

                    similarityCache[targetNoSpace] = undefined; 
                    
                    document.querySelectorAll(globalTargetSelector).forEach(el => {
                        if(el.tagName === 'A' && el._bmData) el._bmData.raw = null;
                        else if (el.querySelectorAll) {
                            el.querySelectorAll('a').forEach(a => { if(a._bmData) a._bmData.raw = null; });
                        }
                    });
                    if (globalDetailSelector) {
                        document.querySelectorAll(globalDetailSelector).forEach(el => {
                            if (el._bmDetailData) el._bmDetailData.raw = null;
                        });
                    }
                    
                    debouncedApplyStyles();

                    chrome.runtime.sendMessage({ 
                        action: "QUICK_ACTION", 
                        type: btnInfo.action,
                        cleanTitle: pureCleanTitle,
                        resolution: linkData.siteRes ? linkData.siteRes + "px" : "",
                        lastVol: linkData.siteVol ? linkData.siteVol.toString() : ""
                    }).catch(()=>{});
                    
                }
            } catch (err) {}
        };
        container.appendChild(btn);
    });
    return container;
}

function applyStyleToSingleLink(link) {
    // 핵심 방어: 이미 상세페이지 로직이 처리한 요소면 일반 링크 함수는 쳐다보지도 않고 도망감 (무한루프 차단)
    if (link.dataset.bmIsDetail === "true") return; 

    const currentRawText = link.textContent || "";
    
    if (!link._bmData || link._bmData.raw !== currentRawText) {
        const originalText = getPureLinkText(link);
        const pureTitle = typeof cleanSiteTitle === 'function' ? cleanSiteTitle(originalText) : originalText;
        
        let skip = false;
        if (pureTitle.length < 1) skip = true;
        else if (!isSupportSingleCharEnabled && pureTitle.length < 2) skip = true;
        else if (isSupportSingleCharEnabled && pureTitle.length === 1 && /^[a-zA-Z0-9]$/.test(pureTitle)) skip = true;
        else if (/^[ㄱ-ㅎㅏ-ㅣ\s]+$/.test(pureTitle)) skip = true;
        
        if (skip) {
            link._bmData = { skip: true, raw: currentRawText };
        } else {
            const siteBodyOriginal = pureTitle.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim();
            const siteBodyNoSpace = siteBodyOriginal.replace(/\s+/g, '');
            
            const siteResMatch = originalText.match(/(\d{3,4})\s*p(?:x)?/i);
            const siteRes = siteResMatch ? parseInt(siteResMatch[1], 10) : 0;
            
            let siteVol = 0;
            // [수정] 범위 뒤에 나오는 숫자가 px나 p로 끝나면 권수로 인식하지 않도록 방어 코드 추가
            const rangeMatch = originalText.match(/(\d+)\s*(?:권|화)?\s*[\~\-～〜〰∼–—_,\/&・·･]\s*(\d+)(?!\s*(?:px|p)\b)/i);
            const singleMatch = originalText.match(/(\d+)\s*(?:권|화)/);
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
        for (let i = cachedBookList.length - 1; i >= 0; i--) {
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

        // 누락 뱃지 생성 로직
        let missingHtml = '';
        if (book.missingVols && book.missingVols.length > 0) {
            let mStr = book.missingVols.join(',');
            missingHtml = '<span style="background:#7b1010; color:#fff; font-size:9px; font-weight:bold; padding:1px 4px; border-radius:3px; margin-left:4px; vertical-align:middle; display:inline-block; line-height:1.2; box-shadow:0 1px 2px rgba(0,0,0,0.2);">누락:' + mStr + '</span>';
        }

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
          newBadgeHTML = '<span style="color:#999;">' + resText + '</span><span style="color:#ccc;"> | </span><span style="color:#999;">' + volText + '</span>' + missingHtml + '<span style="color:#adb5bdfont-size:10px;margin-left:4px;" title="매칭률">(' + displayScore + '%)</span>';
          badgeStyle = "font-size:10px; background:#f8f9fa; border:1px solid #dee2e6; padding:2px 4px; border-radius:3px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2;";
        } else if (book.type === "incomplete") {
          const hasUpgrade = (siteRes > regRes && regRes > 0) || (siteVol > regVol && regVol > 0);
          link.style.setProperty("text-decoration", "none", "important");
          link.style.setProperty("color", "#d9480f", "important"); 
          link.style.setProperty("font-weight", "800", "important");
          link.style.setProperty("opacity", "1", "important");
          link.setAttribute("title", "[미완] " + book.title + " (" + displayScore + "%)");
          let resHtml = (siteRes > regRes && regRes > 0) ? '<span style="color:#ffc107; font-weight:900;">' + resText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + resText + '</span>';
          let volHtml = (siteVol > regVol && regVol > 0) ? '<span style="color:#ffc107; font-weight:900;">' + volText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + volText + '</span>';
          newBadgeHTML = resHtml + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + volHtml + missingHtml + '<span style="color:rgba(255,255,255,0.8);font-size:10px;margin-left:4px;">(' + displayScore + '%)</span>';
          let shadow = hasUpgrade ? "box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);" : "box-shadow: 0 1px 2px rgba(0,0,0,0.2);";
          badgeStyle = "font-size:10px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2; " + shadow;
        } else if (book.type === "complete") {
          const hasUpgrade = (siteRes > regRes && regRes > 0) || (siteVol > regVol && regVol > 0);
          link.style.setProperty("text-decoration", "none", "important");
          link.style.setProperty("opacity", "1", "important");
          link.setAttribute("title", "[완결] " + book.title + " (" + displayScore + "%)");
          if (hasUpgrade) {
              link.style.setProperty("color", "#d9480f", "important"); 
              link.style.setProperty("font-weight", "800", "important");
              let resHtml = (siteRes > regRes && regRes > 0) ? '<span style="color:#ffc107; font-weight:900;">' + resText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + resText + '</span>';
              let volHtml = (siteVol > regVol && regVol > 0) ? '<span style="color:#ffc107; font-weight:900;">' + volText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + volText + '</span>';
              newBadgeHTML = resHtml + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + volHtml + missingHtml + '<span style="color:rgba(255,255,255,0.8);font-size:10px;margin-left:4px;">(' + displayScore + '%)</span>';
              badgeStyle = "font-size:10px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2; box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);";
          } else {
              link.style.setProperty("color", "#0056b3", "important"); 
              link.style.setProperty("font-weight", "600", "important");
              newBadgeHTML = '<span style="color:#007bff; font-weight:normal;">' + resText + '</span><span style="color:#007bff; opacity:0.5; margin:0 4px;">|</span><span style="color:#007bff; font-weight:normal;">' + volText + '</span>' + missingHtml + '<span style="color:#868e96font-size:10px;margin-left:4px;">(' + displayScore + '%)</span>';
              badgeStyle = "font-size:10px; background:#f0f7ff; border:1px solid #007bff; padding:2px 4px; border-radius:3px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2;";
          }
        }
    } else {
        removeBadge(link);
    }

    // 뱃지 지울 때 직계 요소(:scope >)만 탐색하여 부모/자식 뱃지를 서로 오해하는 것을 방지
    const existingBadge = link.querySelector(':scope > .book-badge');
    if (newBadgeHTML) {
        if (!existingBadge || existingBadge.dataset.html !== newBadgeHTML) {
            if (existingBadge) existingBadge.remove();
            const badge = document.createElement('span');
            badge.className = 'book-badge';
            badge.style.cssText = badgeStyle;
            badge.innerHTML = newBadgeHTML;
            badge.dataset.html = newBadgeHTML;

            link.appendChild(badge);
            
            // 기존에 있던 줄바꿈과 퀵버튼을 뱃지 뒤로 밀어내어 순서가 꼬이는 현상 완벽 해결
            const existingBr = link.querySelector(':scope > .bm-badge-br.list-br');
            const existingActions = link.querySelector(':scope > .bm-quick-actions.list-actions');
            if (existingBr) link.appendChild(existingBr);
            if (existingActions) link.appendChild(existingActions);
        }
    } else if (existingBadge) {
        existingBadge.remove();
    }

    // 리스트 퀵 버튼 렌더링 (데이터가 없어도 표기하되, 작성자명 등 오작동 요소는 필터링)
    const isLikelyTitle = !!newBadgeHTML || siteRes > 0 || siteVol > 0 || siteBodyOriginal.length > 3;
    if (isShowListQuickBtn && isLikelyTitle && isAllowedBoard) {
        let existingBr = link.querySelector(':scope > .bm-badge-br.list-br');
        let existingActions = link.querySelector(':scope > .bm-quick-actions.list-actions');
        
        const siteBodyNoSpace = link._bmData.siteBodyNoSpace;
        const matchBook = exactMatchCache[siteBodyNoSpace] || (similarityCache[siteBodyNoSpace] && similarityCache[siteBodyNoSpace].book);
        const hasBook = !!matchBook;

        if (!existingActions || existingActions.dataset.hasBook !== String(hasBook)) {
            if (existingBr) existingBr.remove();
            if (existingActions) existingActions.remove();

            const br = document.createElement('br');
            br.className = 'bm-badge-br list-br';
            link.appendChild(br);

            const actions = createQuickActions(link._bmData, hasBook);
            actions.classList.add('list-actions');
            actions.dataset.hasBook = String(hasBook);
            actions.style.marginLeft = "0";
            actions.style.marginTop = "4px";
            actions.style.display = "inline-flex"; 
            link.appendChild(actions);
        }
    } else {
        // 옵션이 꺼져있거나, 잘못된 요소로 판단되었을 때 퀵버튼 제거
        let existingBr = link.querySelector(':scope > .bm-badge-br.list-br');
        let existingActions = link.querySelector(':scope > .bm-quick-actions.list-actions');
        if (existingBr) existingBr.remove();
        if (existingActions) existingActions.remove();
    }
}

function applyStyleToDetailElement(el) {
    // 핵심 방어 마커 부착: 내가 상세페이지 로직으로 찜했으니 단일 링크 로직은 건들지 마라 선언
    el.dataset.bmIsDetail = "true"; 
    
    const currentRawText = el.textContent || "";
    
    if (!el._bmDetailData || el._bmDetailData.raw !== currentRawText) {
        const originalText = getPureLinkText(el);
        const pureTitle = typeof cleanSiteTitle === 'function' ? cleanSiteTitle(originalText) : originalText;
        
        let skip = false;
        if (pureTitle.length < 1) skip = true;
        else if (!isSupportSingleCharEnabled && pureTitle.length < 2) skip = true;
        else if (isSupportSingleCharEnabled && pureTitle.length === 1 && /^[a-zA-Z0-9]$/.test(pureTitle)) skip = true;
        else if (/^[ㄱ-ㅎㅏ-ㅣ\s]+$/.test(pureTitle)) skip = true;

        if (skip) {
            el._bmDetailData = { skip: true, raw: currentRawText };
        } else {
            const siteBodyOriginal = pureTitle.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim();
            const siteBodyNoSpace = siteBodyOriginal.replace(/\s+/g, '');
            
            const siteResMatch = originalText.match(/(\d{3,4})\s*p(?:x)?/i);
            const siteRes = siteResMatch ? parseInt(siteResMatch[1], 10) : 0;
            
            let siteVol = 0;
            // [수정] 범위 뒤에 나오는 숫자가 px나 p로 끝나면 권수로 인식하지 않도록 방어 코드 추가
            const rangeMatch = originalText.match(/(\d+)\s*(?:권|화)?\s*[\~\-～〜〰∼–—_,\/&・·･]\s*(\d+)(?!\s*(?:px|p)\b)/i);
            const singleMatch = originalText.match(/(\d+)\s*(?:권|화)/);
            const lastNumMatch = originalText.match(/(\d+)\s*(?=[\[\(]|$)/);

            if (rangeMatch) siteVol = parseInt(rangeMatch[2], 10);
            else if (singleMatch) siteVol = parseInt(singleMatch[1], 10);
            else if (lastNumMatch) siteVol = parseInt(lastNumMatch[1], 10);

            el._bmDetailData = { skip: false, pureTitle, siteBodyOriginal, siteBodyNoSpace, siteRes, siteVol, raw: currentRawText, originalText };
        }
    }

    if (el._bmDetailData.skip) {
        removeBadge(el);
        const act = el.querySelector(':scope > .bm-quick-actions'); // 직계만 탐색
        if (act) act.remove(); 
        const bbr = el.querySelector(':scope > .bm-badge-br'); // 직계만 탐색
        if (bbr) bbr.remove();
        return;
    }

    el.style.setProperty("white-space", "normal", "important");
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("text-overflow", "clip", "important");
    el.style.setProperty("word-break", "break-all", "important");
    el.style.setProperty("height", "auto", "important");
    el.style.setProperty("line-height", "1");
    el.style.setProperty("margin-bottom", "10px", "important"); 
    
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
        for (let i = cachedBookList.length - 1; i >= 0; i--) {
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
        // 매칭된 도서가 있다면 툴팁에 등록된 데이터의 책 제목을 표기합니다.
        el.setAttribute("title", "등록된 책 제목: " + book.title);

        const regRes = book.resolution ? parseInt(book.resolution.replace(/[^0-9]/g, ''), 10) : 0;
        const regVol = book.lastVol ? parseInt(book.lastVol, 10) : 0;
        const displayScore = Math.round(maxScore);
        const resText = book.resolution || '-';
        const volText = book.lastVol ? book.lastVol + '권' : '-';

        // 누락 뱃지 생성 로직
        let missingHtml = '';
        if (book.missingVols && book.missingVols.length > 0) {
            let mStr = book.missingVols.join(',');
            missingHtml = '<span style="background:#7b1010; color:#fff; font-size:9px; font-weight:bold; padding:1px 4px; border-radius:3px; margin-left:5px; vertical-align:middle; display:inline-block; line-height:1.2; box-shadow:0 1px 2px rgba(0,0,0,0.2);">누락:' + mStr + '</span>';
        }

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
          newBadgeHTML = '<span style="color:#999;">' + resText + '</span><span style="color:#ccc;"> | </span><span style="color:#999;">' + volText + '</span>' + missingHtml + '<span style="color:#adb5bdfont-size:10px;margin-left:4px;" title="매칭률">(' + displayScore + '%)</span>';
          badgeStyle = "font-size:11px; font-weight:bold; background:#f8f9fa; border:1px solid #dee2e6; padding:2px 5px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2; text-decoration:none !important; opacity:1 !important;";
        } else if (book.type === "incomplete") {
          const hasUpgrade = (siteRes > regRes && regRes > 0) || (siteVol > regVol && regVol > 0);
          el.style.setProperty("text-decoration", "none", "important");
          el.style.setProperty("color", "#d9480f", "important"); 
          el.style.setProperty("font-weight", "800", "important");
          let resHtml = (siteRes > regRes && regRes > 0) ? '<span style="color:#ffc107; font-weight:900;">' + resText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + resText + '</span>';
          let volHtml = (siteVol > regVol && regVol > 0) ? '<span style="color:#ffc107; font-weight:900;">' + volText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + volText + '</span>';
          newBadgeHTML = resHtml + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + volHtml + missingHtml + '<span style="color:rgba(255,255,255,0.8);font-size:10px;margin-left:4px;">(' + displayScore + '%)</span>';
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
              newBadgeHTML = resHtml + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + volHtml + missingHtml + '<span style="color:rgba(255,255,255,0.8);font-size:10px;margin-left:4px;">(' + displayScore + '%)</span>';
              badgeStyle = "font-size:11px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2; box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);";
          } else {
              el.style.setProperty("color", "#0056b3", "important"); 
              el.style.setProperty("font-weight", "600", "important");
              newBadgeHTML = '<span style="color:#007bff; font-weight:normal;">' + resText + '</span><span style="color:#007bff; opacity:0.5; margin:0 4px;">|</span><span style="color:#007bff; font-weight:normal;">' + volText + '</span>' + missingHtml + '<span style="color:#868e96font-size:10px;margin-left:4px;">(' + displayScore + '%)</span>';
              badgeStyle = "font-size:11px; background:#f0f7ff; border:1px solid #007bff; padding:2px 5px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2;";
          }
        }
    } else {
        // 매칭된 도서가 없다면 추출된 제목을 유지합니다.
        el.setAttribute("title", "추출된 책 제목: " + el._bmDetailData.pureTitle);
        removeBadge(el); 
    }

    // 직계 자손(:scope >)만 탐색하도록 교체! (엄한 자식 뱃지를 지우는 대참사 방지)
    let existingBadge = el.querySelector(':scope > .book-badge');
    let existingBr = el.querySelector(':scope > .bm-badge-br');
    let existingActions = el.querySelector(':scope > .bm-quick-actions');

    const needsBadgeUpdate = newBadgeHTML && (!existingBadge || existingBadge.dataset.html !== newBadgeHTML);
    const needsBadgeRemoval = !newBadgeHTML && existingBadge;
    const needsActionsUpdate = isAllowedBoard ? (!existingActions || existingActions.dataset.hasBook !== String(!!book)) : !!existingActions;
    const needsBr = isAllowedBoard ? !existingBr : !!existingBr;

    // 변경 사항이 하나라도 있을 때만 기존 요소를 뜯어내고 다시 그립니다
    if (needsBadgeUpdate || needsBadgeRemoval || needsActionsUpdate || needsBr) {
        if (existingBadge) existingBadge.remove();
        if (existingBr) existingBr.remove();
        if (existingActions) existingActions.remove();

        if (newBadgeHTML) {
            const badge = document.createElement('span');
            badge.className = 'book-badge';
            badge.style.cssText = badgeStyle;
            badge.innerHTML = newBadgeHTML;
            badge.dataset.html = newBadgeHTML;
            el.appendChild(badge);
        }

        if (isAllowedBoard) {
            const br = document.createElement('br');
            br.className = 'bm-badge-br';
            el.appendChild(br);

            const actions = createQuickActions(el._bmDetailData, !!book);
            actions.dataset.hasBook = !!book;
            actions.style.marginLeft = "0";
            actions.style.marginTop = "5px";
            el.appendChild(actions);
        }
    }

    const hostname = window.location.hostname;
    if (hostname.includes('tcafe') || hostname.includes('tcafed')) {
        let downloadArea = null;
        const dlLink = document.querySelector('a[href*="download.php?bo_table="]');
        if (dlLink) {
            downloadArea = dlLink.closest('.well, #bo_v_file, .view-attach') || dlLink.parentElement;
        } else {
            downloadArea = document.querySelector('.well');
        }

        if (downloadArea && downloadArea.dataset.moved !== 'true') {
            downloadArea.dataset.moved = 'true'; 
            downloadArea.style.marginTop = '15px';
            downloadArea.style.display = 'block';
            downloadArea.style.clear = 'both'; 
            if (el.parentNode) {
                el.parentNode.insertBefore(downloadArea, el.nextSibling);
            }
        }
    }
}

let applyStylesTimer = null;
let applyStylesFrame = null;

function debouncedApplyStyles() {
    if (applyStylesTimer) clearTimeout(applyStylesTimer);
    applyStylesTimer = setTimeout(() => { applyStyles(); }, 10); 
}

function applyStyles() {
  if (!chrome.runtime?.id || !isDataLoaded || !isTargetSite) return;
  
  if (globalAllowedDLs.length > 0) injectDirectDownloadButtons(globalAllowedDLs);

  // tcafe21.com 보드 필터 적용 대상인 경우 4번째 td(작성자)를 5번째 td(날짜) 위로 이동
  const hostname = window.location.hostname;
  if ((hostname.includes("tcafe") || hostname.includes("tcafed")) && isAllowedBoard) {
      document.querySelectorAll('#fboardlist table tbody tr').forEach(tr => {
          const td4 = tr.querySelector('td:nth-child(4)');
          const td5 = tr.querySelector('td:nth-child(5)');
          const td6 = tr.querySelector('td:nth-child(6)');
          const td7 = tr.querySelector('td:nth-child(7)');
          
          if (td4 && td5 && !tr.dataset.authorMoved) {
              const authorDiv = document.createElement('div');
              const authorText = td4.textContent.trim();
              console.log('작성자명:', authorText); // 작성자명 로그 추가
              if (authorText === '익명') {
                  authorDiv.innerHTML = '';
              } else if (authorText === '운영자') {
                  authorDiv.innerHTML = '';
              } else {
                  const views = td6 ? td6.textContent.trim() : '0';
                  const recs = td7 ? td7.textContent.trim() : '0';
                  authorDiv.innerHTML = `${td4.innerHTML} / ${views} / ${recs}`;
              }
              
              authorDiv.style.fontSize = "11px";
              authorDiv.style.color = "#868e96";
              authorDiv.style.marginBottom = "2px";
              td5.insertBefore(authorDiv, td5.firstChild);
              tr.dataset.authorMoved = "true"; // 중복 이동 방지
          }
      });
  }

  if (globalDetailSelector) {
      const detailEls = document.querySelectorAll(globalDetailSelector);
      for(let i=0; i<detailEls.length; i++) applyStyleToDetailElement(detailEls[i]);
  }

  const targetAreas = document.querySelectorAll(globalTargetSelector);
  let allLinks = [];

  targetAreas.forEach(area => {
    if (area.tagName === 'A') allLinks.push(area);
    else {
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

  processUselessComments();

  let index = 0;
  const maxOpsPerFrame = 30000;
  let currentBookCount = Math.max(1, cachedBookList.length);
  const chunkSize = Math.max(10, Math.floor(maxOpsPerFrame / currentBookCount)); 

  function processChunk() {
      const end = Math.min(index + chunkSize, allLinks.length);
      for (; index < end; index++) applyStyleToSingleLink(allLinks[index]);
      if (index < allLinks.length) applyStylesFrame = requestAnimationFrame(processChunk);
  }
  applyStylesFrame = requestAnimationFrame(processChunk);
}

function generateOptimalSelector(el) {
    if (!el) return '';
    if (el.nodeType === 3) el = el.parentElement; 
    const classes = Array.from(el.classList).filter(c => !['hover','active','focus'].includes(c));
    if (classes.length > 0) return el.tagName.toLowerCase() + '.' + classes.join('.');
    return el.tagName.toLowerCase();
}

chrome.storage.local.get({ allowedSites: [], bookList: [], showDownloadUI: true, hideUselessComments: true, connectEverything: false, showListQuickBtn: false, showListQuickBtnHover: false, useCustomTheme: false, supportSingleChar: false }, (data) => {
    initDataCache(data);

    if (isTargetSite) {
        let fixStyle = document.getElementById('bm-custom-style');
        if (!fixStyle) {
            fixStyle = document.createElement('style');
            fixStyle.id = 'bm-custom-style';
            document.head.appendChild(fixStyle);
        }
        let styleContent = ".list-subject > div[style*=\"float:left\"], .list-subject > div[style*=\"float: left\"] { position: relative !important; z-index: 10 !important; } .list-subject a.ellipsis { position: relative !important; z-index: 1 !important; }";
        if (globalCustomCss && isAllowedBoard) styleContent += "\n" + globalCustomCss;
        if (globalThemeCss && isAllowedBoard && isCustomThemeEnabled) styleContent += "\n" + globalThemeCss;
        if (isShowListQuickBtnHover) styleContent += "\n.bm-quick-actions.list-actions { opacity: 0 !important; visibility: hidden !important; transition: opacity 0.2s, visibility 0.2s; }\na:hover .bm-quick-actions.list-actions, td:hover .bm-quick-actions.list-actions, li:hover .bm-quick-actions.list-actions, div.list-item:hover .bm-quick-actions.list-actions { opacity: 1 !important; visibility: visible !important; }";
        fixStyle.textContent = styleContent;

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
        if (config && config.thumbSelector && (config.getHighResUrl || config.getHighResUrlAsync)) {
            const hoverContainer = getOrCreateHoverContainer();
            const previewImg = document.getElementById('book-manager-hover-img');
            const hoverSpinner = document.getElementById('book-manager-hover-spinner'); 

            let hoverTimer = null;
            let currentThumb = null;

            document.addEventListener('mouseover', async (e) => {
                const thumb = e.target.closest(config.thumbSelector);
                if (!thumb || thumb.tagName !== 'IMG') return;
                if (config.selector && !thumb.closest(config.selector)) return;
                if (config.excludeThumbSelector && config.excludeThumbSelector && thumb.closest(config.excludeThumbSelector)) return;
                
                currentThumb = thumb;
                if (thumb.dataset.isHighResReplaced === "true") {
                    previewImg.src = thumb.src;
                    previewImg.style.filter = "none";
                    hoverContainer.style.display = 'block';
                    hoverSpinner.style.display = 'none';
                    return;
                }

                previewImg.src = thumb.src;
                previewImg.style.filter = "blur(8px)";
                hoverContainer.style.display = 'block';
                hoverSpinner.style.display = 'block'; 

                if (hoverTimer) clearTimeout(hoverTimer);

                let highResSrc = "";
                if (config.getHighResUrlAsync) highResSrc = await config.getHighResUrlAsync(thumb);
                else if (config.getHighResUrl) highResSrc = config.getHighResUrl(thumb.src);

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
                            thumb.src = highResSrc;
                            thumb.dataset.isHighResReplaced = "true"; 
                        }
                    };
                    tempImg.onerror = () => {
                        if (currentThumb === thumb) hoverSpinner.style.display = 'none';
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
                  if (typeof existing === 'string') existing = { url: existing, detailSelector: selector };
                  else {
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
          
          chrome.storage.local.get({ allowedSites: [], bookList: [], showDownloadUI: true, connectEverything: false, showListQuickBtn: false, showListQuickBtnHover: false, useCustomTheme: false, supportSingleChar: false }, (data) => {
              initDataCache(data);
              document.querySelectorAll(globalTargetSelector).forEach(el => {
                  if(el.tagName === 'A' && el._bmData) el._bmData.raw = null;
                  else if (el.querySelectorAll) {
                      el.querySelectorAll('a').forEach(a => { if(a._bmData) a._bmData.raw = null; });
                  }
              });
              if (globalDetailSelector) {
                  document.querySelectorAll(globalDetailSelector).forEach(el => {
                      if (el._bmDetailData) el._bmDetailData.raw = null;
                  });
              }
              debouncedApplyStyles();
          });
      } else if (request.action === "SHOW_INFO_TOAST") {
          showInfoToast(request.msg, request.isError);
      } else if (request.action === "UPDATE_DOWNLOAD_PROGRESS") {
          if (isDownloadUIEnabled) updateDownloadUI(request.downloads);
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
                chrome.runtime.sendMessage({ action: "INJECT_BYPASS_SCRIPT", keywords: activeConfig.autoConfirmKeywords }).catch(()=>{});
            } catch (err) {}
        }
    }
});

let isTabStale = true; 

document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isTabStale) {
        isTabStale = false;
        chrome.storage.local.get({ allowedSites: [], bookList: [], showDownloadUI: true, hideUselessComments: true, connectEverything: false, showListQuickBtn: false, showListQuickBtnHover: false, useCustomTheme: false, supportSingleChar: false }, (data) => {
            initDataCache(data);
            debouncedApplyStyles();
        });
    } else if (document.hidden) {
        isTabStale = true; 
    }
});

window.addEventListener("focus", () => {
    if (!document.hidden && isTabStale) {
        isTabStale = false;
        chrome.storage.local.get({ allowedSites: [], bookList: [], showDownloadUI: true, hideUselessComments: true, connectEverything: false, showListQuickBtn: false, showListQuickBtnHover: false, useCustomTheme: false, supportSingleChar: false }, (data) => {
            initDataCache(data);
            debouncedApplyStyles();
        });
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        chrome.storage.local.get({ allowedSites: [], bookList: [], showDownloadUI: true, hideUselessComments: true, connectEverything: false, showListQuickBtn: false, showListQuickBtnHover: false, useCustomTheme: false, supportSingleChar: false }, (data) => {
            initDataCache(data);

            // 실시간 테마 토글 적용/해제
            let fixStyle = document.getElementById('bm-custom-style');
            if (fixStyle) {
                let styleContent = ".list-subject > div[style*=\"float:left\"], .list-subject > div[style*=\"float: left\"] { position: relative !important; z-index: 10 !important; } .list-subject a.ellipsis { position: relative !important; z-index: 1 !important; }";
                if (globalCustomCss && isAllowedBoard) styleContent += "\n" + globalCustomCss;
                if (globalThemeCss && isAllowedBoard && isCustomThemeEnabled) styleContent += "\n" + globalThemeCss;
                if (isShowListQuickBtnHover) styleContent += "\n.bm-quick-actions.list-actions { opacity: 0 !important; visibility: hidden !important; transition: opacity 0.2s, visibility 0.2s; }\na:hover .bm-quick-actions.list-actions, td:hover .bm-quick-actions.list-actions, li:hover .bm-quick-actions.list-actions, div.list-item:hover .bm-quick-actions.list-actions { opacity: 1 !important; visibility: visible !important; }";
                fixStyle.textContent = styleContent;
            }

            // 기존 렌더링 캐시 강제 초기화하여 즉시 변경사항 반영 유도
            document.querySelectorAll(globalTargetSelector).forEach(el => {
                if (el.tagName === 'A' && el._bmData) el._bmData.raw = null;
                else if (el.querySelectorAll) {
                    el.querySelectorAll('a').forEach(a => { if (a._bmData) a._bmData.raw = null; });
                }
            });

            if (globalDetailSelector) {
                document.querySelectorAll(globalDetailSelector).forEach(el => {
                    if (el._bmDetailData) el._bmDetailData.raw = null;
                });
            }

            debouncedApplyStyles();
        });
    }
});