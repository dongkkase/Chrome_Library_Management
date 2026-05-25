// db.js
var db = new Dexie('BookManagerDB');

// 버전을 4로 올려 자동 백업을 위한 스냅샷 테이블을 추가합니다.
db.version(4).stores({
    books: '++id, &cleanTitleStr, title, type, resolution, lastVol, date',
    snapshots: '++id, timestamp, dateStr'
});