const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ui = vm.runInNewContext(fs.readFileSync(path.join(root, 'book-ui.js'), 'utf8') + '\nBookMatchUI;');
const owned = (type, extra = {}) => ({ title: '예시 도서', type, resolution: '1500px', lastVol: '3', missingVols: [], ...extra });

function hide(book, settings, extra = {}) {
    return ui.shouldHidePost({ book, siteRes: 1500, siteVol: 3, score: 100, ...extra }, settings);
}

test('제외 숨김은 원래 매칭률이 95%를 초과할 때만 적용한다', () => {
    assert.equal(hide(owned('exclude'), { hideExclude: true }, { score: 95 }), false);
    assert.equal(hide(owned('exclude'), { hideExclude: true }, { score: 95.1 }), true);
    assert.equal(hide(owned('exclude'), { hideExclude: true }, { score: 94 }), false);
    assert.equal(hide(owned('exclude', { missingVols: [2] }), { hideExclude: true }, { siteRes: 2000, siteVol: 5 }), true);
});

test('미완·완결 숨김은 업그레이드나 누락이 있으면 해제되며 미등록값은 업그레이드로 취급하지 않는다', () => {
    for (const [type, key] of [['incomplete', 'hideIncomplete'], ['complete', 'hideComplete']]) {
        assert.equal(hide(owned(type), { [key]: true }), true);
        assert.equal(hide(owned(type), { [key]: true }, { siteVol: 5 }), false);
        assert.equal(hide(owned(type), { [key]: true }, { siteRes: 2000 }), false);
        assert.equal(hide(owned(type, { missingVols: [2] }), { [key]: true }), false);
        assert.equal(hide(owned(type, { resolution: '', lastVol: '' }), { [key]: true }), true);
    }
});

test('신작·번역 숨김과 사이트별 번역 우선 적용을 유지한다', () => {
    assert.equal(hide(null, { hideNew: true }), true);
    assert.equal(hide(null, { hideTranslate: true }), false);
    assert.equal(hide(null, { hideTranslate: true }, { translated: true }), true);
    assert.equal(hide(owned('complete'), { hideTranslate: true }, { translated: true, siteVol: 5 }), false);
    assert.equal(hide(owned('complete'), { hideTranslate: true }, { translated: true, siteVol: 5, forceTranslationHide: true }), true);
    assert.equal(hide(owned('exclude'), { hideTranslate: true }, { translated: true, score: 94 }), true);
});

test('완결 도서의 업그레이드는 주황 배지와 노란 UP·그림자로 표시한다', () => {
    const normal = ui.getPresentation(owned('complete'), 1500, 3);
    const upgraded = ui.getPresentation(owned('complete'), 2000, 3);
    assert.match(normal.style, /background:#f0f7ff/);
    assert.doesNotMatch(normal.html, />UP</);
    assert.equal(normal.titleStyles.color, '#0056b3');
    assert.match(upgraded.style, /background:#e65100/);
    assert.match(upgraded.style, /box-shadow: 0 0 6px/);
    assert.match(upgraded.html, /1500px <b[^>]+>UP<\/b>/);
    assert.doesNotMatch(upgraded.html, /3권 <b/);
    assert.equal(upgraded.titleStyles.color, '#d9480f');
});

test('목록과 상세는 실제 배지 크기·누락·유사 매칭 표시를 유지한다', () => {
    const book = owned('incomplete', { missingVols: [1, 2] });
    const list = ui.getPresentation(book, 1500, 3, 99.9);
    const detail = ui.getPresentation(book, 1500, 3, 100, true);
    assert.match(list.style, /font-size:10px/);
    assert.match(detail.style, /font-size:11px/);
    assert.match(list.html, /누락:1,2/);
    assert.match(list.html, /유사 99%/);
    assert.match(detail.html, /\(100%\)/);
    const excluded = ui.getPresentation(owned('exclude'), 2000, 5, 100, true);
    assert.equal(excluded.titleStyles['text-decoration'], 'line-through');
    assert.equal(excluded.titleStyles.opacity, '0.5');
    assert.doesNotMatch(excluded.html, />UP</);
});

test('사용자 입력이 포함된 배지와 누락 팝오버는 HTML을 실행하지 않는다', () => {
    const book = owned('complete', { title: '<img src=x onerror=alert(1)>', resolution: '<img src=x>', lastVol: '3' });
    assert.doesNotMatch(ui.getPresentation(book, 0, 3).html, /<img/);
    const popover = ui.missingPopoverHtml(book);
    assert.doesNotMatch(popover, /<img/);
    assert.match(popover, /&lt;img/);
    assert.equal((popover.match(/data-vol=/g) || []).length, 3);
});

test('콘텐츠 스크립트와 안내 페이지는 같은 UI 리소스를 불러온다', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const entry = manifest.content_scripts.find(item => item.js.includes('content.js'));
    assert.ok(entry.js.indexOf('book-ui.js') < entry.js.indexOf('content.js'));
    assert.ok(entry.css.includes('book-ui.css'));
    const help = fs.readFileSync(path.join(root, 'help.html'), 'utf8');
    assert.ok(help.indexOf('src="book-ui.js"') < help.indexOf('src="help.js"'));
    assert.match(help, /href="book-ui.css"/);
});
