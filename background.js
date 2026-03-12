importScripts('common.js');

let lastRightClickedTitle = "";
let downloadTitlesMap = {}; // 💡 다운로드 ID와 폴더명(책 제목) 매핑
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
      
      if (message.type === "delete") {
          chrome.storage.local.get({ bookList: [] }, (data) => {
              let list = Array.isArray(data.bookList) ? data.bookList : [];
              let targetTitleStr = message.cleanTitle.replace(/\s+/g, '').toLowerCase();

              let existingIndex = list.findIndex(b => {
                  const bTitle = (b.title || "").replace(/\s+/g, '').toLowerCase();
                  return targetTitleStr === bTitle;
              });

              if (existingIndex > -1) {
                  let deletedBook = list.splice(existingIndex, 1)[0];
                  chrome.storage.local.set({ bookList: list }, () => {
                      if (tabId) chrome.tabs.sendMessage(tabId, { action: "SHOW_TOAST", book: deletedBook, isDelete: true }).catch(() => {});
                  });
              } else {
                  if (tabId) chrome.tabs.sendMessage(tabId, { action: "SHOW_INFO_TOAST", msg: "❌ 등록된 데이터가 없어 삭제할 수 없습니다.", isError: true }).catch(() => {});
              }
          });
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

        // 💡 콜백에서 다운로드 ID와 폴더명(title) 연결
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
            
            // 💡 콜백에서 다운로드 ID와 폴더명(title) 연결
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
chrome.runtime.onInstalled.addListener(createIndependentMenus);
chrome.runtime.onStartup.addListener(createIndependentMenus);

let pendingTasks = [];
let isSaving = false;
let saveTimer = null;

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = info.menuItemId;

  if (menuId === "registerDetailSelector") {
      if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: "GET_AND_REGISTER_SELECTOR" }).catch(() => {});
      }
      return;
  }

  let rawTitle = (info.selectionText || lastRightClickedTitle || info.linkText || "").trim();
  if (!rawTitle) return;

  let cleanTitle = cleanSiteTitle(rawTitle);

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
      chrome.storage.local.get({ bookList: [] }, (data) => {
          let list = Array.isArray(data.bookList) ? data.bookList : [];
          let targetTitleStr = cleanTitle.replace(/\s+/g, '').toLowerCase();

          let existingIndex = list.findIndex(b => {
              const bTitle = (b.title || "").replace(/\s+/g, '').toLowerCase();
              return targetTitleStr === bTitle;
          });

          if (existingIndex > -1) {
              let deletedBook = list.splice(existingIndex, 1)[0];
              chrome.storage.local.set({ bookList: list }, () => {
                  if (tab && tab.id) {
                      chrome.tabs.sendMessage(tab.id, { action: "SHOW_TOAST", book: deletedBook, isDelete: true }).catch(() => {});
                  }
              });
          } else {
              if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { action: "SHOW_INFO_TOAST", msg: "❌ 등록된 데이터가 없어 삭제할 수 없습니다.", isError: true }).catch(() => {});
          }
      });
      return;
  }

  let type = "exclude";
  if (menuId === "addIncomplete") type = "incomplete";
  if (menuId === "addComplete") type = "complete";

  const resMatch = rawTitle.match(/\d{3,4}\s*px/gi);
  const resolution = resMatch ? Array.from(new Set(resMatch)).join(',') : "";
  let lastVol = "";
  
  const rangeMatch = rawTitle.match(/(\d+)\s*(?:권|화|부(?!터))?\s*[~-]\s*(\d+)/);
  const volMatch = rawTitle.match(/(\d+)\s*(?:권|화|부(?!터))/);
  const endNumMatch = rawTitle.match(/(\d+)\s*(?=[\[\(]|$)/);

  if (rangeMatch) lastVol = parseInt(rangeMatch[2], 10).toString();
  else if (volMatch) lastVol = parseInt(volMatch[1], 10).toString();
  else if (endNumMatch) lastVol = parseInt(endNumMatch[1], 10).toString();

  const dateString = new Date().toISOString(); 

  pendingTasks.push({
      cleanTitle, resolution, lastVol, type, dateString, tabId: tab?.id
  });

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(processSaveQueue, 10);
});

function processSaveQueue() {
    if (pendingTasks.length === 0) return;
    if (isSaving) {
        setTimeout(processSaveQueue, 10); 
        return;
    }
    
    isSaving = true;
    const tasks = [...pendingTasks]; 
    pendingTasks = []; 

    chrome.storage.local.get({ bookList: [] }, (data) => {
        let list = Array.isArray(data.bookList) ? data.bookList : [];
        
        let hashMap = new Map();
        for (let i = 0; i < list.length; i++) {
            const t = (list[i].title || "").replace(/\s+/g, '').toLowerCase();
            hashMap.set(t, i);
        }

        let lastSavedBook = null;
        let targetTabId = null;

        for (let task of tasks) {
            const targetTitleStr = task.cleanTitle.replace(/\s+/g, '').toLowerCase();
            let existingIndex = -1;

            if (hashMap.has(targetTitleStr)) {
                existingIndex = hashMap.get(targetTitleStr);
            } else {
                existingIndex = list.findIndex(b => {
                    const bTitle = (b.title || "").replace(/\s+/g, '').toLowerCase();
                    return targetTitleStr === bTitle;
                });
            }

            if (existingIndex > -1) {
                list[existingIndex].lastVol = task.lastVol || list[existingIndex].lastVol;
                list[existingIndex].resolution = task.resolution || list[existingIndex].resolution;
                list[existingIndex].type = task.type; 
                list[existingIndex].date = task.dateString; 
                lastSavedBook = list[existingIndex]; 
            } else {
                lastSavedBook = { 
                    id: Date.now() + Math.random(), 
                    title: task.cleanTitle, 
                    type: task.type, 
                    resolution: task.resolution, 
                    lastVol: task.lastVol, 
                    date: task.dateString 
                };
                list.push(lastSavedBook);
                hashMap.set(targetTitleStr, list.length - 1);
            }
            if (task.tabId) targetTabId = task.tabId;
        }
        
        chrome.storage.local.set({ bookList: list }, () => {
            isSaving = false;

            if (targetTabId && lastSavedBook) {
                let msgBook = { ...lastSavedBook }; 
                if (tasks.length > 1) {
                    msgBook.title = "[총 " + tasks.length + "건 연속 처리] " + msgBook.title;
                }
                chrome.tabs.sendMessage(targetTabId, { action: "SHOW_TOAST", book: msgBook }).catch(() => {});
            }
            
            if (pendingTasks.length > 0) processSaveQueue();
        });
    });
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

// 💡 [수정] 다운로드가 끝났을 때 메모리 누수 방지를 위해 제목 맵핑 데이터(downloadTitlesMap) 삭제
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
        delete downloadTitlesMap[delta.id]; // 메모리 정리
        startProgressBroadcasting();
    }
});

// 💡 [신규] 브라우저가 파일 이름을 결정하기 직전에 가로채서 폴더 경로를 씌워줍니다.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    chrome.storage.local.get({ autoFolder: true }, (data) => {
        if (data.autoFolder !== false && downloadTitlesMap[item.id]) {
            let safeTitle = downloadTitlesMap[item.id].replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
            if (safeTitle) {
                // "책제목/원래파일명" 형태로 제안하면 크롬이 자동으로 폴더를 생성합니다.
                suggest({ filename: safeTitle + "/" + item.filename, conflictAction: "uniquify" });
                return;
            }
        }
        suggest(); // 조건에 안 맞으면 기본 저장 방식 따름
    });
    return true; // 비동기 suggest 호출을 위해 필수
});