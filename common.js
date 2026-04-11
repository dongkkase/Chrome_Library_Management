// common.js (공통 정규식 관리 파일)

// 💡 [신규 추가] 사용자 정의 필터링(금지어) 단어를 저장할 전역 변수
let globalCustomFilters = [];

// 크롬 스토리지에서 필터링 단어를 비동기적으로 불러와 자체 캐싱해둡니다.
// (content.js나 background.js를 수정하지 않고도 여기서 스스로 작동하도록 설계됨)
if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get({ filterWords: [] }, (data) => {
        globalCustomFilters = Array.isArray(data.filterWords) ? data.filterWords : [];
    });
    // 옵션창에서 단어가 추가/삭제되면 즉시 캐시를 업데이트합니다.
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.filterWords) {
            globalCustomFilters = changes.filterWords.newValue || [];
        }
    });
}

function cleanSiteTitle(title) {
  if (!title) return "";
  
  // 👻 눈에 보이지 않는 유령 공백(Zero-Width Space) 완전히 분쇄
  let cleaned = title.replace(/[\u200B-\u200F\uFEFF\u202A-\u202E\u2060]/g, '');

  // 0️⃣ [최우선 적용] 사용자가 등록한 금지어를 가장 먼저 삭제합니다.
  if (globalCustomFilters && globalCustomFilters.length > 0) {
      const sortedFilters = [...globalCustomFilters].sort((a, b) => b.length - a.length);
      
      sortedFilters.forEach(word => {
          const trimWord = word.trim();
          if (['~', '-', '～', '〜', '〰', '∼', '–', '—'].includes(trimWord)) return;

          const safeWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(safeWord, 'gi');
          cleaned = cleaned.replace(regex, ' ');
      });
  }

  // 1️⃣ 꼬리표 및 찌꺼기 먼저 제거 
  cleaned = cleaned
    .replace(/<[!]--[\s\S]*?-->/g, '')
    .replace(/<(?:span|div|i)\s+class="(?:count|comment-badge|fa-comment)[^"]*">[\s\S]*?<\/(?:span|div|i)>/g, '')
    .replace(/댓글\s*[+\d]*개?/gi, '')
    .replace(/\+\s*\d+\s*$/g, '') 
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g, '')
    .replace(/업로드\s*$/g, '') 
    .replace(/^\s*\[?웹툰\]?\s*/, ''); 

  cleaned = cleaned.replace(/(?:\s|^)[가-힣a-zA-Z]+\s*(?:원작|그림|지음|글|작화|번역)(?=\s|$)/g, ' ');

  // 2️⃣ 해상도, 권수 등을 구분자로 삼아 그 뒤를 잘라냄
  // 💡 [핵심 수정] 정규식에서 '부'를 구분자로 자르지 않도록 부(?!터) 구문을 제거했습니다.
  const delimiterRegex = /(\d{3,4}\s*p(?:x)?|\d+\s*(?:권|화)?\s*[\~\-～〜〰∼–—_,\/&・·･]\s*\d+|\d+\s*(?:권|화|화씩)|완결|\s완(\s|$))/i;
  const match = cleaned.match(delimiterRegex);
  
  if (match && match.index > 0) {
      cleaned = cleaned.substring(0, match.index);
  }

  // 3️⃣ 나머지 태그 및 불필요한 단어 제거 후 최종 다듬기
  return cleaned
    .replace(/e-?book|e북|完/gi, '')
    .replace(/지원\s사격|지원사격/g, '')
    .replace(/완결은\s무료/g, '')
    .replace(/\s외\s\d+편/g, '')
    .replace(/19\+\)|19\)|19금|19\+|15\+\)|15\)|15금|15\+|N새글|고화질|저화질|무료|워터마크없음|워터마크|고화질판|저화질판|단권|연재본|화질보정|확인불가/g, '')
    .replace(/스캔 단면|스캔단면|스캔 양면|스캔양면|스캔본|스캔판/g, '')
    .replace(/단편 만화|단편만화|단편집|단편|단행본/g, '')
    .replace(/권\~/gi, '')
    .replace(/[\[\(].*?[\]\)]/g, ' ') 
    .replace(/\d{3,4}\s*p(?:x)?/gi, ' ')
    .replace(/\d+\s*[\~\-～〜〰∼–—_,\/&・·･]\s*\d+/g, ' ') 
    .replace(/[：:—\-\/～〜〰∼~・·･]/g, ' ') 
    .replace(/\d+\s*(?:권|화)/g, ' ')
    .replace(/완결[!?.~]*/g, ' ')
    .replace(/\s+(완|화|권)[!?.~]*(?=\s|$)/g, ' ')
    .replace(/\<\s\>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\]\s*/, '')
    .replace(/,\s*$/, '')
    // .replace(/\.\s*$/, '')
    .replace(/\(\s*$/, '')
    .replace(/\[\s*$/, '')
    .trim();
}