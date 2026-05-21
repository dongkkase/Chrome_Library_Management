// db.js
var db = new Dexie('BookManagerDB');

// 버전을 3으로 올려 기존 스키마 충돌을 해결하고 데이터베이스 문을 엽니다.
db.version(3).stores({
    books: '++id, &cleanTitleStr, title, type, resolution, lastVol, date'
});