importScripts('dexie.min.js', 'db.js', 'common.js');

let lastRightClickedTitle = "";
let downloadTitlesMap = {}; // 다운로드 ID와 폴더명(책 제목) 매핑
let urlToTitleMap = {};
let gofileAuthLock = null;

async function getGofileCredentials(forceRefresh = false) {
    let now = Date.now();
    let stored = await chrome.storage.local.get(['gfToken', 'gfWt', 'gfTime']);
    
    if (!forceRefresh && stored.gfToken && stored.gfWt && stored.gfTime && (now - stored.gfTime < 1000 * 60 * 60 * 1)) {
        return { token: stored.gfToken, wt: stored.gfWt };
    }

    if (gofileAuthLock && !forceRefresh) {
        return await gofileAuthLock;
    }

    let task = (async () => {
        let token = "";
        let wt = "4fd6sg89d7s6"; 
        try {
            let accRes = await fetch('https://api.gofile.io/accounts', { method: 'POST' });
            let accData = await accRes.json();
            if (accData.status === 'ok') token = accData.data.token;

            let htmlRes = await fetch('https://gofile.io/');
            let html = await htmlRes.text();
            let jsPaths = [...html.matchAll(/src=["'](\/dist\/js\/[^"']+\.js)["']/g)].map(m => m[1]);
            
            for (let path of jsPaths) {
                let jsRes = await fetch("https://gofile.io" + path);
                if (jsRes.ok) {
                    let jsText = await jsRes.text();
                    let wtMatch = jsText.match(/wt\s*[:=]\s*["']([a-zA-Z0-9]{10,64})["']/i) || jsText.match(/["']wt["']\s*[:=]\s*["']([a-zA-Z0-9]{10,64})["']/i);
                    if (wtMatch) {
                        wt = wtMatch[1];
                        break; 
                    }
                }
            }

            if (token) {
                await chrome.storage.local.set({ gfToken: token, gfWt: wt, gfTime: Date.now() });
            }
            return { token, wt };
        } catch (e) {
            console.log("Gofile 인증 실패:", e);
            if (stored.gfToken) return { token: stored.gfToken, wt: stored.gfWt || wt };
            throw e;
        }
    })();

    if (!forceRefresh) gofileAuthLock = task;
    
    try {
        let result = await task;
        return result;
    } finally {
        if (!forceRefresh) gofileAuthLock = null;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "RIGHT_CLICK_TITLE") {
        lastRightClickedTitle = message.title;
    }
    else if (message.action === "CLOSE_ME") {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.remove(sender.tab.id).catch(() => {});
        }
        return true;
    }
    else if (message.action === "INJECT_BYPASS_SCRIPT") {
        if (sender.tab && sender.tab.id) {
            chrome.scripting.executeScript({
                target: { tabId: sender.tab.id },
                world: "MAIN", 
                func: (keywords) => {
                    if (window._bmBypassInjected) return; 
                    window._bmBypassInjected = true;
                    
                    const _originalConfirm = window.confirm;
                    window.confirm = function(msg) {
                        if (msg && keywords.every(kw => msg.includes(kw))) {
                            return true; 
                        }
                        return _originalConfirm(msg);
                    };
                },
                args: [message.keywords]
            }).catch(err => console.log("Bypass injection failed:", err));
        }
        return true;
    }
    else if (message.action === "OPEN_DOWNLOAD_FOLDER") {
        chrome.downloads.show(message.downloadId);
        return true;
    }
    else if (message.action === "QUICK_ACTION") {
        const tabId = sender.tab ? sender.tab.id : null;
        
        if (message.type === "search") {
            chrome.tabs.create({ url: "https://www.google.com/search?q=" + encodeURIComponent(message.cleanTitle) }).catch(() => {});
            return true;
        }

        if (message.type === "ridi_preview") {
            (async () => {
                const query = `site:https://ridibooks.com/books "${message.cleanTitle}"`;
                const googleUrl = "https://www.google.com/search?q=" + encodeURIComponent(query);
                const fallbackGoogleUrl = "https://www.google.com/search?q=" + encodeURIComponent(message.cleanTitle);
                
                try {
                    const res = await fetch(googleUrl);
                    const html = await res.text();
                    
                    const aTagRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
                    let matches = [];
                    let m;
                    while ((m = aTagRegex.exec(html)) !== null) {
                        let href = m[1];
                        let innerHtml = m[2];
                        
                        if (href.startsWith('/url?q=')) {
                            href = decodeURIComponent(href.split('&')[0].replace('/url?q=', ''));
                        }
                        
                        if (href.includes('ridibooks.com/books/')) {
                            let text = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                            matches.push({ url: href, title: text });
                        }
                    }

                    const getSimilarity = (a, b) => {
                        if (!a) return b ? 0 : 1;
                        if (!b) return 0;
                        const matrix = [];
                        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
                        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
                        for (let i = 1; i <= b.length; i++) {
                            for (let j = 1; j <= a.length; j++) {
                                if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
                                else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
                            }
                        }
                        let maxLen = Math.max(a.length, b.length);
                        return maxLen === 0 ? 1 : (maxLen - matrix[b.length][a.length]) / maxLen;
                    };

                    let targetBase = message.cleanTitle.replace(/^(\s*\[.*?\])+\s*/g, '').replace(/\s+/g, '');
                    
                    let validMatches = matches.filter(match => {
                        let rTitle = match.title;
                        let hasBracket = /^(\s*\[.*?\])+/.test(rTitle);
                        let cleanRTitle = rTitle.replace(/^(\s*\[.*?\])+\s*/g, '').replace(/\s+/g, '');
                        let limit = hasBracket ? 13 : 30;
                        let t1 = targetBase.substring(0, limit);
                        let t2 = cleanRTitle.substring(0, limit);
                        let similarity = getSimilarity(t1, t2);
                        let isIncluded = (t1.length > 1 && t2.length > 1) && (t1.includes(t2) || t2.includes(t1));
                        return similarity >= 0.70 || isIncluded;
                    });

                    let finalRidiUrl = null;
                    if (validMatches.length > 0) {
                        let p1 = validMatches.find(m => m.title.includes('1권 미리보기'));
                        let p2 = validMatches.find(m => m.title.includes('- 만화 e북'));
                        let p3 = validMatches.find(m => m.title.includes('- 만화 연재'));
                        let p4 = validMatches.find(m => m.title.includes('바닐라'));
                        let p5 = validMatches.find(m => m.title.includes('코믹'));

                        if (p1) finalRidiUrl = p1.url;
                        else if (p2) finalRidiUrl = p2.url;
                        else if (p3) finalRidiUrl = p3.url;
                        else if (p4) finalRidiUrl = p4.url;
                        else if (p5) finalRidiUrl = p5.url;
                        else finalRidiUrl = validMatches[0].url;
                    }

                    if (finalRidiUrl) {
                        chrome.tabs.create({ url: finalRidiUrl }).catch(() => {});
                    } else {
                        chrome.tabs.create({ url: fallbackGoogleUrl }).catch(() => {});
                    }
                } catch (err) {
                    chrome.tabs.create({ url: googleUrl }).catch(() => {});
                }
            })();
            return true;
        }
        
        if (message.type === "delete") {
            (async () => {
                let targetTitleStr = message.cleanTitle.replace(/\s+/g, '').toLowerCase();
                let existingBook = await db.books.where('cleanTitleStr').equals(targetTitleStr).first();
                
                if (existingBook) {
                    await db.books.where('cleanTitleStr').equals(targetTitleStr).delete();
                    bgListMapCache = null; 
                    if (tabId) chrome.tabs.sendMessage(tabId, { action: "SHOW_TOAST", book: existingBook, isDelete: true }).catch(() => {});
                } else {
                    if (tabId) chrome.tabs.sendMessage(tabId, { action: "SHOW_INFO_TOAST", msg: "등록된 데이터가 없어 삭제할 수 없습니다.", isError: true }).catch(() => {});
                }
            })();
            return true;
        }

        pendingTasks.push({
            cleanTitle: message.cleanTitle, 
            resolution: message.resolution, 
            lastVol: message.lastVol, 
            type: message.type, 
            dateString: new Date().toISOString(), 
            tabId: tabId
        });

        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(processSaveQueue, 10);
        return true;
    }
    else if (message.action === "DOWNLOAD_GIGAFILE") {
        (async () => {
            try {
                let url = message.url;
                let pw = message.password || "";

                let res = await fetch(url);
                let finalUrl = res.url;

                let hostMatch = finalUrl.match(/https?:\/\/([^\/]+)/);
                let host = hostMatch ? hostMatch[1] : "94.gigafile.nu";
                let fileIdMatch = finalUrl.match(/[?&]file=([0-9]{4}-[0-9a-zA-Z]+)/) || finalUrl.match(/\/([0-9]{4}-[0-9a-zA-Z]+)(?:[?&\/]|$)/);
                let fileId = fileIdMatch ? fileIdMatch[1] : null;

                if (!fileId) {
                    chrome.tabs.sendMessage(sender.tab.id, { action: "SHOW_INFO_TOAST", msg: "❌ 파일 ID를 찾을 수 없습니다.", isError: true }).catch(() => {});
                    return;
                }

                let pwQuery = pw ? "&dlkey=" + encodeURIComponent(pw) : "";
                let zipUrl = "https://" + host + "/dl_zip.php?file=" + fileId + pwQuery;       
                let singleUrl = "https://" + host + "/download.php?file=" + fileId + pwQuery;  

                let targetDlUrl = null;

                for (let testUrl of [zipUrl, singleUrl]) {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 5000); 
                        
                        const fetchRes = await fetch(testUrl, { method: 'GET', signal: controller.signal });
                        clearTimeout(timeoutId);

                        const ct = (fetchRes.headers.get('content-type') || '').toLowerCase();
                        const cd = (fetchRes.headers.get('content-disposition') || '').toLowerCase();
                        
                        controller.abort(); 

                        if (fetchRes.ok && (!ct.includes('text/html') || cd.includes('attachment'))) {
                            targetDlUrl = testUrl;
                            break;
                        }
                    } catch (e) {
                    }
                }

                if (!targetDlUrl) {
                    chrome.tabs.sendMessage(sender.tab.id, { action: "SHOW_INFO_TOAST", msg: "❌ 다운로드 링크를 찾지 못했거나 기간이 만료되었습니다.", isError: true }).catch(() => {});
                    return;
                }

                chrome.downloads.download({ url: targetDlUrl, conflictAction: "uniquify" }, (downloadId) => {
                    if (downloadId && message.title) {
                        downloadTitlesMap[downloadId] = message.title; 
                    }
                    if (chrome.runtime.lastError) {
                        chrome.tabs.sendMessage(sender.tab.id, { action: "SHOW_INFO_TOAST", msg: "❌ 다운로드 시작 실패: " + chrome.runtime.lastError.message, isError: true }).catch(() => {});
                    } else {
                        chrome.tabs.sendMessage(sender.tab.id, { action: "SHOW_INFO_TOAST", msg: "✅ Gigafile 백그라운드 다운로드가 시작되었습니다!" }).catch(() => {});
                    }
                });

            } catch (error) {
                chrome.tabs.sendMessage(sender.tab.id, { action: "SHOW_INFO_TOAST", msg: "❌ 주소 해석 중 에러가 발생했습니다.", isError: true }).catch(() => {});
            }
        })();
        return true; 
    }
    else if (message.action === "DOWNLOAD_GOFILE") {
        let url = message.url;
        let pw = message.password || "";
        
        chrome.tabs.sendMessage(sender.tab.id, { action: "SHOW_INFO_TOAST", msg: "🚀 Gofile 보안 회피를 위해 새 탭에서 자동 다운로드를 진행합니다." }).catch(()=>{});

        chrome.tabs.create({ url: url, active: true }, function(tab) {
            let listener = function(tabId, changeInfo) {
                if (tabId === tab.id && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: (password) => {
                            if (!document.getElementById('bm-macro-overlay')) {
                                const overlay = document.createElement('div');
                                overlay.id = 'bm-macro-overlay';
                                overlay.style.cssText = `
                                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                                    background: rgba(0, 0, 0, 0.85); z-index: 2147483647;
                                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                                    color: white; font-family: 'Malgun Gothic', sans-serif; pointer-events: all;
                                `;
                                overlay.innerHTML = `
                                    <style>@keyframes bm-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                                    <div style="width: 60px; height: 60px; border: 6px solid rgba(255,255,255,0.2); border-top: 6px solid #20c997; border-radius: 50%; animation: bm-spin 1s linear infinite; margin-bottom: 25px;"></div>
                                    <h2 style="margin: 0 0 15px 0; color: #fff; font-size: 26px; font-weight: bold; letter-spacing: -1px;">🚀 자동 다운로드 진행 중...</h2>
                                    <p style="margin: 0; color: #ced4da; font-size: 16px;">매크로가 안전하게 동작 중입니다. 마우스를 클릭하지 말고 잠시만 기다려주세요.</p>
                                    <p id="bm-macro-status" style="margin: 15px 0 0 0; color: #ffc107; font-size: 15px; font-weight: bold;">(Gofile 서버가 준비될 때까지 대기 중...)</p>
                                `;
                                document.body.appendChild(overlay);
                            }

                            let attempts = 0;
                            let stage = 'INIT'; 
                            let lastBtnCount = 0;
                            let stableCount = 0;
                            let totalBtnsToDownload = 0;
                            let clickedCount = 0;

                            const setNativeValue = (element, value) => {
                                const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
                                const prototype = Object.getPrototypeOf(element);
                                const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
                                if (valueSetter && valueSetter !== prototypeValueSetter) {
                                    prototypeValueSetter.call(element, value);
                                } else {
                                    valueSetter.call(element, value);
                                }
                                element.dispatchEvent(new Event('input', { bubbles: true }));
                            };
                            
                            const getVisiblePwInput = () => {
                                return Array.from(document.querySelectorAll('input[type="password"]')).find(el => {
                                    if (el.disabled) return false;
                                    const rect = el.getBoundingClientRect();
                                    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden' && window.getComputedStyle(el).display !== 'none';
                                });
                            };

                            const getDlBtns = () => {
                                return Array.from(document.querySelectorAll('button, a, div[role="button"]')).filter(el => {
                                    if (el.offsetParent === null || el.disabled) return false;
                                    let t = (el.textContent || '').trim().toLowerCase();
                                    if (t.includes('premium') || t.includes('app') || t.includes('vpn') || t.includes('download all') || t.includes('zip') || t.includes('play')) return false;
                                    return t === 'download' || el.querySelector('.fa-download, [data-icon="download"], i[class*="download"]');
                                });
                            };

                            const autoMacro = () => {
                                if (stage === 'DONE') return;

                                let pwInput = getVisiblePwInput();
                                
                                if (pwInput && stage === 'INIT') {
                                    if (!password) {
                                        let ov = document.getElementById('bm-macro-overlay');
                                        if (ov) {
                                            ov.innerHTML = `<h2 style="color:#ffc107;">🔒 비밀번호 필요</h2><p>본문에서 추출된 비밀번호가 없습니다. 수동으로 입력해주세요.</p>`;
                                            setTimeout(() => ov.remove(), 3000);
                                        }
                                        stage = 'DONE';
                                        return;
                                    }

                                    setNativeValue(pwInput, password);
                                    let submitBtn = document.querySelector('#passwordSubmit') || 
                                                    Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').toLowerCase().includes('enter') || (b.textContent||'').toLowerCase().includes('submit'));
                                    
                                    if (submitBtn) submitBtn.click();
                                    else pwInput.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                                    
                                    stage = 'WAIT_FOR_LIST';
                                    setTimeout(autoMacro, 2000); 
                                    return;
                                }

                                if (stage === 'INIT' && !pwInput) {
                                    stage = 'WAIT_FOR_LIST';
                                }
                                
                                if (stage === 'WAIT_FOR_LIST') {
                                    let currentValidBtns = getDlBtns();
                                    let statusText = document.getElementById('bm-macro-status');

                                    if (currentValidBtns.length > 0) {
                                        if (currentValidBtns.length === lastBtnCount) {
                                            stableCount++;
                                            if (statusText) statusText.innerText = `⏳ 파일 렌더링 완료 대기 중... (${stableCount}/2)`;
                                        } else {
                                            lastBtnCount = currentValidBtns.length;
                                            stableCount = 0;
                                            if (statusText) statusText.innerText = `⏳ 파일 목록 불러오는 중... (${lastBtnCount}개 발견)`;
                                        }

                                        if (stableCount >= 2) { 
                                            stage = 'DL_CLICKED';
                                            totalBtnsToDownload = currentValidBtns.length;
                                            if (statusText) statusText.innerText = `✅ 총 ${totalBtnsToDownload}개 파일 확인됨. 다운로드 시작!`;

                                            setTimeout(() => {
                                                let clickInterval = setInterval(() => {
                                                    let freshBtns = getDlBtns();

                                                    if (clickedCount < freshBtns.length) {
                                                        let targetBtn = freshBtns[clickedCount];
                                                        try { 
                                                            targetBtn.scrollIntoView({block: 'center', behavior: 'smooth'}); 
                                                            targetBtn.click(); 
                                                            clickedCount++;
                                                            
                                                            let statusText2 = document.getElementById('bm-macro-status');
                                                            if (statusText2) statusText2.innerText = `⏳ 파일 순차 다운로드 중... (${clickedCount} / ${totalBtnsToDownload})`;
                                                        } catch(e){}
                                                    } else {
                                                        clearInterval(clickInterval);
                                                        let statusText3 = document.getElementById('bm-macro-status');
                                                        if (statusText3) statusText3.innerText = `✅ 총 ${clickedCount}개 다운로드 요청 완료! (곧 창이 닫힙니다)`;
                                                        
                                                        stage = 'DONE';
                                                        setTimeout(() => {
                                                            chrome.runtime.sendMessage({ action: "CLOSE_ME" });
                                                        }, 5000);
                                                    }
                                                }, 2500); 
                                                
                                            }, 1000); 
                                            return; 
                                        }
                                    } else {
                                        attempts++;
                                        if (attempts > 30) {
                                            let ov = document.getElementById('bm-macro-overlay');
                                            if (ov) {
                                                ov.innerHTML = `<h2 style="color:#dc3545;">⚠️ 자동 다운로드 지연됨</h2><p>화면을 클릭하여 수동으로 진행해 주세요.</p>`;
                                                setTimeout(() => ov.remove(), 3000);
                                            }
                                            stage = 'DONE';
                                        }
                                    }

                                    if (stage === 'WAIT_FOR_LIST') {
                                        setTimeout(autoMacro, 800); 
                                    }
                                }
                            };
                            
                            setTimeout(autoMacro, 1000);
                        },
                        args: [pw]
                    }).catch(err => console.log(err));
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        return true;
    }
    else if (message.action === "DOWNLOAD_HELLKDIS") {
        (async () => {
            try {
                let url = message.url;
                let pw = message.password || "";
                
                let urlObj = new URL(url);
                let host = urlObj.origin;
                let tokenMatch = url.match(/\/s\/([a-zA-Z0-9]+)/);
                if (!tokenMatch) throw new Error("토큰을 찾을 수 없습니다.");
                let token = tokenMatch[1];

                let res = await fetch(url);
                let currentUrl = res.url; 
                let html = await res.text();
                
                let isPasswordProtected = html.includes('name="password"') || html.includes('password-input-form');
                let authHtml = html;

                if (isPasswordProtected) {
                    if (!pw) throw new Error("비밀번호가 필요합니다.");
                    
                    let rtMatch = html.match(/data-requesttoken="([^"]+)"/);
                    if (!rtMatch) throw new Error("CSRF 토큰을 추출할 수 없습니다.");
                    let requestToken = rtMatch[1];

                    let params = new URLSearchParams();
                    params.append('password', pw);
                    params.append('requesttoken', requestToken);
                    
                    let stMatch = html.match(/name="sharingToken" value="([^"]+)"/);
                    if(stMatch) params.append('sharingToken', stMatch[1]);
                    params.append('sharingType', '3'); 

                    let authRes = await fetch(currentUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'requesttoken': requestToken 
                        },
                        body: params.toString()
                    });
                    
                    authHtml = await authRes.text();
                    if (authHtml.includes('name="password"') || authHtml.includes('Wrong password') || authHtml.includes('비밀번호가 잘못되었습니다')) {
                        throw new Error("비밀번호가 틀렸습니다.");
                    }
                }
                
                let dlMatch = authHtml.match(/href="([^"]+dav\/files[^"]+)"/);
                let dlUrl = "";
                if (dlMatch) {
                    dlUrl = dlMatch[1].replace(/&amp;/g, '&');
                    if (dlUrl.startsWith('/')) dlUrl = host + dlUrl;
                } else {
                    dlUrl = `${host}/s/${token}/download`; 
                }
                
                chrome.downloads.download({ url: dlUrl, conflictAction: "uniquify" }, (downloadId) => {
                    if (downloadId && message.title) {
                        downloadTitlesMap[downloadId] = message.title;
                    }
                    if (chrome.runtime.lastError) {
                        chrome.tabs.sendMessage(sender.tab.id, { action: "SHOW_INFO_TOAST", msg: "❌ 다운로드 시작 실패: " + chrome.runtime.lastError.message, isError: true }).catch(() => {});
                    } else {
                        chrome.tabs.sendMessage(sender.tab.id, { action: "SHOW_INFO_TOAST", msg: "✅ Hellkdis 백그라운드 다운로드가 시작되었습니다!" }).catch(() => {});
                    }
                });
                
            } catch (error) {
                chrome.tabs.sendMessage(sender.tab.id, { action: "SHOW_INFO_TOAST", msg: "⚠️ 백그라운드 통신 실패. 새 탭을 열어 다운로드를 진행합니다.", isError: true }).catch(() => {});
                chrome.runtime.sendMessage({ action: "OPEN_HELLKDIS_WITH_PW", url: message.url, password: message.password }).catch(() => {});
            }
        })();
        return true;
    }
    else if (message.action === "OPEN_HELLKDIS_WITH_PW") {
        let url = message.url;
        let pw = message.password;
        
        chrome.tabs.create({ url: url, active: true }, function(tab) {
            let listener = function(tabId, changeInfo, updatedTab) {
                if (tabId === tab.id && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: (password) => {
                            if (!document.getElementById('bm-macro-overlay')) {
                                const overlay = document.createElement('div');
                                overlay.id = 'bm-macro-overlay';
                                overlay.style.cssText = `
                                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                                    background: rgba(0, 0, 0, 0.85); z-index: 2147483647;
                                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                                    color: white; font-family: 'Malgun Gothic', sans-serif; pointer-events: all;
                                `;
                                overlay.innerHTML = `
                                    <style>@keyframes bm-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                                    <div style="width: 60px; height: 60px; border: 6px solid rgba(255,255,255,0.2); border-top: 6px solid #6f42c1; border-radius: 50%; animation: bm-spin 1s linear infinite; margin-bottom: 25px;"></div>
                                    <h2 style="margin: 0 0 15px 0; color: #fff; font-size: 26px; font-weight: bold; letter-spacing: -1px;">🚀 자동 다운로드 진행 중...</h2>
                                    <p style="margin: 0; color: #ced4da; font-size: 16px;">매크로가 안전하게 동작 중입니다. 마우스를 클릭하지 말고 잠시만 기다려주세요.</p>
                                    <p id="bm-macro-status" style="margin: 15px 0 0 0; color: #ffc107; font-size: 15px; font-weight: bold;">(다운로드가 서버에서 시작되면 창이 자동으로 닫힙니다)</p>
                                `;
                                document.body.appendChild(overlay);
                            }

                            const setNativeValue = (element, value) => {
                                const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
                                const prototype = Object.getPrototypeOf(element);
                                const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
                                if (valueSetter && valueSetter !== prototypeValueSetter) {
                                    prototypeValueSetter.call(element, value);
                                } else {
                                    valueSetter.call(element, value);
                                }
                                element.dispatchEvent(new Event('input', { bubbles: true }));
                            };

                            const getVisiblePwInput = () => {
                                return Array.from(document.querySelectorAll('input[type="password"]')).find(el => {
                                    if (el.disabled) return false;
                                    const rect = el.getBoundingClientRect();
                                    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden' && window.getComputedStyle(el).display !== 'none';
                                });
                            };

                            let attempts = 0;
                            let stage = 'INIT';
                            
                            const autoMacro = () => {
                                if (stage === 'DONE') return;
                                attempts++;
                                
                                let pwInput = getVisiblePwInput();
                                let dlBtn = document.querySelector('#public-page-menu--primary, a[href*="/dav/files/"]');
                                if (!dlBtn) {
                                    dlBtn = Array.from(document.querySelectorAll('a[role="button"], button')).find(el => (el.textContent||'').includes('다운로드'));
                                }

                                if (pwInput && password && stage === 'INIT') {
                                    setNativeValue(pwInput, password);
                                    
                                    let submitBtn = document.querySelector('button.icon-confirm, button[type="submit"], input[type="submit"], .button-vue--primary, button.primary');
                                    if (submitBtn) {
                                        submitBtn.click();
                                    } else {
                                        let form = pwInput.closest('form');
                                        if(form) form.submit();
                                        else pwInput.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                                    }
                                    stage = 'PW_ENTERED';
                                    setTimeout(autoMacro, 1500);
                                    return;
                                    
                                } else if (dlBtn && stage !== 'DL_CLICKED') {
                                    stage = 'DL_CLICKED';
                                    
                                    setTimeout(() => {
                                        dlBtn.click();
                                        let statusText = document.getElementById('bm-macro-status');
                                        if (statusText) statusText.innerText = "✅ 다운로드 요청 완료! 곧 창이 닫힙니다...";
                                        
                                        setTimeout(() => { chrome.runtime.sendMessage({ action: "CLOSE_ME" }); }, 6000);
                                    }, 1000);
                                    
                                } else if (attempts < 40 && stage !== 'DL_CLICKED') {
                                    setTimeout(autoMacro, 500);
                                } else if (attempts >= 40 && stage !== 'DL_CLICKED') {
                                    let ov = document.getElementById('bm-macro-overlay');
                                    if (ov) {
                                        ov.innerHTML = `<h2 style="color:#dc3545;">⚠️ 자동 다운로드 지연됨</h2><p>화면을 클릭하여 수동으로 다운로드를 진행해 주세요.</p>`;
                                        setTimeout(() => ov.remove(), 2500);
                                    }
                                }
                            };
                            setTimeout(autoMacro, 1000);
                        },
                        args: [pw || ""]
                    }).catch(err => console.log(err));
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        return true;
    }
    else if (message.action === "DOWNLOAD_TRANSFERIT") {
        (async () => {
            try {
                const transferUrl = message.url;
                
                chrome.tabs.sendMessage(sender.tab.id, { 
                    action: "SHOW_INFO_TOAST", 
                    msg: "🚀 Transfer.it 백그라운드 다운로드를 준비합니다..." 
                }).catch(() => {});

                chrome.tabs.create({ url: transferUrl, active: false }, (tab) => {
                    const macroTabId = tab.id;

                    const tabListener = (updatedTabId, changeInfo) => {
                        if (updatedTabId === macroTabId && changeInfo.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(tabListener);

                            chrome.scripting.executeScript({
                                target: { tabId: macroTabId },
                                func: () => {
                                    if (!document.getElementById('bm-macro-overlay')) {
                                        const overlay = document.createElement('div');
                                        overlay.id = 'bm-macro-overlay';
                                        overlay.style.cssText = `
                                            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                                            background: rgba(0, 0, 0, 0.85); z-index: 2147483647;
                                            display: flex; flex-direction: column; align-items: center; justify-content: center;
                                            color: white; font-family: 'Malgun Gothic', sans-serif; pointer-events: none;
                                        `;
                                        overlay.innerHTML = `
                                            <div style="width: 50px; height: 50px; border: 5px solid rgba(255,255,255,0.2); border-top: 5px solid #dc3545; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px;"></div>
                                            <h2 style="margin: 0 0 15px 0; color: #fff; font-size: 26px;">🚀 Transfer.it 자동 다운로드 중...</h2>
                                            <p style="margin: 0; color: #ced4da; font-size: 16px;">파일을 준비하고 있습니다. 다운로드가 시작되면 이 탭은 자동으로 닫힙니다.</p>
                                            <p id="bm-macro-status" style="margin: 15px 0 0 0; color: #ffc107; font-size: 15px; font-weight: bold;">(다운로드 버튼 추적 중...)</p>
                                            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                                        `;
                                        document.body.appendChild(overlay);
                                    }

                                    let attempts = 0;
                                    const clickDownload = () => {
                                        attempts++;
                                        
                                        let dlBtn = document.querySelector('.js-standard-download, .js-zip-download, .download-btn');
                                        
                                        if (!dlBtn) {
                                            const elements = Array.from(document.querySelectorAll('button, a, div, span'));
                                            dlBtn = elements.find(el => {
                                                if (el.offsetParent === null) return false; 
                                                if (el.children.length > 2) return false;   
                                                
                                                const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                                                return text === 'download' || 
                                                       text === '다운로드' || 
                                                       text === 'download as zip' || 
                                                       text === 'zip으로 다운로드' || 
                                                       text === '모두 다운로드' || 
                                                       text === '일반 다운로드' ||
                                                       text === 'download all';
                                            });
                                        }

                                        const statusEl = document.getElementById('bm-macro-status');

                                        if (dlBtn) {
                                            if (statusEl) statusEl.innerText = "✅ 버튼 클릭 완료! 서버 응답 대기 중...";
                                            dlBtn.click(); 
                                        } else if (attempts < 60) {
                                            setTimeout(clickDownload, 1000);
                                        } else {
                                            if (statusEl) {
                                                statusEl.innerText = "⚠️ 버튼을 찾을 수 없습니다. 화면을 클릭하여 수동으로 다운로드 해주세요.";
                                                statusEl.style.color = "#dc3545";
                                            }
                                        }
                                    };
                                    setTimeout(clickDownload, 2000);
                                }
                            }).catch(err => console.log("스크립트 주입 에러:", err));
                        }
                    };
                    chrome.tabs.onUpdated.addListener(tabListener);

                    let myDownloadId = null;

                    const onCreatedListener = (item) => {
                        const isTransferItDownload = 
                            item.url.includes('.userstorage.mega.co.nz') || 
                            item.url.includes('transfer.it') ||
                            (item.referrer && item.referrer.includes('transfer.it'));

                        if (isTransferItDownload) {
                            myDownloadId = item.id;
                            if (message.title) downloadTitlesMap[item.id] = message.title; 
                            
                            chrome.tabs.sendMessage(sender.tab.id, { 
                                action: "SHOW_INFO_TOAST", msg: "✅ Transfer.it 다운로드가 시작되었습니다! (탭 자동 종료)" 
                            }).catch(() => {});
                            
                            chrome.downloads.onCreated.removeListener(onCreatedListener);

                            if (!item.url.startsWith('blob:')) {
                                setTimeout(() => { chrome.tabs.remove(macroTabId).catch(() => {}); }, 2000);
                            }
                        }
                    };
                    chrome.downloads.onCreated.addListener(onCreatedListener);

                    const onChangedListener = (delta) => {
                        if (delta.id === myDownloadId && delta.state) {
                            if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
                                chrome.tabs.remove(macroTabId).catch(() => {}); 
                                chrome.downloads.onChanged.removeListener(onChangedListener);
                            }
                        }
                    };
                    chrome.downloads.onChanged.addListener(onChangedListener);
                    
                    setTimeout(() => {
                        chrome.tabs.remove(macroTabId).catch(() => {});
                        chrome.downloads.onCreated.removeListener(onCreatedListener);
                        chrome.downloads.onChanged.removeListener(onChangedListener);
                    }, 1000 * 60 * 10);
                });

            } catch (error) {
                console.error("[Transfer.it] 에러:", error);
                chrome.tabs.sendMessage(sender.tab.id, { 
                    action: "SHOW_INFO_TOAST", msg: `❌ Transfer.it 오류: ${error.message}`, isError: true 
                }).catch(() => {});
            }
        })();
        return true;
    }
});

function createIndependentMenus() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: "addExclude", title: "1. 제외 추가", contexts: ["link", "selection"] });
        chrome.contextMenus.create({ id: "addIncomplete", title: "2. 미완 추가", contexts: ["link", "selection"] });
        chrome.contextMenus.create({ id: "addComplete", title: "3. 완결 추가", contexts: ["link", "selection"] });
        chrome.contextMenus.create({ id: "deleteBook", title: "4. 삭제 처리", contexts: ["link", "selection"] });
        chrome.contextMenus.create({ id: "searchBook", title: "5. 검색", contexts: ["link", "selection"] });
        
        chrome.contextMenus.create({ id: "separator", type: "separator", contexts: ["all"] });
        chrome.contextMenus.create({ id: "registerDetailSelector", title: "🎯 이 요소를 상세페이지 제목으로 등록 (버튼 표시)", contexts: ["all"] });
    });
}

// 마이그레이션 안전 점검 함수
async function checkAndRunMigration() {
    try {
        console.log("🚀 [마이그레이션 시스템] 상태 점검을 시작합니다...");

        // 1. 기존 데이터(배열) 불러오기
        const storage = await chrome.storage.local.get(['bookList']);
        
        // 2. 현재 IndexedDB에 저장된 데이터 개수 확인
        const dbCount = await db.books.count();
        console.log(`📊 [데이터 확인] DB 저장 개수: ${dbCount}개 / 기존 구버전 데이터 개수: ${storage.bookList ? storage.bookList.length : 0}개`);

        // 3. 강제 마이그레이션 조건: DB가 완전히 비어있는데, 구버전 데이터는 존재하는 경우 (플래그 무시)
        if (dbCount === 0 && storage.bookList && storage.bookList.length > 0) {
            console.log("⚠️ DB가 비어있습니다. 구버전 데이터 복원(마이그레이션)을 강제 실행합니다!");
            
            const booksToAdd = storage.bookList.map((book, index) => {
                // 고유 키(cleanTitleStr)가 없어서 DB 저장이 튕기는 것을 방지하는 안전 장치
                let safeTitle = (book.title || "").replace(/\s+/g, '').toLowerCase();
                if (!safeTitle) safeTitle = "unknown_title_" + Date.now() + "_" + index;

                return {
                    title: book.title || "제목 없음",
                    cleanTitleStr: safeTitle,
                    type: book.type || 'unknown',
                    resolution: book.resolution || "",
                    lastVol: book.lastVol || "",
                    date: book.date || new Date().toISOString(),
                    _regBodyOriginal: book._regBodyOriginal || (book.title || "").replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ\sぁ-んァ-ヶー一-龥]/g, '').toLowerCase().trim()
                };
            });

            // 트랜잭션을 사용하여 안전하게 대량 삽입
            await db.transaction('rw', db.books, async () => {
                await db.books.bulkPut(booksToAdd);
            });

            console.log(`✅ [마이그레이션 성공] 총 ${booksToAdd.length}개의 도서 데이터가 IndexedDB로 완벽히 복원되었습니다.`);
            await chrome.storage.local.set({ isMigratedToDB: true });
            
        } else if (dbCount > 0) {
            console.log("✅ 이미 DB에 데이터가 존재합니다. 마이그레이션을 건너뜁니다.");
            // 혹시라도 플래그가 누락되었다면 다시 세워줌
            await chrome.storage.local.set({ isMigratedToDB: true });
        } else {
            console.log("ℹ️ 기존 구버전 데이터가 없어 마이그레이션 할 내용이 없습니다.");
        }
    } catch (error) {
        console.error("❌ [마이그레이션 치명적 오류]:", error);
    }
}

chrome.runtime.onInstalled.addListener(() => {
    createIndependentMenus();
});

chrome.runtime.onStartup.addListener(() => {
    createIndependentMenus();
});

checkAndRunMigration();

let pendingTasks = [];
let isSaving = false;
let saveTimer = null;
let bgListMapCache = null; 
let bgListLength = -1;

// 기존 chrome.contextMenus.onClicked.addListener 블럭 전체를 교체
chrome.contextMenus.onClicked.addListener((info, tab) => {
    const menuId = info.menuItemId;
    console.log("[우클릭 이벤트] 메뉴 ID:", menuId);

    if (menuId === "registerDetailSelector") {
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "GET_AND_REGISTER_SELECTOR" }).catch(() => {});
        }
        return;
    }

    let rawTitle = (info.selectionText || lastRightClickedTitle || info.linkText || "").trim();
    console.log("[우클릭 이벤트] 추출된 원본 제목:", rawTitle);
    
    if (!rawTitle) return;

    let cleanTitle = cleanSiteTitle(rawTitle);
    console.log("[우클릭 이벤트] 정제된 제목:", cleanTitle);

    if (!cleanTitle) {
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "SHOW_INFO_TOAST", msg: "❌ 제목을 식별할 수 없어 취소되었습니다.", isError: true }).catch(() => {});
        }
        return; 
    }

    if (menuId === "searchBook") {
        chrome.tabs.create({ url: "https://www.google.com/search?q=" + encodeURIComponent(cleanTitle) }).catch(() => {});
        return;
    }

    if (menuId === "deleteBook") {
        (async () => {
            let targetTitleStr = cleanTitle.replace(/\s+/g, '').toLowerCase();
            let existingBook = await db.books.where('cleanTitleStr').equals(targetTitleStr).first();

            if (existingBook) {
                await db.books.where('cleanTitleStr').equals(targetTitleStr).delete();
                bgListMapCache = null;
                if (tab && tab.id) {
                    chrome.tabs.sendMessage(tab.id, { action: "SHOW_TOAST", book: existingBook, isDelete: true }).catch(() => {});
                }
            } else {
                if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { action: "SHOW_INFO_TOAST", msg: "등록된 데이터가 없어 삭제할 수 없습니다.", isError: true }).catch(() => {});
            }
        })();
        return;
    }

    let type = "exclude";
    if (menuId === "addIncomplete") type = "incomplete";
    if (menuId === "addComplete") type = "complete";

    const resMatch = rawTitle.match(/\d{3,4}\s*p(?:x)?/gi);
    const resolution = resMatch ? Array.from(new Set(resMatch)).map(s => {
        let lower = s.toLowerCase();
        return lower.endsWith('px') ? lower : lower + 'x';
    }).join(',') : "";
    let lastVol = "";
    
    const rangeMatch = rawTitle.match(/(\d+)\s*(?:권|화)?\s*[\~\-～〜〰∼–—_,\/&・·･]\s*(\d+)(?!\s*(?:px|p)\b)/i);
    const volMatch = rawTitle.match(/(\d+)\s*(?:권|화)/);
    const endNumMatch = rawTitle.match(/(\d+)\s*(?=[\[\(]|$)/);

    if (rangeMatch) lastVol = parseInt(rangeMatch[2], 10).toString();
    else if (volMatch) lastVol = parseInt(volMatch[1], 10).toString();
    else if (endNumMatch) lastVol = parseInt(endNumMatch[1], 10).toString();

    const dateString = new Date().toISOString(); 

    let taskData = {
        cleanTitle, resolution, lastVol, type, dateString, tabId: tab?.id
    };
    console.log("[우클릭 이벤트] 큐에 추가할 데이터:", taskData);

    pendingTasks.push(taskData);

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(processSaveQueue, 10);
});

// 기존 processSaveQueue 블럭 전체를 교체
async function processSaveQueue() {
    if (pendingTasks.length === 0) return;
    if (isSaving) {
        setTimeout(processSaveQueue, 10); 
        return;
    }
    
    isSaving = true;
    const tasks = [...pendingTasks]; 
    pendingTasks = []; 

    let lastSavedBook = null;
    let targetTabId = null;

    console.log("[저장 프로세스] 큐 처리 시작, 총 건수:", tasks.length);

    try {
        for (let task of tasks) {
            const targetTitleStr = task.cleanTitle.replace(/\s+/g, '').toLowerCase();
            
            let existingBook = await db.books.where('cleanTitleStr').equals(targetTitleStr).first();
            
            let bookData = {
                title: task.cleanTitle,
                cleanTitleStr: targetTitleStr,
                type: task.type,
                resolution: task.resolution || (existingBook ? existingBook.resolution : ""),
                lastVol: task.lastVol || (existingBook ? existingBook.lastVol : ""),
                date: task.dateString
            };

            if (existingBook && existingBook.id) {
                bookData.id = existingBook.id; 
                console.log("[저장 프로세스] 기존 데이터 업데이트:", bookData);
            } else {
                console.log("[저장 프로세스] 신규 데이터 인서트:", bookData);
            }

            await db.books.put(bookData);
            lastSavedBook = bookData;
            if (task.tabId) targetTabId = task.tabId;
        }

        console.log("[저장 프로세스] DB 반영 완료");

        if (targetTabId && lastSavedBook) {
            let msgBook = { ...lastSavedBook }; 
            if (tasks.length > 1) {
                msgBook.title = "[총 " + tasks.length + "건 연속 처리] " + msgBook.title;
            }
            chrome.tabs.sendMessage(targetTabId, { action: "SHOW_TOAST", book: msgBook }).catch((e) => {
                console.log("[저장 프로세스] Toast 전송 실패 (탭 닫힘 등):", e);
            });
        }
    } catch (error) {
        console.error("[저장 프로세스] 치명적 에러 발생:", error);
    } finally {
        isSaving = false;
        if (pendingTasks.length > 0) processSaveQueue();
    }
}


let downloadSpeedCache = {};
let progressInterval = null;

function startProgressBroadcasting() {
    if (progressInterval) return;
    progressInterval = setInterval(() => {
        chrome.downloads.search({ state: "in_progress" }, (results) => {
            if (!results || results.length === 0) {
                clearInterval(progressInterval);
                progressInterval = null;
                broadcastToAllTabs({ action: "UPDATE_DOWNLOAD_PROGRESS", downloads: [] });
                return;
            }

            let now = Date.now();
            let progressData = results.map(dl => {
                let speed = 0;
                let cache = downloadSpeedCache[dl.id];

                if (cache) {
                    let timeDiff = (now - cache.lastTime) / 1000;
                    let bytesDiff = dl.bytesReceived - cache.lastBytes;
                    if (timeDiff > 0) {
                        speed = bytesDiff / timeDiff;
                    }
                }
                
                downloadSpeedCache[dl.id] = { lastBytes: dl.bytesReceived, lastTime: now };

                return {
                    id: dl.id,
                    filename: dl.filename.split(/[\\/]/).pop() || "알 수 없는 파일",
                    bytesReceived: dl.bytesReceived,
                    totalBytes: dl.totalBytes,
                    speed: speed,
                    state: dl.state
                };
            });

            broadcastToAllTabs({ action: "UPDATE_DOWNLOAD_PROGRESS", downloads: progressData });
        });
    }, 1000); 
}

function broadcastToAllTabs(message) {
    chrome.tabs.query({}, function(tabs) {
        for (let tab of tabs) {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
    });
}

chrome.downloads.onCreated.addListener((downloadItem) => {
    startProgressBroadcasting();
});

chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === 'complete') {
        chrome.downloads.search({ id: delta.id }, (res) => {
            if (res && res[0]) {
                broadcastToAllTabs({ action: "DOWNLOAD_COMPLETE_TOAST", id: delta.id, filename: res[0].filename });
            }
        });
    }

    if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
        delete downloadSpeedCache[delta.id];
        delete downloadTitlesMap[delta.id]; 
        startProgressBroadcasting();
    }
});

let expectedDownloadTitle = null;
let hookFallbackTimer = null;

const dynamicFolderListener = (item, suggest) => {
    let title = downloadTitlesMap[item.id] || expectedDownloadTitle;
    if (title) {
        chrome.storage.local.get({ autoFolder: true }, (data) => {
            if (data.autoFolder !== false) {
                let safeTitle = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
                if (safeTitle) {
                    suggest({ filename: safeTitle + "/" + item.filename, conflictAction: "uniquify" });
                    return;
                }
            }
            suggest();
        });
        return true;
    }
    return false; 
};

chrome.runtime.onMessage.addListener((message) => {
    if (message.action && message.action.startsWith("DOWNLOAD_") && message.title) {
        expectedDownloadTitle = message.title;
        
        if (!chrome.downloads.onDeterminingFilename.hasListener(dynamicFolderListener)) {
            chrome.downloads.onDeterminingFilename.addListener(dynamicFolderListener);
        }
        
        if (hookFallbackTimer) clearTimeout(hookFallbackTimer);
        hookFallbackTimer = setTimeout(() => {
            if (chrome.downloads.onDeterminingFilename.hasListener(dynamicFolderListener)) {
                chrome.downloads.onDeterminingFilename.removeListener(dynamicFolderListener);
            }
        }, 3 * 60 * 1000);
    }
});

chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
        if (Object.keys(downloadTitlesMap).length === 0) {
            if (chrome.downloads.onDeterminingFilename.hasListener(dynamicFolderListener)) {
                chrome.downloads.onDeterminingFilename.removeListener(dynamicFolderListener);
                expectedDownloadTitle = null;
            }
        }
    }
});

async function getTransferDownloadUrl(url) {
    try {
        const idMatch = url.match(/\/(?:t|s)\/([a-zA-Z0-9_-]+)/);
        if (!idMatch || !idMatch[1]) {
            throw new Error("Invalid transfer.it URL. Could not extract transfer ID.");
        }
        const transferId = idMatch[1];
        console.log("Extracted Transfer ID:", transferId);

        const transferApiUrl = `https://transfer.it/api/transfer/${transferId}`;
        const transferApiRes = await fetch(transferApiUrl);
        
        if (!transferApiRes.ok) {
            throw new Error(`Failed to fetch transfer details (HTTP ${transferApiRes.status}).`);
        }
        
        const transferData = await transferApiRes.json();
        const nParam = transferData.n;
        
        if (!nParam) {
            throw new Error("Security parameter 'n' is missing");
        }

        const megaApiUrl = 'https://bt7.api.mega.co.nz/cs';
        const megaApiRes = await fetch(megaApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Referer': 'https://transfer.it/'
            },
            body: JSON.stringify([
                {
                    "a": "g",
                    "g": 1,
                    "n": nParam
                }
            ])
        });

        if (!megaApiRes.ok) {
            throw new Error(`MEGA API communication failed (HTTP ${megaApiRes.status})`);
        }
        
        const megaData = await megaApiRes.json();

        if (typeof megaData === 'number' && megaData < 0) {
            throw new Error(`MEGA API Error Code: ${megaData}`);
        }
        if (Array.isArray(megaData) && typeof megaData[0] === 'number' && megaData[0] < 0) {
            throw new Error(`MEGA API Error Array: ${megaData[0]}`);
        }

        if (!Array.isArray(megaData) || !megaData[0] || !megaData[0].g) {
            throw new Error("MEGA API did not return a valid download URL.");
        }

        const finalUrl = megaData[0].g;

        return finalUrl;

    } catch (error) {
        console.error("Resolution Error:", error);
        throw error; 
    }
}

let focusWindowStates = {}; 
let focusTabIndices = {};

function initFocusLeftMacro() {
    if (!chrome.tabs) return;

    chrome.tabs.query({}, tabs => {
        tabs.forEach(t => {
            focusTabIndices[t.id] = t.index;
            if (t.active) {
                focusWindowStates[t.windowId] = { activeTabId: t.id, prevTabId: null, lastSwitchTime: 0 };
            }
        });
    });

    const updateIndices = () => {
        chrome.tabs.query({}, tabs => {
            tabs.forEach(t => focusTabIndices[t.id] = t.index);
        });
    };
    
    chrome.tabs.onCreated.addListener(updateIndices);
    chrome.tabs.onMoved.addListener(updateIndices);
    chrome.tabs.onAttached.addListener(updateIndices);
    chrome.tabs.onDetached.addListener(updateIndices);

    chrome.tabs.onActivated.addListener(activeInfo => {
        let win = focusWindowStates[activeInfo.windowId] || { activeTabId: null, prevTabId: null, lastSwitchTime: 0 };
        win.prevTabId = win.activeTabId;
        win.activeTabId = activeInfo.tabId;
        win.lastSwitchTime = Date.now();
        focusWindowStates[activeInfo.windowId] = win;
    });

    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
        if (removeInfo.isWindowClosing) return;

        chrome.storage.local.get({ focusLeftTab: false }, (data) => {
            if (!data.focusLeftTab) return;

            let win = focusWindowStates[removeInfo.windowId];
            let closedIndex = focusTabIndices[tabId];

            let wasActive = false;
            if (win) {
                if (win.activeTabId === tabId) {
                    wasActive = true;
                } else if (win.prevTabId === tabId && (Date.now() - win.lastSwitchTime < 150)) {
                    wasActive = true;
                }
            }

            if (wasActive && closedIndex > 0) {
                let leftIndex = closedIndex - 1;
                
                chrome.tabs.query({ windowId: removeInfo.windowId }, (tabs) => {
                    let leftTab = tabs.find(t => t.index === leftIndex);
                    if (leftTab) {
                        chrome.tabs.update(leftTab.id, { active: true });
                    }
                });
            }
            
            delete focusTabIndices[tabId];
        });
    });
}

initFocusLeftMacro();