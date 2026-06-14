// common.js (공통 정규식 관리 파일)
let globalFilters = [
    "_", "__", "=", "❤️",  "⭐", "한방팩", "묶음팩", "[완결]", "직작 |", 
    "상/하권", "상,하권", "상-하권", "상~하", "상,하", "상/하", 
    "[미완결]", "[미완]", "(미완결)", "(미완)",
    "(지원사격)", "지원사격)", "(지원)", "지원)", "[지원]", "지원]", "지원 -", "Web툰", "(웹툰)", "( 웹툰)", " 웹툰)", "웹툰)", "웹툰",
    "(신작완결)", "19禁완)", "(완결)", "완결)", "완결]", "★★★★신작완결)", "(최신완결)", "최신완결)", 
    "Ebook 본", "ㅂ",
    // "", "", "", "", "", "", "", "", "", "",
    // "", "", "", "", "", "", "", "", "", "",
    "✅"
];
// [신규 추가] 사용자 정의 필터링(금지어) 단어를 저장할 전역 변수
const defaultCustomFilters = [
    " 작가",
    "신카이마코토", "김성모", "이현세", "미우라 미츠루", "신형빈", "켄타로", "이토 준지", "하라 히데노리", "토리야마 아키라", "히라마츠 신지",
    "이즈키 케이고", "와카스키 키미노리", "카와다 히로시", "미즈키 시게루", "오오이시 마사루", "와나타베 준", "토아루 앙라코", "요시나가 후미", "이시다 이라", "모리 카오루",
    "코이케 카즈오", "강격옥", "고선영", "나카가키 토모에", "나나난 키리코", "시즈미 레이코", "시미즈 레이코", "오카다 유키오", "카와사키 미에코", "판판야",
    "이케자와 사토미", "장태산", "임재원", "라가와 마리모", "혼마리 우", "오오시마 타케시", "타카하시 루미코", "후지사키 류", "다카하시 루미코", "아다치 미츠루",
    "아마즈메 류타", "카와시타 미즈키", "미우라 히로코", "니헤이 츠토무", "환댕", "데즈카 오사무", "테즈카 오사무", "무라오 미오",
    "츠치다 세이키", "오바타 후미오", "이시카와 유고", "아카이시 미치요", "미츠보시 타마"
];

let globalCustomFilters = [...defaultCustomFilters];

// 크롬 스토리지에서 필터링 단어를 비동기적으로 불러와 자체 캐싱해둡니다.
// (content.js나 background.js를 수정하지 않고도 여기서 스스로 작동하도록 설계됨)
if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get({ filterWords: [] }, (data) => {
        const userFilters = Array.isArray(data.filterWords) ? data.filterWords : [];
        globalCustomFilters = [...defaultCustomFilters, ...userFilters];
    });
    // 옵션창에서 단어가 추가/삭제되면 즉시 캐시를 업데이트합니다.
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.filterWords) {
            const userFilters = changes.filterWords.newValue || [];
            globalCustomFilters = [...defaultCustomFilters, ...userFilters];
        }
    });
}

// [신규 추가] 의미 없는 댓글 판별 키워드 및 함수
const uselessCommentKeywords = [
    "감사합니다", "고맙습니다", "감사", "수고", "잘볼게요", "잘볼께요", 
    "잘보겠습니다", "ㄱㅅ", "ㄳ", "감사요", "감솨", "수고하셨습니다", "수고하세요",
    "잘봤습니다", "잘봤어요", "감사합니당", '소중한 자료 감사합니다', '잘받겟습니다', '잘받았습니다',
    '확인했습니다', '확인', '학인했어요', '잘받앗습니다', '잘받앗어요'
];

function isUselessComment(text) {
    if (!text) return false;
    let cleanText = text.replace(/<[^>]+>/g, '').replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, '');
    if (cleanText.length === 0 || cleanText.length > 20) return false; // 너무 길면 정상 댓글로 간주
    
    return uselessCommentKeywords.some(kw => cleanText.includes(kw.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9]/g, '')));
}

function cleanSiteTitle(title) {
  if (!title) return "";
  
  // 👻 눈에 보이지 않는 유령 공백(Zero-Width Space) 완전히 분쇄
  let cleaned = title.replace(/[\u200B-\u200F\uFEFF\u202A-\u202E\u2060]/g, '');
  

  
  if (globalFilters && globalFilters.length > 0) {
      const sortedFilters = [...globalFilters].sort((a, b) => b.length - a.length);
      
      sortedFilters.forEach(word => {
          const trimWord = word.trim();
          if (['~', '-', '～', '〜', '〰', '∼', '–', '—', '_', '__'].includes(trimWord)) return;

          const safeWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(safeWord, 'gi');
          cleaned = cleaned.replace(regex, ' ');
      });
  }

  // 0️⃣ [최우선 적용] 사용자가 등록한 금지어를 가장 먼저 삭제합니다.
  if (globalCustomFilters && globalCustomFilters.length > 0) {
      const sortedFilters = [...globalCustomFilters].sort((a, b) => b.length - a.length);
      
      sortedFilters.forEach(word => {
          const trimWord = word.trim();
          if (['~', '-', '～', '〜', '〰', '∼', '–', '—', '_', '__'].includes(trimWord)) return;

          const safeWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(safeWord, 'gi');
          cleaned = cleaned.replace(regex, ' ');
      });
  }

  // 꼬리표 및 찌꺼기 먼저 제거 
  cleaned = cleaned
    .replace(/<[!]--[\s\S]*?-->/g, '')
    .replace(/<(?:span|div|i)\s+class="(?:count|comment-badge|fa-comment)[^"]*">[\s\S]*?<\/(?:span|div|i)>/g, '')
    .replace(/댓글\s*[+\d]*개?/gi, '')
    .replace(/\+\s*\d+\s*$/g, '') 
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g, '')
    .replace(/업로드\s*$/g, '') 
    .replace(/^\s*\[?웹툰\]?\s*/, ''); 

  cleaned = cleaned.replace(/(?:\s|^)[가-힣a-zA-Z]+\s+(?:그림|글)(?=\s|$)|(?:\s|^)[가-힣a-zA-Z]+\s*(?:원작|지음|작화|번역)(?=\s|$)/g, ' ');

  // 해상도, 권수 등을 구분자로 삼아 그 뒤를 잘라냄
  // [핵심 수정] 정규식에서 '부'를 구분자로 자르지 않도록 부(?!터) 구문을 제거했습니다.
  const delimiterRegex = /(\d{3,4}\s*p(?:x)?|\d+\s*(?:권|화)?\s*[\~\-～〜〰∼–—_,\/&・·･]\s*\d+|\d+\s*(?:권|화|화씩)|완결|\s완(\s|$))/i;
  const match = cleaned.match(delimiterRegex);
  
  if (match && match.index > 0) {
      cleaned = cleaned.substring(0, match.index);
  }

  console.log('cleaned:', cleaned);
  // 나머지 태그 및 불필요한 단어 제거 후 최종 다듬기
  return cleaned
    .replace(/\[전/gi, '')
    .replace(/e-?book|e북|完/gi, '')
    .replace(/지원\s사격|지원사격/g, '')
    .replace(/완결은\s무료/g, '')
    .replace(/\s외\s\d+편/g, '')
    .replace(/\(19 웹툰\)|\(19\+\)|19\+\)|19\)|19금|19\+|15\+\)|15\)|15금|15\+|N새글|고화질|저화질|무료|워터마크없음|워터마크|고화질판|저화질판|단권|연재본|화질보정|확인불가/g, '')
    .replace(/스캔 단면|스캔단면|스캔 양면|스캔양면|스캔본|스캔판/g, '')
    .replace(/단편 만화|단편만화|단편집|단편|단행본/g, '')
    .replace(/권\~/gi, '')
    .replace(/[\[\(].*?[\]\)]/g, ' ') 
    .replace(/\d{3,4}\s*p(?:x)?/gi, ' ')
    .replace(/\d+\s*[\~\-～〜〰∼–—_,\/&・·･]\s*\d+/g, ' ') 
    .replace(/[：:—\-\/～〜〰∼~・·･_]/g, ' ') 
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