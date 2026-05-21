// db.js
var db = new Dexie('BookManagerDB');

// 인덱스 정의 (id는 자동증가, cleanTitleStr은 중복방지 고유키로 사용)
db.version(1).stores({
    books: '++id, &cleanTitleStr, title, type, resolution, lastVol, date'
});