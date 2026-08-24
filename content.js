// [사이트 분리 로직] 사이트별로 허용할 다운로드 모듈을 제한합니다.
const BM_STORAGE_DEFAULTS = { allowedSites: [], bookList: [], missingVolsMap: {}, editionKeywords: getDefaultEditionKeywords(), showDownloadUI: true, hideUselessComments: true, connectEverything: false, showListQuickBtn: false, showListQuickBtnHover: false, useCustomTheme: false, supportSingleChar: false, hideExclude: false, hideComplete: false, hideIncomplete: false, hideTranslate: false, hideNew: false, hideQuickMenu: false };

function isExtensionContextValid() {
    try {
        return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
        return false;
    }
}

function ignoreLastError() {
    try {
        void chrome.runtime.lastError;
    } catch (e) {}
}

function sendRuntimeMessage(message) {
    if (!isExtensionContextValid()) return;
    try {
        chrome.runtime.sendMessage(message, ignoreLastError);
    } catch (e) {}
}

function safeStorageGet(defaults, callback) {
    if (!isExtensionContextValid()) return false;
    try {
        chrome.storage.local.get(defaults, (data) => {
            if (!isExtensionContextValid()) return;
            callback(data);
        });
        return true;
    } catch (e) {
        return false;
    }
}

function safeStorageSet(values, callback) {
    if (!isExtensionContextValid()) return false;
    try {
        chrome.storage.local.set(values, () => {
            ignoreLastError();
            if (callback && isExtensionContextValid()) callback();
        });
        return true;
    } catch (e) {
        return false;
    }
}

function stripEditionTagsForEverythingSearch(title) {
    const normalizedTitle = String(title || '')
        .replace(/&lt;/gi, '(')
        .replace(/&gt;/gi, ')')
        .replace(/</g, '(')
        .replace(/>/g, ')');

    return normalizedTitle
        .replace(/\(([^()]*)\)|\[([^\[\]]*)\]|（([^（）]*)）|【([^【】]*)】|<([^<>]*)>/g, (fullMatch, round, square, fullWidthRound, lenticular, angle) => {
            const innerText = round ?? square ?? fullWidthRound ?? lenticular ?? angle ?? '';
            return isEditionQualifier(innerText) ? ' ' : fullMatch;
        })
        .replace(/\s+/g, ' ')
        .trim();
}

const PRE_DEFINED_SITES = [
{ 
    url: "tcafe21.com", 
    selector: ".board-hot-posts, #fboardlist .list-subject",
    thumbSelector: "img", 
    excludeThumbSelector: ".board-thumbnail",
    hideSelector: "tr",
    allowedDLs: ["giga", "gofile", "transfer"],
    autoConfirmKeywords: ["포인트", "열람"], 
    boardFilter: /[?&]bo_table=D2002|D2003(?:&|#|$)/i,
    boardFilter2: /[?&]bo_table=(?:D1007|D1104|D1103|D1201|D1102|D1101|D1011|D2001|D1106)(?:&|#|$)/i,
    boardCss2: `
        #fboardlist table { display: block !important; width: 100%; }
        #fboardlist thead { display: none !important; }
        #fboardlist tbody { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; padding: 10px 0; align-items: stretch !important; }
        #fboardlist tr { display: flex !important; flex-direction: row !important; flex-wrap: wrap !important; align-content: flex-start !important; align-items: flex-start !important; background-color: #ffffff; border: 1px solid #e0e0e0 !important; border-radius: 8px; padding: 12px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05); transition: transform 0.2s ease, box-shadow 0.2s ease; box-sizing: border-box !important; height: 100% !important; }

        #fboardlist tr:hover { transform: translateY(-4px); box-shadow: 0 6px 12px rgba(0, 0, 0, 0.1); }

        #fboardlist td { display: block !important; text-align: left !important; border: none !important; padding: 0 !important; font-size: 13px; box-sizing: border-box !important; }
        #fboardlist td:nth-child(1) { display: none !important; }

        #fboardlist td:nth-child(3) { order: 1; width: 100% !important; flex-basis: 100% !important; margin-bottom: 8px !important; }

        #fboardlist td:nth-child(3) > div,
        #fboardlist td:nth-child(3) > a:has(img) { float: none !important; display: block !important; width: 100% !important; max-height: none !important; height: auto !important; overflow: visible !important; }

        #fboardlist td:nth-child(3) span { display: inline !important; width: auto !important; float: none !important; margin-left: 4px !important; }
        #fboardlist td:nth-child(3) img:not([src*="icon"]){ display: block !important; width: 100% !important; height: 220px !important; min-height: 220px !important; max-height: 220px !important; object-fit: cover !important; border-radius: 6px !important; background-color: #f5f5f5 !important; margin: 0 0 10px 0 !important; padding: 0 !important; border: none !important; flex-shrink: 0 !important; }

        #fboardlist td:nth-child(3) img[src*="icon"]{ width: auto !important; height: auto !important; min-height: 0 !important; display: inline-block !important; margin: 0 2px !important; }

        #fboardlist td:nth-child(3) a.bo_tit,
        #fboardlist td:nth-child(3) a:not(:has(img)) { display: inline !important; font-weight: 600 !important; font-size: 14px !important; line-height: 1.4 !important; color: #333 !important; text-decoration: none !important; white-space: normal !important; }

        #fboardlist td:nth-child(2),
        #fboardlist td:nth-child(4),
        #fboardlist td:nth-child(5),
        #fboardlist td:nth-child(6),
        #fboardlist td:nth-child(7) { order: 2; width: auto !important; flex-basis: auto !important; margin-right: 8px !important; font-size: 12px !important; display: inline-block !important; margin-top: 0 !important; margin-bottom: 0 !important; }

        #fboardlist td:nth-child(2) { color: #007bff !important; font-weight: bold !important; }

        #fboardlist td:nth-child(4),
        #fboardlist td:nth-child(5),
        #fboardlist td:nth-child(6),
        #fboardlist td:nth-child(7) { color: #888888 !important; }

        #fboardlist td:nth-child(6)::before { content: "조회 "; }
        #fboardlist td:nth-child(7)::before { content: "추천 "; }        
    `,
    boardJS2: () => {
        observeBoardJS2Targets();
    },
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




        
    `,
    themeCss: `
        @import url('https://fonts.googleapis.com/css2?family=Jua&display=swap');
        
        #fboardlist table th:nth-child(1),#fboardlist table td:nth-child(1),
        #fboardlist table th:nth-child(4), #fboardlist table td:nth-child(4),
        #fboardlist table th:nth-child(6), #fboardlist table td:nth-child(6),
        #fboardlist table th:nth-child(7), #fboardlist table td:nth-child(7) {
            display: none !important;
        }
            
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
    url: "lamu.club", 
    selector: ".board-hot-posts, #fboardlist .list-subject",
    detailSelector: ".view-wrap > h1",
    thumbSelector: "img", 
    excludeThumbSelector: ".board-thumbnail",
    hideSelector: "tr",
    allowedDLs: ["giga", "gofile", "transfer"],
    autoConfirmKeywords: ["포인트", "열람"], 
    boardFilter: /[?&]bo_table=D2002|D2003(?:&|#|$)/i,
    boardFilter2: /[?&]bo_table=(?:D1007|D1104|D1103|D1201|D1102|D1101|D1011|D2001|D1106)(?:&|#|$)/i,
    boardCss2: `
        #fboardlist table { display: block !important; width: 100%; }
        #fboardlist thead { display: none !important; }
        #fboardlist tbody { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; padding: 10px 0; align-items: stretch !important; }
        #fboardlist tr { display: flex !important; flex-direction: row !important; flex-wrap: wrap !important; align-content: flex-start !important; align-items: flex-start !important; background-color: #ffffff; border: 1px solid #e0e0e0 !important; border-radius: 8px; padding: 12px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05); transition: transform 0.2s ease, box-shadow 0.2s ease; box-sizing: border-box !important; height: 100% !important; }

        #fboardlist tr:hover { transform: translateY(-4px); box-shadow: 0 6px 12px rgba(0, 0, 0, 0.1); }

        #fboardlist td { display: block !important; text-align: left !important; border: none !important; padding: 0 !important; font-size: 13px; box-sizing: border-box !important; }
        #fboardlist td:nth-child(1) { display: none !important; }

        #fboardlist td:nth-child(3) { order: 1; width: 100% !important; flex-basis: 100% !important; margin-bottom: 8px !important; }

        #fboardlist td:nth-child(3) > div,
        #fboardlist td:nth-child(3) > a:has(img) { float: none !important; display: block !important; width: 100% !important; max-height: none !important; height: auto !important; overflow: visible !important; }

        #fboardlist td:nth-child(3) span { display: inline !important; width: auto !important; float: none !important; margin-left: 4px !important; }
        #fboardlist td:nth-child(3) img:not([src*="icon"]){ display: block !important; width: 100% !important; height: 220px !important; min-height: 220px !important; max-height: 220px !important; object-fit: cover !important; border-radius: 6px !important; background-color: #f5f5f5 !important; margin: 0 0 10px 0 !important; padding: 0 !important; border: none !important; flex-shrink: 0 !important; }

        #fboardlist td:nth-child(3) img[src*="icon"]{ width: auto !important; height: auto !important; min-height: 0 !important; display: inline-block !important; margin: 0 2px !important; }

        #fboardlist td:nth-child(3) a.bo_tit,
        #fboardlist td:nth-child(3) a:not(:has(img)) { display: inline !important; font-weight: 600 !important; font-size: 14px !important; line-height: 1.4 !important; color: #333 !important; text-decoration: none !important; white-space: normal !important; }

        #fboardlist td:nth-child(2),
        #fboardlist td:nth-child(4),
        #fboardlist td:nth-child(5),
        #fboardlist td:nth-child(6),
        #fboardlist td:nth-child(7) { order: 2; width: auto !important; flex-basis: auto !important; margin-right: 8px !important; font-size: 12px !important; display: inline-block !important; margin-top: 0 !important; margin-bottom: 0 !important; }

        #fboardlist td:nth-child(2) { color: #007bff !important; font-weight: bold !important; }

        #fboardlist td:nth-child(4),
        #fboardlist td:nth-child(5),
        #fboardlist td:nth-child(6),
        #fboardlist td:nth-child(7) { color: #888888 !important; }

        #fboardlist td:nth-child(6)::before { content: "조회 "; }
        #fboardlist td:nth-child(7)::before { content: "추천 "; }        
    `,
    boardJS2: () => {
        observeBoardJS2Targets();
    },
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




        
    `,
    themeCss: `
        @import url('https://fonts.googleapis.com/css2?family=Jua&display=swap');
        
        #fboardlist table th:nth-child(1),#fboardlist table td:nth-child(1),
        #fboardlist table th:nth-child(4), #fboardlist table td:nth-child(4),
        #fboardlist table th:nth-child(6), #fboardlist table td:nth-child(6),
        #fboardlist table th:nth-child(7), #fboardlist table td:nth-child(7) {
            display: none !important;
        }
            
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
    url: "ridibooks.com", 
    selector: "#books_contents h1, .infinite-scroll-component div>a", 
    hideSelector: "li, .rigrid-31l7gp", 
    allowedDLs: []
},
{
    url: "chating.wiki",
    selector: "a.cw-board-item",
    detailSelector: ".cw-article-header > h1",
    hideSelector: "a",
    allowedDLs: ["giga", "gofile", "transfer"],
    autoConfirmKeywords: ["자료 이용권을 받을까요?"], 
    boardFilter: new RegExp([
        '[?&]bo_table=(?:sub_manga|manga_jic|joy_new|joy_mh|joy_lv|joy_rofan|books|joy_fan|joy_ai|19novel|joy_bell|joy_fan_request)(?:&|#|$)',
        '/게시판/남성향/(?:전체|최신작|판타지|현대판타지|현판|무협-선협|무협/선협|번역|라노벨|일반서적|만화-웹툰|애니|영화|드라마|라노벨|대체역사|성인소설|일반서적)(?=/|[?#]|$)',
        '/게시판/여성향/(?:최신작|로맨스-로판|BELL|만화-웹툰)(?=/|[?#]|$)'
    ].join('|'), 'i'),
    commentSelector: ".cw-comment-body",
    commentWrapperSelector: ".cw-comment-list > article",
    customCss: `
        .cw-article-header .bm-quick-actions{background:none !important;border:0 !important;  padding-left: 0 !important}
        .cw-article-materials{margin-top:20px !important}
        .cw-article-material__copy h3{overflow:visible !important}
    `,
    themeCss: `
    `,
    customJS: () => {
        const openActions = document.querySelectorAll('.cw-material-open-action');
        let isModified = false;
        
        openActions.forEach(actionBtn => {
            const materialContainer = actionBtn.closest('.cw-article-material');
            // 처리된 요소는 건너뛰기 (applyStyles가 여러 번 실행되어도 중복되지 않게 막아줍니다)
            if (!materialContainer || materialContainer.dataset.bmLinkProcessed === "true") return;

            const h3Element = materialContainer.querySelector('h3');
            if (!h3Element) return;

            const textValue = h3Element.textContent.trim();
            const urlRegex = /(https?:\/\/[^\s]+)/i;
            const match = textValue.match(urlRegex);

            if (match && match[1]) {
                const targetUrl = match[1];

                // h3 요소의 텍스트를 클릭 가능한 a 태그로 교체
                h3Element.innerHTML = `<a href="${targetUrl}" target="_blank" style="color: #1e90ff; text-decoration: underline; word-break: break-all;">${textValue}</a>`;
                
                // 중복 변경 방지 마커 설정
                materialContainer.dataset.bmLinkProcessed = "true";
                isModified = true;
            }
        });

        // a 태그가 새로 생성되었다면, 확실한 배열 값을 직접 주입하여 즉시 다운로드 버튼 생성
        if (isModified && typeof injectDirectDownloadButtons === 'function') {
            injectDirectDownloadButtons(["giga", "gofile", "transfer"]);
        }

    }
}, 
{ 
    url: "hellkaiv.net", 
    selector: "#gall_ul .bo_tit", 
    hideSelector: "li",
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
    hideSelector: ".a-carousel-card, div[data-asin], .s-result-item",
    allowedDLs: [] 
},
{ url: "example.com", selector: "#board_list", hideSelector: "li", allowedDLs: [] }
];

let globalAllowedDLs = [];
let globalTargetSelector = 'a';
let globalDetailSelector = ''; 
let globalHideSelector = '';
let isHideExclude = false;
let isHideComplete = false;
let isHideIncomplete = false;
let isHideTranslate = false;
let isHideNew = false;
let isHideQuickMenu = false;
let globalCustomCss = '';
let globalThemeCss = '';
let globalBoardCss2 = '';
let globalBoardJS2 = null;
let isBoardJS2Executed = false;

let isTargetSite = false;
let exactMatchCache = {};
let cachedBookList = [];
let isDataLoaded = false;

let similarityCache = {};
let lastRightClickedLink = null; 
let lastRightClickedElement = null; 

let isDownloadUIEnabled = true; 
let titleProcessingCache = new Map(); 
let titleProcessingEditionSignature = '';
let isEverythingEnabled = false;
let isShowListQuickBtn = false;
let isShowListQuickBtnHover = false;
let isCustomThemeEnabled = false;
let isAllowedBoard = true;
let isSupportSingleCharEnabled = false;
let isHideUselessCommentsEnabled = true;
let isBoardJS2Initialized = false;
let boardJS2Observer = null;
let boardJS2TargetsQueue = [];
let boardJS2PendingProcessTimer = null;
let boardJS2IsProcessing = false;
let isBoardJS2Scheduled = false;
const boardJS2BatchSize = 4;
const boardJS2ProcessDelay = 120;
const boardJS2TargetSelector = ".board-thumbnail img, img.board-thumbnail, .list-subject>div>a>img";

function removeVQuery(query) {
    if (!query) return '';
    const filtered = query
        .split('&')
        .filter((param) => {
            const eqIndex = param.indexOf('=');
            const key = (eqIndex === -1 ? param : param.slice(0, eqIndex)).trim().toLowerCase();
            return key !== 'v';
        })
        .join('&');
    return filtered ? `?${filtered}` : '';
}

function sanitizeDownloadFolderSegment(name) {
    return String(name || '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildDownloadFolder(folderRule, fallbackTitle) {
    const safeTitle = sanitizeDownloadFolderSegment(fallbackTitle);

    if (!folderRule || !String(folderRule).trim()) {
        return safeTitle;
    }

    const normalizedRule = String(folderRule).trim().replace(/\\/g, '/');
    const safeSegments = normalizedRule
        .split('/')
        .map((segment) => sanitizeDownloadFolderSegment(segment))
        .filter((segment) => segment.length > 0);

    if (safeSegments.length === 0) {
        return safeTitle;
    }

    if (!safeTitle) {
        return safeSegments.join('/');
    }

    return `${safeSegments.join('/')}/${safeTitle}`;
}

function normalizeBoardImageUrl(source) {
    const hashStart = source.indexOf('#');
    const hashPart = hashStart === -1 ? '' : source.slice(hashStart);
    const sourceWithoutHash = hashStart === -1 ? source : source.slice(0, hashStart);
    const queryStart = sourceWithoutHash.indexOf('?');
    const basePart = queryStart === -1 ? sourceWithoutHash : sourceWithoutHash.slice(0, queryStart);
    const queryPart = queryStart === -1 ? '' : sourceWithoutHash.slice(queryStart + 1);

    const sourceName = basePart.slice(basePart.lastIndexOf('/') + 1);
    const lowerSourceName = sourceName.toLowerCase();
    const isGifOrPng = lowerSourceName.endsWith('.gif') || lowerSourceName.endsWith('.png');
    const cleanQuery = removeVQuery(queryPart);
    const lastSlash = basePart.lastIndexOf('/');
    const sourcePath = lastSlash === -1 ? '' : basePart.slice(0, lastSlash + 1);
    let imageBase = sourceName;

    if (isGifOrPng) {
        imageBase = imageBase.replace(/^thumb2-/, '')
            .replace(/_65x50(?=\.[^./?#]+$)/i, '')
            .replace(/_480p(?=\.[^./?#]+$)/i, '');
    } else {
        imageBase = imageBase.replace(/_65x50(?=(?:\.[^./?#]+|$))/i, '_480p');
    }

    return `${sourcePath}${imageBase}` + cleanQuery + hashPart;
}

function resetBoardJS2State() {
    boardJS2TargetsQueue = [];
    isBoardJS2Scheduled = false;
    if (boardJS2PendingProcessTimer) {
        clearTimeout(boardJS2PendingProcessTimer);
        boardJS2PendingProcessTimer = null;
    }
    boardJS2IsProcessing = false;
    if (boardJS2Observer) {
        boardJS2Observer.disconnect();
        boardJS2Observer = null;
    }
    isBoardJS2Initialized = false;
}

function stopBoardJS2Observer() {
    if (boardJS2Observer) {
        boardJS2Observer.disconnect();
        boardJS2Observer = null;
    }
}

function scheduleBoardJS2Process() {
    if (isBoardJS2Scheduled || boardJS2IsProcessing) return;
    isBoardJS2Scheduled = true;
    boardJS2PendingProcessTimer = setTimeout(() => {
        isBoardJS2Scheduled = false;
        processBoardJS2Targets();
    }, boardJS2ProcessDelay);
}

function enqueueBoardJS2Image(img) {
    if (!img || img.tagName !== 'IMG') return;
    const source = img.getAttribute('data-original') || img.getAttribute('src');
    if (!source) return;

    const normalized = normalizeBoardImageUrl(source);
    if (!normalized) return;

    if (
        img.dataset.bmBoardJS2Done === '1' &&
        img.dataset.bmBoardJS2Source === source &&
        img.dataset.bmBoardJS2Result === normalized
    ) return;

    if (img.dataset.bmBoardJS2Queued === '1') return;
    img.dataset.bmBoardJS2Queued = '1';
    img.dataset.bmBoardJS2NextSource = source;
    img.dataset.bmBoardJS2NextResult = normalized;
    boardJS2TargetsQueue.push(img);
    scheduleBoardJS2Process();
}

function processBoardJS2Targets() {
    if (boardJS2IsProcessing) {
        scheduleBoardJS2Process();
        return;
    }
    boardJS2IsProcessing = true;

    let count = 0;
    while (boardJS2TargetsQueue.length > 0 && count < boardJS2BatchSize) {
        const img = boardJS2TargetsQueue.shift();
        if (!img || img.tagName !== 'IMG') continue;
        const queuedSource = img.dataset.bmBoardJS2NextSource;
        const queuedResult = img.dataset.bmBoardJS2NextResult;
        img.dataset.bmBoardJS2Queued = '0';

        if (!queuedSource || !queuedResult) continue;

        if (img.getAttribute('src') !== queuedResult) {
            img.setAttribute('src', queuedResult);
        }
        img.dataset.bmBoardJS2Done = '1';
        img.dataset.bmBoardJS2Source = queuedSource;
        img.dataset.bmBoardJS2Result = queuedResult;
        count++;
    }

    boardJS2IsProcessing = false;
    if (boardJS2TargetsQueue.length > 0) {
        boardJS2PendingProcessTimer = setTimeout(processBoardJS2Targets, boardJS2ProcessDelay);
        return;
    }
    boardJS2PendingProcessTimer = null;
}

function handleBoardJS2Entries(entries) {
    if (!globalBoardJS2) return;
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry.isIntersecting) continue;
        enqueueBoardJS2Image(entry.target);
    }
}

function observeBoardJS2Targets() {
    const targets = document.querySelectorAll(boardJS2TargetSelector);
    if (!targets || targets.length === 0) return;

    if (!boardJS2Observer) {
        if (!window.IntersectionObserver) {
            for (let i = 0; i < targets.length; i++) enqueueBoardJS2Image(targets[i]);
            return;
        }
        boardJS2Observer = new IntersectionObserver(handleBoardJS2Entries, { rootMargin: '220px', threshold: 0.01 });
        isBoardJS2Initialized = true;
    }

    const viewportTop = -220;
    const viewportBottom = window.innerHeight + 220;
    for (let i = 0; i < targets.length; i++) {
        boardJS2Observer.observe(targets[i]);
        const rect = targets[i].getBoundingClientRect();
        if (rect.bottom >= viewportTop && rect.top <= viewportBottom) {
            enqueueBoardJS2Image(targets[i]);
        }
    }
}

function isBoardFilterUrlMatched(filter, url) {
    if (!filter) return false;

    const matchesFilter = candidateUrl => {
        filter.lastIndex = 0;
        return filter.test(candidateUrl);
    };

    if (matchesFilter(url)) return true;

    try {
        const decodedUrl = decodeURI(url);
        if (decodedUrl !== url && matchesFilter(decodedUrl)) return true;

        const boardId = new URL(url).searchParams.get('bo_table');
        if (!boardId) return false;
        if (matchesFilter(`?bo_table=${boardId}`)) return true;
        if (matchesFilter(`&bo_table=${boardId}`)) return true;
        return false;
    } catch (e) {
        return false;
    }
}

function getBoardTableFromUrl(url) {
    try {
        const boardId = new URL(url).searchParams.get('bo_table');
        return boardId ? boardId.toUpperCase() : '';
    } catch (e) {
        return '';
    }
}

function initDataCache(data) {
    const previousBoardJS2 = globalBoardJS2;

    setEditionKeywords(data.editionKeywords);
    const currentEditionSignature = getEditionKeywordsSignature();
    if (titleProcessingEditionSignature !== currentEditionSignature) {
        titleProcessingCache.clear();
        titleProcessingEditionSignature = currentEditionSignature;
    }

    isDownloadUIEnabled = data.showDownloadUI !== false; 
    isEverythingEnabled = !!data.connectEverything;
    isShowListQuickBtn = !!data.showListQuickBtn;
    isShowListQuickBtnHover = !!data.showListQuickBtnHover;
    isCustomThemeEnabled = !!data.useCustomTheme;
    isSupportSingleCharEnabled = !!data.supportSingleChar;
    isHideUselessCommentsEnabled = data.hideUselessComments !== false;
    isHideExclude = !!data.hideExclude;
    isHideComplete = !!data.hideComplete;
    isHideIncomplete = !!data.hideIncomplete;
    isHideTranslate = !!data.hideTranslate;
    isHideNew = !!data.hideNew;
    isHideQuickMenu = !!data.hideQuickMenu;

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
        globalHideSelector = config.hideSelector || 'tr, li, .list-item';
        globalCustomCss = config.customCss || '';
        globalThemeCss = config.themeCss || '';
        const currentUrl = window.location.href;
        const currentBoardId = getBoardTableFromUrl(currentUrl);
        const isBoardFilterMatched = isBoardFilterUrlMatched(config.boardFilter, currentUrl);
        const isBoardFilter2Matched = isBoardFilterUrlMatched(config.boardFilter2, currentUrl)
            || (hostname.includes('tcafe21.com') && ['D1007', 'D1104', 'D1103', 'D1201', 'D1102', 'D1101', 'D1011', 'D2001'].includes(currentBoardId));
        isAllowedBoard = isBoardFilterMatched || isBoardFilter2Matched || !config.boardFilter;
        globalBoardCss2 = isCustomThemeEnabled && isBoardFilter2Matched && config.boardCss2 ? config.boardCss2 : '';
        globalBoardJS2 = isCustomThemeEnabled && isBoardFilter2Matched && typeof config.boardJS2 === 'function' ? config.boardJS2 : null;
        isBoardJS2Executed = false;
        if (!isBoardFilter2Matched) globalBoardJS2 = null;
    } else if (matchedUserSite) {
        isTargetSite = true;
        globalAllowedDLs = ["giga", "gofile"]; 
        globalTargetSelector = 'a'; 
        globalHideSelector = matchedUserSite.hideSelector || 'tr, li, .list-item';
        globalCustomCss = matchedUserSite.customCss || '';
        globalThemeCss = matchedUserSite.themeCss || '';
        globalBoardCss2 = '';
        globalBoardJS2 = null;
        isBoardJS2Executed = false;
        isAllowedBoard = true;
    } else {
        isTargetSite = false;
        globalAllowedDLs = [];
        globalBoardCss2 = '';
        globalBoardJS2 = null;
        isBoardJS2Executed = false;
        isAllowedBoard = true;
    }

    if (previousBoardJS2 !== globalBoardJS2) {
        if (!globalBoardJS2) {
            resetBoardJS2State();
        }
    }

    globalDetailSelector = (matchedUserSite && typeof matchedUserSite === 'object' && matchedUserSite.detailSelector) 
        ? matchedUserSite.detailSelector : (config && config.detailSelector ? config.detailSelector : '');

    exactMatchCache = {};
    similarityCache = {}; 

    cachedBookList = (Array.isArray(data.bookList) ? data.bookList : []).map(b => {
        let processedOriginal, processedNoSpace, editionKey, matchKey;
        
        if (titleProcessingCache.has(b.title)) {
            const cached = titleProcessingCache.get(b.title);
            processedOriginal = cached.original;
            processedNoSpace = cached.nospace;
            editionKey = cached.editionKey;
            matchKey = cached.matchKey;
        } else {
            const titleParts = getTitleMatchParts(b.title);
            processedOriginal = titleParts.baseOriginal;
            processedNoSpace = titleParts.baseNoSpace;
            editionKey = titleParts.editionKey;
            matchKey = titleParts.matchKey;
            titleProcessingCache.set(b.title, { original: processedOriginal, nospace: processedNoSpace, editionKey, matchKey });
        }

        const enhanced = { ...b, missingVols: getBookMissingVols(b, data.missingVolsMap), _regBodyOriginal: processedOriginal, _regBodyNoSpace: processedNoSpace, _editionKey: editionKey, _matchKey: matchKey };
        if(!exactMatchCache[matchKey]) exactMatchCache[matchKey] = enhanced;
        return enhanced;
    });

    isDataLoaded = true;
}

function injectQuickHidePanel() {
    if (!isTargetSite) return;
    
    if (isHideQuickMenu) {
        let existingPanel = document.getElementById('bm-quick-hide-panel');
        if (existingPanel) existingPanel.remove();
        return;
    }
    
    if (document.getElementById('bm-quick-hide-panel')) return;
    if (!document.body) return;

    const style = document.createElement('style');
    style.textContent = `
        .bm-toggle-switch { display: inline-block; width: 28px; height: 16px; position: relative; vertical-align: middle; margin-right: 4px; }
        .bm-toggle-switch input { opacity: 0; width: 0; height: 0; margin: 0; }
        .bm-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .3s; border-radius: 16px; }
        .bm-slider:before { position: absolute; content: ""; height: 12px; width: 12px; left: 2px; bottom: 2px; background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
        .bm-toggle-switch input:checked + .bm-slider { background-color: #20c997; }
        .bm-toggle-switch input:checked + .bm-slider:before { transform: translateX(12px); }
        .bm-qh-label { display: flex; align-items: center; cursor: pointer; font-size: 13px; color: #333; user-select: none; margin: 0; font-weight: normal; }
        #bm-quick-hide-panel {
            position: fixed; bottom: 20px; right: 20px; background: rgba(255, 255, 255, 0.95);
            border: 1px solid #dee2e6; border-radius: 8px; padding: 12px 15px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.15); z-index: 999999;
            font-family: 'Malgun Gothic', sans-serif; backdrop-filter: blur(5px);
            display: flex; flex-direction: column; gap: 10px;
        }
        body.dark-mode #bm-quick-hide-panel { background: rgba(33, 37, 41, 0.95); border-color: #495057; }
        body.dark-mode .bm-qh-label { color: #f8f9fa; }
        body.dark-mode .bm-slider { background-color: #495057; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'bm-quick-hide-panel';
    panel.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: bold; border-bottom: 1px dashed #dee2e6; padding-bottom: 8px; color:var(--text, #333);">
            <span style="display:flex; align-items:center; gap:5px;">🙈 게시물 숨김</span>
            <span id="bm-qh-toggle-btn" style="cursor:pointer; font-size: 16px; line-height: 1; padding: 0 5px; color: #868e96; user-select: none;">−</span>
        </div>
        <div id="bm-qh-content" style="display: flex; gap: 12px; align-items: center;">
            <label class="bm-qh-label"><label class="bm-toggle-switch"><input type="checkbox" id="bm-qh-exclude" ${isHideExclude ? 'checked' : ''}><span class="bm-slider"></span></label> 제외</label>
            <label class="bm-qh-label"><label class="bm-toggle-switch"><input type="checkbox" id="bm-qh-complete" ${isHideComplete ? 'checked' : ''}><span class="bm-slider"></span></label> 완결</label>
            <label class="bm-qh-label"><label class="bm-toggle-switch"><input type="checkbox" id="bm-qh-incomplete" ${isHideIncomplete ? 'checked' : ''}><span class="bm-slider"></span></label> 미완</label>
            <label class="bm-qh-label"><label class="bm-toggle-switch"><input type="checkbox" id="bm-qh-translate" ${isHideTranslate ? 'checked' : ''}><span class="bm-slider"></span></label> 번역</label>
            <label class="bm-qh-label"><label class="bm-toggle-switch"><input type="checkbox" id="bm-qh-new" ${isHideNew ? 'checked' : ''}><span class="bm-slider"></span></label> 신작</label>
        </div>
    `;
    document.body.appendChild(panel);

    const toggleBtn = document.getElementById('bm-qh-toggle-btn');
    const content = document.getElementById('bm-qh-content');
    toggleBtn.onclick = () => {
        if (content.style.display === 'none') { content.style.display = 'flex'; toggleBtn.textContent = '−'; } 
        else { content.style.display = 'none'; toggleBtn.textContent = '+'; }
    };

    document.getElementById('bm-qh-exclude').addEventListener('change', e => safeStorageSet({ hideExclude: e.target.checked }));
    document.getElementById('bm-qh-complete').addEventListener('change', e => safeStorageSet({ hideComplete: e.target.checked }));
    document.getElementById('bm-qh-incomplete').addEventListener('change', e => safeStorageSet({ hideIncomplete: e.target.checked }));
    document.getElementById('bm-qh-translate').addEventListener('change', e => safeStorageSet({ hideTranslate: e.target.checked }));
    document.getElementById('bm-qh-new').addEventListener('change', e => safeStorageSet({ hideNew: e.target.checked }));
}

function updateQuickHidePanel() {
    if (isHideQuickMenu) {
        let existingPanel = document.getElementById('bm-quick-hide-panel');
        if (existingPanel) existingPanel.remove();
        return;
    } else {
        injectQuickHidePanel();
    }
    const excludeCb = document.getElementById('bm-qh-exclude');
    const completeCb = document.getElementById('bm-qh-complete');
    const incompleteCb = document.getElementById('bm-qh-incomplete');
    const translateCb = document.getElementById('bm-qh-translate');
    const newCb = document.getElementById('bm-qh-new');
    if (excludeCb) excludeCb.checked = isHideExclude;
    if (completeCb) completeCb.checked = isHideComplete;
    if (incompleteCb) incompleteCb.checked = isHideIncomplete;
    if (translateCb) translateCb.checked = isHideTranslate;
    if (newCb) newCb.checked = isHideNew;
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

function extractVisibleCommentText(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('script, style, template, textarea, input, select, option, button, [hidden], [aria-hidden="true"]').forEach(node => {
        node.remove();
    });
    clone.querySelectorAll('*').forEach(node => {
        if (node.style?.display === 'none' || node.style?.visibility === 'hidden') {
            node.remove();
        }
    });
    return clone.textContent.trim();
}

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
        
        const text = extractVisibleCommentText(el);
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
                btn.onclick = () => sendRuntimeMessage({ action: "OPEN_OPTIONS_FOR_COMMENTS" });
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

function getChatingWikiListTitle(link) {
    if (!link || !window.location.hostname.includes('chating.wiki')) return null;
    if (typeof link.matches !== 'function' || !link.matches('a.cw-board-item')) return null;

    const titleElement = link.querySelector(':scope > .cw-board-item__title > strong');
    return titleElement ? titleElement.textContent.trim() : null;
}

function getPureLinkText(link) {
    const chatingWikiTitle = getChatingWikiListTitle(link);
    if (chatingWikiTitle !== null) return chatingWikiTitle;

  let safeHTML = link.innerHTML.replace(/<img[^>]*>/gi, '');
  const temp = document.createElement('div');
  temp.innerHTML = safeHTML;
  const unwantedElements = temp.querySelectorAll('.count, .book-badge, .comment-badge, .bm-quick-actions, .cw-board-item__title > em');
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

function findMatchingBook(titleParts) {
    const { baseOriginal, baseNoSpace, editionKey, matchKey } = titleParts;

    if (exactMatchCache[matchKey]) {
        return { book: exactMatchCache[matchKey], maxScore: 100 };
    }
    if (similarityCache[matchKey] !== undefined) {
        return similarityCache[matchKey];
    }

    let book = null;
    let maxScore = 0;

    for (let i = cachedBookList.length - 1; i >= 0; i--) {
        const candidate = cachedBookList[i];
        if (candidate._editionKey !== editionKey) continue;
        if (Math.abs(candidate._regBodyNoSpace.length - baseNoSpace.length) > Math.min(candidate._regBodyNoSpace.length, baseNoSpace.length) * 2.5) continue;

        const score = getSimilarity(candidate._regBodyOriginal, baseOriginal);
        if (score >= 85 && score > maxScore) {
            maxScore = score;
            book = candidate;
            if (score === 100) break;
        }
    }

    const result = { book, maxScore };
    similarityCache[matchKey] = result;
    return result;
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

function showActionToast(message, allowHTML = false) {
    let container = document.getElementById('book-manager-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'book-manager-toast-container';
        container.style.cssText = "position: fixed; bottom: 120px; left: 50%; transform: translateX(-50%); z-index: 999999; display: flex; flex-direction: column; gap: 10px; pointer-events: none;";
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    if (allowHTML) toast.innerHTML = message;
    else toast.textContent = message;
    toast.style.cssText = "background: rgba(33, 37, 41, 0.95); color: #fff; padding: 12px 24px; border-radius: 8px; font-size: 15px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.2); opacity: 0; transform: translateY(20px); transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); white-space: nowrap; text-align: center;";
    container.appendChild(toast);

    void toast.offsetWidth;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 350);
    }, 5000);
}

function escapeToastText(value) {
    const element = document.createElement('div');
    element.textContent = String(value || '');
    return element.innerHTML;
}

function showToast(book, isDelete = false) {
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

    const details = [];
    if (book.resolution && !isDelete) details.push(book.resolution);
    if (book.lastVol && !isDelete) details.push(book.lastVol + '권');
    if (book.missingVols && book.missingVols.length > 0 && !isDelete) {
        details.push('누락:' + book.missingVols.join(','));
    }

    const detailStr = details.length > 0 ? ' <span style="color:#adb5bd; font-size:12px; font-weight:normal;">(' + details.join(' | ') + ')</span>' : '';
    const message = '<span style="color:' + typeColor + '; margin-right:5px;">[' + typeStr + ']</span>' + book.title + detailStr;
    showActionToast(message, true);
}

function getBookTypeForTitle(titleStr) {
    if (!isDataLoaded || !titleStr) return null;

    const match = findMatchingBook(getTitleMatchParts(titleStr));
    return match.book ? match.book.type : null;
}

function injectDirectDownloadButtons(allowedDLs) {
    if (!allowedDLs || allowedDLs.length === 0) return;

    let regexParts = [];
    if (allowedDLs.includes('giga')) regexParts.push('gigafile\\.(?:nu|jp)|xgf\\.nu');
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
                // if (rawText.includes('번역')) hasTranslation = true;
                if (/번역|AI/i.test(rawText)) hasTranslation = true;
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
            // if (rawText.includes('번역')) hasTranslation = true;
            if (/번역|AI/i.test(rawText)) hasTranslation = true;
            let title = cleanSiteTitle(rawText);
            let skip = false;
            if (!title || title.length < 1) skip = true;
            else if (!isSupportSingleCharEnabled && title.length < 2) skip = true;
            else if (isSupportSingleCharEnabled && title.length === 1 && /^[a-zA-Z0-9]$/.test(title)) skip = true;
            if (!skip) return { title: title, hasTranslation: hasTranslation };
        }

        let pageTitle = document.title.split(/[-|]/)[0]; 
        // if (pageTitle.includes('번역')) hasTranslation = true;
        if (/번역|AI/i.test(pageTitle)) hasTranslation = true;
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
                try { sendRuntimeMessage({ action: "OPEN_HELLKDIS_WITH_PW", url: url, password: "" }); }
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
                const match = bookTitle ? findMatchingBook(getTitleMatchParts(bookTitle)) : { book: null };
                const matchedBook = match && match.book ? match.book : null;
                const downloadFolder = buildDownloadFolder(matchedBook && matchedBook.folderRule, finalTitle);
                sendRuntimeMessage({
                    action: "DOWNLOAD_" + targetType,
                    url: url,
                    password: pw,
                    title: finalTitle,
                    downloadFolder: downloadFolder,
                    bookId: matchedBook ? matchedBook.id : null
                });
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

function setManagedTitleStyle(target, property, value) {
    if (!target) return;
    target.style.setProperty(property, value, "important");
    target.dataset.bmTitleStyled = "true";
}

function clearManagedTitleStyles(target) {
    if (!target || target.dataset.bmTitleStyled !== "true") return false;

    target.style.removeProperty("text-decoration");
    target.style.removeProperty("color");
    target.style.removeProperty("font-weight");
    delete target.dataset.bmTitleStyled;
    return true;
}

function removeBadge(link, titleStyleTarget = link) {
    const clearedLinkStyle = clearManagedTitleStyles(link);
    const clearedTitleStyle = titleStyleTarget !== link && clearManagedTitleStyles(titleStyleTarget);

    if (clearedLinkStyle || clearedTitleStyle || link.style.textDecoration || link.style.opacity || link.querySelector(':scope > .book-badge')) {
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
let contentMissingVolSaveTimer = null;
let pendingContentMissingVolSave = null;
let contentMissingVolSaveQueue = Promise.resolve();

function applyMissingVolUpdateToCache(update) {
    if (!update || update.bookId === undefined) return;
    const cachedBook = cachedBookList.find(book => book.id === update.bookId);
    if (cachedBook) {
        cachedBook.missingVols = Array.isArray(update.missingVols) ? [...update.missingVols] : [];
    }
}

function scheduleContentMissingVolSave(missingVolsMap, bookId, missingVols) {
    pendingContentMissingVolSave = {
        missingVolsMap,
        bookId,
        missingVols: [...missingVols].sort((a, b) => a - b)
    };

    if (contentMissingVolSaveTimer) clearTimeout(contentMissingVolSaveTimer);
    contentMissingVolSaveTimer = setTimeout(flushPendingContentMissingVolSave, 350);
}

function flushPendingContentMissingVolSave() {
    if (contentMissingVolSaveTimer) {
        clearTimeout(contentMissingVolSaveTimer);
        contentMissingVolSaveTimer = null;
    }
    if (!pendingContentMissingVolSave) return contentMissingVolSaveQueue;

    const pending = pendingContentMissingVolSave;
    pendingContentMissingVolSave = null;

    const save = () => new Promise(resolve => {
        const updatedMissingVolsMap = { ...pending.missingVolsMap };
        updatedMissingVolsMap[String(pending.bookId)] = pending.missingVols;

        const marker = {
            bookId: pending.bookId,
            missingVols: pending.missingVols,
            timestamp: Date.now()
        };

        if (!safeStorageSet({ missingVolsMap: updatedMissingVolsMap, missingVolsUpdate: marker }, resolve)) resolve();
    });

    contentMissingVolSaveQueue = contentMissingVolSaveQueue.then(save, save);
    return contentMissingVolSaveQueue;
}

function openMissingPopoverContent(targetMatchKey, badgeElement) {
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
                flushPendingContentMissingVolSave();
                contentVolPopover.style.display = 'none';
            }
        });
    }

    flushPendingContentMissingVolSave().then(() => safeStorageGet({ bookList: [], missingVolsMap: {} }, (data) => {
        const list = data.bookList;
        const bookIndex = list.findIndex(b => getTitleMatchParts(b.title).matchKey === targetMatchKey);
        const dbBook = bookIndex > -1 ? list[bookIndex] : null;

        if (!dbBook) {
            showInfoToast('도서 데이터가 아직 저장되지 않았습니다. 잠시 후 다시 시도해주세요.', true);
            return;
        }

        const lastVol = parseInt(dbBook.lastVol, 10);
        if (isNaN(lastVol) || lastVol <= 0) {
            showInfoToast('권수를 먼저 옵션창에서 숫자로 저장한 뒤에 이용해주세요.', true);
            return;
        }

        const missingVolSet = new Set(getBookMissingVols(dbBook, data.missingVolsMap));

        contentVolPopover.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; font-weight:bold; border-bottom:1px solid #dee2e6; padding-bottom:8px; margin-bottom:8px; color:#333;">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${dbBook.title} (총 ${lastVol}권)</span>
                <button id="bmClosePopoverBtn" style="background:transparent; color:#333; padding:0; margin-left:5px; font-size:16px; border:none; cursor:pointer;">✕</button>
            </div>
            <div style="font-size:11px; color:#6c757d; margin-bottom:8px;">빈틈이 발생한 누락 번호를 클릭하세요.</div>
            <div class="bm-vol-grid" style="display:grid; grid-template-columns:repeat(5, 1fr); gap:5px; max-height:200px; overflow-y:auto; padding-right:4px; box-sizing:border-box;">
                ${Array.from({length: lastVol}, (_, i) => i + 1).map(v => `
                    <div class="bm-vol-item ${missingVolSet.has(v) ? 'missing' : ''}" data-vol="${v}" style="text-align:center; padding:6px 0; font-size:12px; background:${missingVolSet.has(v) ? '#ffe3e3' : '#f8f9fa'}; border:1px solid ${missingVolSet.has(v) ? '#ffa8a8' : '#dee2e6'}; border-radius:4px; cursor:pointer; user-select:none; color:${missingVolSet.has(v) ? '#e03131' : '#333'}; font-weight:500; transition:all 0.1s; ${missingVolSet.has(v) ? 'text-decoration:line-through; opacity:0.8;' : ''}">${v}</div>
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

        document.getElementById('bmClosePopoverBtn').onclick = () => {
            flushPendingContentMissingVolSave();
            contentVolPopover.style.display = 'none';
        };
        
        const volumeGrid = contentVolPopover.querySelector('.bm-vol-grid');
        volumeGrid.onclick = (event) => {
            const item = event.target.closest('.bm-vol-item');
            if (!item) return;

            const vol = parseInt(item.dataset.vol, 10);
            if (missingVolSet.has(vol)) {
                missingVolSet.delete(vol);
                item.classList.remove('missing');
                item.style.cssText = "text-align:center; padding:6px 0; font-size:12px; background:#f8f9fa; border:1px solid #dee2e6; border-radius:4px; cursor:pointer; user-select:none; color:#333; font-weight:500; transition:all 0.1s;";
            } else {
                missingVolSet.add(vol);
                item.classList.add('missing');
                item.style.cssText = "text-align:center; padding:6px 0; font-size:12px; background:#ffe3e3; border:1px solid #ffa8a8; border-radius:4px; cursor:pointer; user-select:none; color:#e03131; font-weight:500; transition:all 0.1s; text-decoration:line-through; opacity:0.8;";
            }

            const missingVols = Array.from(missingVolSet).sort((a, b) => a - b);
            applyMissingVolUpdateToCache({ bookId: dbBook.id, missingVols });
            scheduleContentMissingVolSave(data.missingVolsMap, dbBook.id, missingVols);
        };
    }));
}

window.addEventListener('pagehide', flushPendingContentMissingVolSave);

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
                        const copyMessage = '<span style="color:#b197fc; margin-right:5px;">[복사됨]</span>' + escapeToastText(titleToCopy);
                        showActionToast(copyMessage, true);
                        const originalText = btn.textContent;
                        const originalColor = btn.style.backgroundColor;
                        btn.textContent = '복사됨!';
                        btn.style.backgroundColor = '#20c997'; 
                        setTimeout(() => {
                            btn.textContent = originalText;
                            btn.style.backgroundColor = originalColor;
                        }, 1500);
                    }).catch(() => {
                        showInfoToast("제목 복사에 실패했습니다.", true);
                    });
                    return;
                }

                if (btnInfo.action === 'everything_search') {
                    if (!isEverythingEnabled) {
                        showInfoToast("⚠️ [사이트 및 설정] 탭에서 '에브리띵 연결' 옵션을 먼저 체크해주세요.", true);
                        return;
                    }
                    const cleanTitle = typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText;
                    const everythingSearchTitle = stripEditionTagsForEverythingSearch(cleanTitle);
                    let iframe = document.getElementById('bm-everything-iframe');
                    if (!iframe) {
                        iframe = document.createElement('iframe');
                        iframe.id = 'bm-everything-iframe';
                        iframe.style.display = 'none';
                        document.body.appendChild(iframe);
                    }
                    iframe.src = "es:" + encodeURIComponent(everythingSearchTitle);
                    return;
                }

                if (btnInfo.action === 'missing_vol') {
                    const pureCleanTitle = typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText;
                    const targetMatchKey = getTitleMatchParts(pureCleanTitle).matchKey;
                    openMissingPopoverContent(targetMatchKey, btn);
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
                    sendRuntimeMessage({
                        action: "QUICK_ACTION", 
                        type: btnInfo.action,
                        cleanTitle: btnInfo.action === 'everything_search'
                            ? stripEditionTagsForEverythingSearch(typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText)
                            : (typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText)
                    });
                } else {
                    // [낙관적 UI] 삭제 포함 즉시 캐시 갱신
                    const pureCleanTitle = typeof cleanSiteTitle === 'function' ? cleanSiteTitle(linkData.originalText) : linkData.originalText;
                    const titleParts = getTitleMatchParts(pureCleanTitle);
                    const targetMatchKey = titleParts.matchKey;
                    
                    if (btnInfo.action === 'delete') {
                        if (exactMatchCache[targetMatchKey]) delete exactMatchCache[targetMatchKey];
                        cachedBookList = cachedBookList.filter(b => b._matchKey !== targetMatchKey);
                    } else {
                        if (exactMatchCache[targetMatchKey]) {
                            exactMatchCache[targetMatchKey].type = btnInfo.action;
                        } else {
                            let found = false;
                            for (let i = 0; i < cachedBookList.length; i++) {
                                if (cachedBookList[i]._matchKey === targetMatchKey) {
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
                                    _regBodyOriginal: titleParts.baseOriginal,
                                    _regBodyNoSpace: titleParts.baseNoSpace,
                                    _editionKey: titleParts.editionKey,
                                    _matchKey: targetMatchKey
                                };
                                cachedBookList.push(newBook);
                                exactMatchCache[targetMatchKey] = newBook;
                            }
                        }
                    }

                    similarityCache[targetMatchKey] = undefined;
                    
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

                    sendRuntimeMessage({
                        action: "QUICK_ACTION", 
                        type: btnInfo.action,
                        cleanTitle: pureCleanTitle,
                        resolution: linkData.siteRes ? linkData.siteRes + "px" : "",
                        lastVol: linkData.siteVol ? linkData.siteVol.toString() : ""
                    });
                    
                }
            } catch (err) {}
        };
        container.appendChild(btn);
    });
    return container;
}

function getDisplayMatchScore(maxScore) {
    return maxScore === 100 ? 100 : Math.min(99, Math.round(maxScore));
}

function createMatchScoreHtml(displayScore, useLightText = false) {
    if (displayScore < 100) {
        return `<span class="bm-match-score bm-match-score--partial" style="color:#5f3b00; background:#fff3bf; border:1px solid #e67700; font-size:10px; font-weight:800; padding:1px 4px; border-radius:3px; margin-left:4px; vertical-align:middle; display:inline-block; line-height:1.15; white-space:nowrap; box-shadow:0 1px 2px rgba(0,0,0,0.12);" title="유사 매칭 ${displayScore}%: 등록된 책 제목을 확인하세요">유사 ${displayScore}%</span>`;
    }

    const textColor = useLightText ? 'rgba(255,255,255,0.8)' : '#868e96';
    return `<span class="bm-match-score bm-match-score--exact" style="color:${textColor}; font-size:10px; margin-left:4px;" title="일치율: ${displayScore}%">(${displayScore}%)</span>`;
}

function getListRenderTargets(link) {
    const defaultTargets = {
        badgeTarget: link,
        actionsTarget: link,
        titleStyleTarget: link,
        usesSeparateTargets: false
    };

    if (!window.location.hostname.includes('chating.wiki')) return defaultTargets;

    const titleTarget = link.matches('a.cw-board-item')
        ? link.querySelector(':scope > .cw-board-item__title')
        : link.closest('.cw-board-item__title');
    if (!titleTarget) return defaultTargets;

    const titleStyleTarget = titleTarget.querySelector(':scope > strong') || link;

    const nestedTagsTarget = titleTarget.querySelector(':scope > .cw-board-item__tags');
    if (nestedTagsTarget) {
        return {
            badgeTarget: titleTarget,
            actionsTarget: nestedTagsTarget,
            titleStyleTarget,
            usesSeparateTargets: true
        };
    }

    let itemContainer = titleTarget.parentElement;
    while (itemContainer && itemContainer !== document.body && !itemContainer.matches('.cw-board-table')) {
        const tagsTarget = itemContainer.querySelector('.cw-board-item__tags');
        if (tagsTarget) {
            return {
                badgeTarget: titleTarget,
                actionsTarget: tagsTarget,
                titleStyleTarget,
                usesSeparateTargets: true
            };
        }
        itemContainer = itemContainer.parentElement;
    }

    return { ...defaultTargets, titleStyleTarget };
}

function getDetailRenderTargets(detailElement) {
    const defaultTargets = {
        badgeTarget: detailElement,
        actionsTarget: detailElement,
        usesSeparateTargets: false
    };

    if (!window.location.hostname.includes('chating.wiki')) return defaultTargets;

    const articleHeader = detailElement.closest('.cw-article-header');
    const actionsTarget = articleHeader?.querySelector(':scope > .cw-article-attributes');
    if (!actionsTarget) return defaultTargets;

    return {
        badgeTarget: detailElement,
        actionsTarget,
        usesSeparateTargets: true
    };
}

function applyStyleToSingleLink(link) {
    // 핵심 방어: 이미 상세페이지 로직이 처리한 요소면 일반 링크 함수는 쳐다보지도 않고 도망감 (무한루프 차단)
    if (link.dataset.bmIsDetail === "true") return; 

    const renderTargets = getListRenderTargets(link);
    const badgeTarget = renderTargets.badgeTarget;
    const actionsTarget = renderTargets.actionsTarget;
    const titleStyleTarget = renderTargets.titleStyleTarget || link;

    if (renderTargets.usesSeparateTargets) {
        link.querySelector(':scope > .book-badge')?.remove();
        link.querySelector(':scope > .bm-badge-br.list-br')?.remove();
        link.querySelector(':scope > .bm-quick-actions.list-actions')?.remove();
    }

    const chatingWikiTitle = getChatingWikiListTitle(link);
    const currentRawText = chatingWikiTitle !== null ? chatingWikiTitle : link.textContent || "";
    
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
            const titleParts = getTitleMatchParts(pureTitle);
            
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

            link._bmData = { skip: false, titleParts, siteBodyOriginal: titleParts.baseOriginal, siteBodyNoSpace: titleParts.baseNoSpace, siteMatchKey: titleParts.matchKey, siteRes, siteVol, raw: currentRawText, originalText };
        }
    }

    if (link._bmData.skip) {
        removeBadge(link, titleStyleTarget);
        if (renderTargets.usesSeparateTargets) {
            badgeTarget.querySelector(':scope > .book-badge')?.remove();
            actionsTarget.querySelector(':scope > .bm-quick-actions.list-actions')?.remove();
        }
        link.dataset.bmShouldHide = "false";
        return;
    }

    const { titleParts, siteBodyOriginal, siteRes, siteVol, originalText } = link._bmData;
    const hostname = window.location.hostname;
    const isTcafeSite = hostname.includes('lamu') || hostname.includes('tcafe') || hostname.includes('tcafed');
    const tcafeRow = isTcafeSite ? link.closest('tr') : null;
    const isChatingWikiSite = hostname.includes('chating.wiki');
    const chatingWikiTagText = isChatingWikiSite
        ? Array.from(link.querySelectorAll('.cw-board-item__tags > i:not([data-kind])')).map(tag => tag.textContent || '').join(' ')
        : '';
    const translationText = tcafeRow
        ? tcafeRow.textContent || ''
        : isChatingWikiSite
            ? `${originalText || ''} ${link.dataset.attributes || ''} ${chatingWikiTagText}`
            : originalText || '';
    const hasTranslationTag = /번역|AI/i.test(translationText);
    const match = findMatchingBook(titleParts);
    const book = match.book;
    const maxScore = match.maxScore;
    
    let badgeStyle = '';
    let newBadgeHTML = '';
    
    let shouldHide = false;

    if (book) {
        const regRes = book.resolution ? parseInt(book.resolution.replace(/[^0-9]/g, ''), 10) : 0;
        const regVol = book.lastVol ? parseInt(book.lastVol, 10) : 0;
        const displayScore = getDisplayMatchScore(maxScore);
        const resText = book.resolution || '-';
        const volText = book.lastVol ? book.lastVol + '권' : '-';

        // '제외' 타입이더라도 매칭률이 95% 이하일 경우 숨김 무시
        if (book.type === "exclude" && isHideExclude && maxScore > 95) shouldHide = true;
        else if (book.type === "complete" && isHideComplete) shouldHide = true;
        else if (book.type === "incomplete" && isHideIncomplete) shouldHide = true;
        else if (book.type === "new" && isHideNew) shouldHide = true; // 신작(new) 대응
        else if (hasTranslationTag && isHideTranslate) shouldHide = true;

        // 해상도/권수 업그레이드 및 누락 권수 예외 적용 (단, '제외' 항목은 업그레이드 여부와 무관하게 무조건 숨김)
        if (book.type !== "exclude") {
            const hasUpgrade = (siteRes > regRes && regRes > 0) || (siteVol > regVol && regVol > 0);
            if (hasUpgrade || (book.missingVols && book.missingVols.length > 0)) {
                shouldHide = false;
            }
        }

        // 누락 뱃지 생성 로직
        let missingHtml = '';
        if (book.missingVols && book.missingVols.length > 0) {
            let mStr = book.missingVols.join(',');
            missingHtml = '<span style="background:#7b1010; color:#fff; font-size:9px; font-weight:bold; padding:1px 4px; border-radius:3px; margin-left:4px; vertical-align:middle; display:inline-block; line-height:1.2; box-shadow:0 1px 2px rgba(0,0,0,0.2);">누락:' + mStr + '</span>';
        }

        clearManagedTitleStyles(link);
        if (titleStyleTarget !== link) clearManagedTitleStyles(titleStyleTarget);
        link.style.removeProperty("background-color");
        link.style.removeProperty("padding");
        link.style.removeProperty("border-radius");
        link.style.removeProperty("text-decoration");
        link.style.removeProperty("color");
        link.style.removeProperty("opacity");
        link.style.removeProperty("font-weight");

        if (book.type === "exclude") {
          setManagedTitleStyle(titleStyleTarget, "text-decoration", "line-through");
          setManagedTitleStyle(titleStyleTarget, "color", "#aaaaaa");
          setManagedTitleStyle(titleStyleTarget, "font-weight", "normal");
          link.style.setProperty("opacity", "0.5", "important");
          link.setAttribute("title", "[제외됨] " + book.title + " (매칭률: " + displayScore + "%)");
          newBadgeHTML = '<span style="color:#999;">' + resText + '</span><span style="color:#ccc;"> | </span><span style="color:#999;">' + volText + '</span>' + missingHtml + createMatchScoreHtml(displayScore);
          badgeStyle = "font-size:10px; background:#f8f9fa; border:1px solid #dee2e6; padding:2px 4px; border-radius:3px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2;";
        } else if (book.type === "incomplete") {
          const hasUpgrade = (siteRes > regRes && regRes > 0) || (siteVol > regVol && regVol > 0);
          setManagedTitleStyle(titleStyleTarget, "text-decoration", "none");
          setManagedTitleStyle(titleStyleTarget, "color", "#d9480f");
          setManagedTitleStyle(titleStyleTarget, "font-weight", "800");
          link.style.setProperty("opacity", "1", "important");
          link.setAttribute("title", "[미완] " + book.title + " (" + displayScore + "%)");
          let resHtml = (siteRes > regRes && regRes > 0) ? '<span style="color:#ffc107; font-weight:900;">' + resText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + resText + '</span>';
          let volHtml = (siteVol > regVol && regVol > 0) ? '<span style="color:#ffc107; font-weight:900;">' + volText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + volText + '</span>';
          newBadgeHTML = resHtml + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + volHtml + missingHtml + createMatchScoreHtml(displayScore, true);
          let shadow = hasUpgrade ? "box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);" : "box-shadow: 0 1px 2px rgba(0,0,0,0.2);";
          badgeStyle = "font-size:10px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2; " + shadow;
        } else if (book.type === "complete") {
          const hasUpgrade = (siteRes > regRes && regRes > 0) || (siteVol > regVol && regVol > 0);
          setManagedTitleStyle(titleStyleTarget, "text-decoration", "none");
          link.style.setProperty("opacity", "1", "important");
          link.setAttribute("title", "[완결] " + book.title + " (" + displayScore + "%)");
          if (hasUpgrade) {
              setManagedTitleStyle(titleStyleTarget, "color", "#d9480f");
              setManagedTitleStyle(titleStyleTarget, "font-weight", "800");
              let resHtml = (siteRes > regRes && regRes > 0) ? '<span style="color:#ffc107; font-weight:900;">' + resText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + resText + '</span>';
              let volHtml = (siteVol > regVol && regVol > 0) ? '<span style="color:#ffc107; font-weight:900;">' + volText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + volText + '</span>';
              newBadgeHTML = resHtml + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + volHtml + missingHtml + createMatchScoreHtml(displayScore, true);
              badgeStyle = "font-size:10px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2; box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);";
          } else {
              setManagedTitleStyle(titleStyleTarget, "color", "#0056b3");
              setManagedTitleStyle(titleStyleTarget, "font-weight", "600");
              newBadgeHTML = '<span style="color:#007bff; font-weight:normal;">' + resText + '</span><span style="color:#007bff; opacity:0.5; margin:0 4px;">|</span><span style="color:#007bff; font-weight:normal;">' + volText + '</span>' + missingHtml + createMatchScoreHtml(displayScore);
              badgeStyle = "font-size:10px; background:#f0f7ff; border:1px solid #007bff; padding:2px 4px; border-radius:3px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2;";
          }
        }
    } else {
        removeBadge(link, titleStyleTarget);
        if (isHideNew) shouldHide = true; // 어느 항목과도 매칭되지 않은 경우(미등록) 신작으로 간주하여 숨김 처리
        if (!shouldHide && isHideTranslate && hasTranslationTag) shouldHide = true;
    }

    // 뱃지 지울 때 직계 요소(:scope >)만 탐색하여 부모/자식 뱃지를 서로 오해하는 것을 방지
    const existingBadge = badgeTarget.querySelector(':scope > .book-badge');
    if (newBadgeHTML) {
        const shouldInsertBeforeTags = renderTargets.usesSeparateTargets && actionsTarget.parentElement === badgeTarget;
        const shouldMoveBadge = existingBadge && shouldInsertBeforeTags && existingBadge.nextElementSibling !== actionsTarget;
        if (!existingBadge || existingBadge.dataset.html !== newBadgeHTML || shouldMoveBadge) {
            let badge = existingBadge;
            if (!badge || badge.dataset.html !== newBadgeHTML) {
                if (badge) badge.remove();
                badge = document.createElement('span');
                badge.className = 'book-badge';
                badge.style.cssText = badgeStyle;
                badge.innerHTML = newBadgeHTML;
                badge.dataset.html = newBadgeHTML;
            }

            if (shouldInsertBeforeTags) badgeTarget.insertBefore(badge, actionsTarget);
            else badgeTarget.appendChild(badge);
            
            // 기존에 있던 줄바꿈과 퀵버튼을 뱃지 뒤로 밀어내어 순서가 꼬이는 현상 완벽 해결
            if (!renderTargets.usesSeparateTargets) {
                const existingBr = link.querySelector(':scope > .bm-badge-br.list-br');
                const existingActions = link.querySelector(':scope > .bm-quick-actions.list-actions');
                if (existingBr) link.appendChild(existingBr);
                if (existingActions) link.appendChild(existingActions);
            }
        }
    } else if (existingBadge) {
        existingBadge.remove();
    }

    // 리스트 퀵 버튼 렌더링 (데이터가 없어도 표기하되, 작성자명 등 오작동 요소는 필터링)
    const isLikelyTitle = chatingWikiTitle !== null || !!newBadgeHTML || siteRes > 0 || siteVol > 0 || siteBodyOriginal.length > 3;
    if (isShowListQuickBtn && isLikelyTitle && isAllowedBoard) {
        let existingBr = renderTargets.usesSeparateTargets ? null : actionsTarget.querySelector(':scope > .bm-badge-br.list-br');
        let existingActions = actionsTarget.querySelector(':scope > .bm-quick-actions.list-actions');
        
        const siteMatchKey = link._bmData.siteMatchKey;
        const matchBook = exactMatchCache[siteMatchKey] || (similarityCache[siteMatchKey] && similarityCache[siteMatchKey].book);
        const hasBook = !!matchBook;
        const hasTitleChanged = chatingWikiTitle !== null && existingActions?.dataset.titleSignature !== link._bmData.raw;

        if (!existingActions || existingActions.dataset.hasBook !== String(hasBook) || hasTitleChanged) {
            if (existingBr) existingBr.remove();
            if (existingActions) existingActions.remove();

            if (!renderTargets.usesSeparateTargets) {
                const br = document.createElement('br');
                br.className = 'bm-badge-br list-br';
                actionsTarget.appendChild(br);
            }

            const actions = createQuickActions(link._bmData, hasBook);
            actions.classList.add('list-actions');
            actions.dataset.hasBook = String(hasBook);
            if (chatingWikiTitle !== null) actions.dataset.titleSignature = link._bmData.raw;
            actions.style.marginLeft = "0";
            actions.style.marginTop = "4px";
            actions.style.display = renderTargets.usesSeparateTargets ? "flex" : "inline-flex";
            actionsTarget.appendChild(actions);
        }

        if (renderTargets.usesSeparateTargets) {
            existingActions = actionsTarget.querySelector(':scope > .bm-quick-actions.list-actions');
            if (existingActions) {
                actionsTarget.style.setProperty("display", "flex", "important");
                actionsTarget.style.setProperty("flex-wrap", "wrap", "important");
                existingActions.style.display = "flex";
                existingActions.style.width = "100%";
                existingActions.style.minWidth = "0";
                existingActions.style.setProperty("flex", "0 0 100%", "important");
                existingActions.style.boxSizing = "border-box";
                existingActions.style.flexWrap = "wrap";
                existingActions.style.overflowX = "visible";
            }
        }
    } else {
        // 옵션이 꺼져있거나, 잘못된 요소로 판단되었을 때 퀵버튼 제거
        let existingBr = renderTargets.usesSeparateTargets ? null : actionsTarget.querySelector(':scope > .bm-badge-br.list-br');
        let existingActions = actionsTarget.querySelector(':scope > .bm-quick-actions.list-actions');
        if (existingBr) existingBr.remove();
        if (existingActions) existingActions.remove();
    }

    // 게시물 숨김 처리 적용
    if (globalHideSelector) {
        const parentEl = link.closest(globalHideSelector);
        if (parentEl) {
            if (shouldHide) {
                link.dataset.bmShouldHide = "true";
                parentEl.style.setProperty("display", "none", "important");
            } else {
                link.dataset.bmShouldHide = "false";
                // 동일 부모 요소 내에 숨김을 요구하는 다른 링크가 없을 때만 숨김 해제
                const siblingHiders = parentEl.querySelectorAll('[data-bm-should-hide="true"]');
                if (siblingHiders.length === 0 && parentEl.style.display === "none") {
                    parentEl.style.removeProperty("display");
                }
            }
        }
    }
}

function applyStyleToDetailElement(el) {
    // 핵심 방어 마커 부착: 내가 상세페이지 로직으로 찜했으니 단일 링크 로직은 건들지 마라 선언
    el.dataset.bmIsDetail = "true"; 

    const renderTargets = getDetailRenderTargets(el);
    const badgeTarget = renderTargets.badgeTarget;
    const actionsTarget = renderTargets.actionsTarget;

    if (renderTargets.usesSeparateTargets) {
        el.querySelector(':scope > .bm-badge-br')?.remove();
        el.querySelector(':scope > .bm-quick-actions')?.remove();
    }
    
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
            const titleParts = getTitleMatchParts(pureTitle);
            
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

            el._bmDetailData = { skip: false, pureTitle, titleParts, siteBodyOriginal: titleParts.baseOriginal, siteBodyNoSpace: titleParts.baseNoSpace, siteMatchKey: titleParts.matchKey, siteRes, siteVol, raw: currentRawText, originalText };
        }
    }

    if (el._bmDetailData.skip) {
        removeBadge(el);
        const act = actionsTarget.querySelector(':scope > .bm-quick-actions'); // 직계만 탐색
        if (act) act.remove(); 
        const bbr = renderTargets.usesSeparateTargets ? null : actionsTarget.querySelector(':scope > .bm-badge-br'); // 직계만 탐색
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

    const { titleParts, siteRes, siteVol } = el._bmDetailData;
    const match = findMatchingBook(titleParts);
    const book = match.book;
    const maxScore = match.maxScore;
    
    let badgeStyle = '';
    let newBadgeHTML = '';

    if (book) {
        // 매칭된 도서가 있다면 툴팁에 등록된 데이터의 책 제목을 표기합니다.
        el.setAttribute("title", "등록된 책 제목: " + book.title);

        const regRes = book.resolution ? parseInt(book.resolution.replace(/[^0-9]/g, ''), 10) : 0;
        const regVol = book.lastVol ? parseInt(book.lastVol, 10) : 0;
        const displayScore = getDisplayMatchScore(maxScore);
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
          newBadgeHTML = '<span style="color:#999;">' + resText + '</span><span style="color:#ccc;"> | </span><span style="color:#999;">' + volText + '</span>' + missingHtml + createMatchScoreHtml(displayScore);
          badgeStyle = "font-size:11px; font-weight:bold; background:#f8f9fa; border:1px solid #dee2e6; padding:2px 5px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2; text-decoration:none !important; opacity:1 !important;";
        } else if (book.type === "incomplete") {
          const hasUpgrade = (siteRes > regRes && regRes > 0) || (siteVol > regVol && regVol > 0);
          el.style.setProperty("text-decoration", "none", "important");
          el.style.setProperty("color", "#d9480f", "important"); 
          el.style.setProperty("font-weight", "800", "important");
          let resHtml = (siteRes > regRes && regRes > 0) ? '<span style="color:#ffc107; font-weight:900;">' + resText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + resText + '</span>';
          let volHtml = (siteVol > regVol && regVol > 0) ? '<span style="color:#ffc107; font-weight:900;">' + volText + ' <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>' : '<span style="color:#ffffff; font-weight:bold;">' + volText + '</span>';
          newBadgeHTML = resHtml + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + volHtml + missingHtml + createMatchScoreHtml(displayScore, true);
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
              newBadgeHTML = resHtml + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + volHtml + missingHtml + createMatchScoreHtml(displayScore, true);
              badgeStyle = "font-size:11px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2; box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);";
          } else {
              el.style.setProperty("color", "#0056b3", "important"); 
              el.style.setProperty("font-weight", "600", "important");
              newBadgeHTML = '<span style="color:#007bff; font-weight:normal;">' + resText + '</span><span style="color:#007bff; opacity:0.5; margin:0 4px;">|</span><span style="color:#007bff; font-weight:normal;">' + volText + '</span>' + missingHtml + createMatchScoreHtml(displayScore);
              badgeStyle = "font-size:11px; background:#f0f7ff; border:1px solid #007bff; padding:2px 5px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2;";
          }
        }
    } else {
        // 매칭된 도서가 없다면 추출된 제목을 유지합니다.
        el.setAttribute("title", "추출된 책 제목: " + el._bmDetailData.pureTitle);
        removeBadge(el); 
    }

    // 직계 자손(:scope >)만 탐색하도록 교체! (엄한 자식 뱃지를 지우는 대참사 방지)
    let existingBadge = badgeTarget.querySelector(':scope > .book-badge');
    let existingBr = renderTargets.usesSeparateTargets ? null : actionsTarget.querySelector(':scope > .bm-badge-br');
    let existingActions = actionsTarget.querySelector(':scope > .bm-quick-actions');

    const needsBadgeUpdate = newBadgeHTML && (!existingBadge || existingBadge.dataset.html !== newBadgeHTML);
    const needsBadgeRemoval = !newBadgeHTML && existingBadge;
    const needsActionsUpdate = isAllowedBoard ? (!existingActions || existingActions.dataset.hasBook !== String(!!book)) : !!existingActions;
    const needsBr = renderTargets.usesSeparateTargets ? false : (isAllowedBoard ? !existingBr : !!existingBr);

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
            badgeTarget.appendChild(badge);
        }

        if (isAllowedBoard) {
            if (!renderTargets.usesSeparateTargets) {
                const br = document.createElement('br');
                br.className = 'bm-badge-br';
                actionsTarget.appendChild(br);
            }

            const actions = createQuickActions(el._bmDetailData, !!book);
            actions.dataset.hasBook = !!book;
            actions.style.marginLeft = "0";
            actions.style.marginTop = "5px";
            actionsTarget.appendChild(actions);
        }
    }

    if (renderTargets.usesSeparateTargets) {
        existingActions = actionsTarget.querySelector(':scope > .bm-quick-actions');
        if (existingActions) {
            actionsTarget.style.setProperty("display", "flex", "important");
            actionsTarget.style.setProperty("flex-wrap", "wrap", "important");
            existingActions.style.display = "flex";
            existingActions.style.width = "100%";
            existingActions.style.minWidth = "0";
            existingActions.style.setProperty("flex", "0 0 100%", "important");
            existingActions.style.boxSizing = "border-box";
            existingActions.style.flexWrap = "wrap";
            existingActions.style.overflowX = "visible";
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
  if (!isExtensionContextValid() || !isDataLoaded || !isTargetSite) return;

  const hostname = window.location.hostname;
  
  // ▼▼▼ 여기에 customJS 실행 코드 추가 (화면이 바뀔 때마다 감지하여 실행) ▼▼▼
  const currentConfig = PRE_DEFINED_SITES.find(s => hostname.includes(s.url));
  if (currentConfig && typeof currentConfig.customJS === 'function') {
      try { currentConfig.customJS(); } catch (err) {}
  }
  // ▲▲▲ 추가 끝 ▲▲▲

  if (globalAllowedDLs.length > 0) injectDirectDownloadButtons(globalAllowedDLs);

  // tcafe21.com 보드 필터 적용 대상인 경우 4번째 td(작성자)를 5번째 td(날짜) 위로 이동
  if (hostname.includes('chating.wiki') && isAllowedBoard) {
      const materials = document.querySelector('.cw-article-materials');
      const articleBody = document.querySelector('.cw-article-body');

      if (materials && articleBody?.parentNode && articleBody.previousElementSibling !== materials) {
          articleBody.parentNode.insertBefore(materials, articleBody);
      }
  }

  if (hostname.includes('lamu.club') && isAllowedBoard) {
      const materials = document.querySelector('.well');
      const articleBody = document.querySelector('.panel.panel-default.view-head');

      if (materials && articleBody?.parentNode && articleBody.previousElementSibling !== materials) {
          articleBody.parentNode.insertBefore(materials, articleBody);
      }
  }

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

    if (document.readyState === 'complete' && globalBoardJS2) {
        try {
            globalBoardJS2();
        } catch (err) {}
    }

}

function generateOptimalSelector(el) {
    if (!el) return '';
    if (el.nodeType === 3) el = el.parentElement; 
    const classes = Array.from(el.classList).filter(c => !['hover','active','focus'].includes(c));
    if (classes.length > 0) return el.tagName.toLowerCase() + '.' + classes.join('.');
    return el.tagName.toLowerCase();
}

safeStorageGet(BM_STORAGE_DEFAULTS, (data) => {
    initDataCache(data);

    if (isTargetSite) {
        const initPanel = () => {
            injectQuickHidePanel();
            updateQuickHidePanel();
            if (document.readyState === 'complete' && globalBoardJS2) {
                try {
                    globalBoardJS2();
                } catch (err) {}
                return;
            }

            window.addEventListener(
                'load',
                () => {
                    if (!globalBoardJS2) return;
                    try {
                        globalBoardJS2();
                    } catch (err) {}
                },
                { once: true }
            );
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initPanel);
        } else {
            initPanel();
        }

        let fixStyle = document.getElementById('bm-custom-style');
        if (!fixStyle) {
            fixStyle = document.createElement('style');
            fixStyle.id = 'bm-custom-style';
            document.head.appendChild(fixStyle);
        }
        let styleContent = ".list-subject > div[style*=\"float:left\"], .list-subject > div[style*=\"float: left\"] { position: relative !important; z-index: 10 !important; } .list-subject a.ellipsis { position: relative !important; z-index: 1 !important; }";
        if (globalCustomCss && isAllowedBoard) styleContent += "\n" + globalCustomCss;
        if (globalBoardCss2) styleContent += "\n" + globalBoardCss2;
        if (globalThemeCss && isAllowedBoard && isCustomThemeEnabled) styleContent += "\n" + globalThemeCss;
        if (isShowListQuickBtnHover) styleContent += "\n.bm-quick-actions.list-actions { opacity: 0 !important; visibility: hidden !important; transition: opacity 0.2s, visibility 0.2s; }\na:hover .bm-quick-actions.list-actions, td:hover .bm-quick-actions.list-actions, li:hover .bm-quick-actions.list-actions, div.list-item:hover .bm-quick-actions.list-actions { opacity: 1 !important; visibility: visible !important; }";
        fixStyle.textContent = styleContent;

        applyStyles();
        
        new MutationObserver(() => {
            if (!isExtensionContextValid()) return;
            debouncedApplyStyles(); 
        }).observe(document.body, { childList: true, subtree: true });

        document.addEventListener("contextmenu", (e) => {
            try {
                if (!isExtensionContextValid()) return;
                lastRightClickedElement = e.target; 
                const link = e.target.closest('a');
                if (link) { 
                    lastRightClickedLink = link; 
                    sendRuntimeMessage({ type: "RIGHT_CLICK_TITLE", title: getPureLinkText(link) });
                } else if (e.target) {
                    sendRuntimeMessage({ type: "RIGHT_CLICK_TITLE", title: getPureLinkText(e.target) });
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
      if (!isExtensionContextValid()) return;
      if (request.action === "GET_AND_REGISTER_SELECTOR") {
          const host = window.location.hostname.replace(/^www\./, '');
          const selector = generateOptimalSelector(lastRightClickedElement);
          
          if(!selector) {
              showInfoToast("❌ 요소 선택자를 추출할 수 없습니다.", true);
              return;
          }
          
          safeStorageGet({ allowedSites: [] }, (data) => {
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
              
              safeStorageSet({ allowedSites: sites }, () => {
                  showInfoToast(`✅ [${host}] 상세페이지 제목이 등록되었습니다.<br><span style='font-size:12px; color:#ddd;'>추출: ${selector}</span>`);
                  setTimeout(() => window.location.reload(), 1500); 
              });
          });
      } else if (request.action === "SHOW_TOAST" && request.book) {
          showToast(request.book, request.isDelete);
          
          safeStorageGet(BM_STORAGE_DEFAULTS, (data) => {
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
                          sendRuntimeMessage({action: 'OPEN_DOWNLOAD_FOLDER', downloadId: request.id});
                          btn.innerText = "열림!";
                      };
                  }
              }, 100);
          }
      }
    });
} catch(e) {}

safeStorageGet({ autoConfirm: true }, (data) => {
    if (data.autoConfirm) {
        const currentHostname = window.location.hostname;
        const activeConfig = PRE_DEFINED_SITES.find(site => currentHostname.includes(site.url));
        if (activeConfig && activeConfig.autoConfirmKeywords && activeConfig.autoConfirmKeywords.length > 0) {
            try {
                sendRuntimeMessage({ action: "INJECT_BYPASS_SCRIPT", keywords: activeConfig.autoConfirmKeywords });
            } catch (err) {}
        }
    }
});

let isTabStale = true; 

document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isTabStale) {
        isTabStale = false;
        safeStorageGet(BM_STORAGE_DEFAULTS, (data) => {
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
        safeStorageGet(BM_STORAGE_DEFAULTS, (data) => {
            initDataCache(data);
            debouncedApplyStyles();
        });
    }
});

try {
    if (isExtensionContextValid()) {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                if (changes.missingVolsMap && changes.missingVolsUpdate) {
                    applyMissingVolUpdateToCache(changes.missingVolsUpdate.newValue);
                    debouncedApplyStyles();
                    return;
                }

                safeStorageGet(BM_STORAGE_DEFAULTS, (data) => {
                    initDataCache(data);
                    updateQuickHidePanel();

                    // 실시간 테마 토글 적용/해제
                    let fixStyle = document.getElementById('bm-custom-style');
                    if (fixStyle) {
                        let styleContent = ".list-subject > div[style*=\"float:left\"], .list-subject > div[style*=\"float: left\"] { position: relative !important; z-index: 10 !important; } .list-subject a.ellipsis { position: relative !important; z-index: 1 !important; }";
                        if (globalCustomCss && isAllowedBoard) styleContent += "\n" + globalCustomCss;
                        if (globalBoardCss2) styleContent += "\n" + globalBoardCss2;
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
    }
} catch (e) {}
