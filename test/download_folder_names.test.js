const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sources = Object.fromEntries(['content.js', 'background.js', 'options.js']
    .map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));

function extractFunction(file, name) {
    const source = sources[file];
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${file}: ${name}`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}') depth--;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`${file}: ${name} 함수의 끝을 찾을 수 없습니다.`);
}

function loadFunctions(file, names, context = {}) {
    return vm.runInNewContext(`
        ${names.map(name => extractFunction(file, name)).join('\n')}
        ({ ${names.join(', ')} });
    `, context);
}

for (const [file, name] of [
    ['content.js', 'sanitizeDownloadFolderSegment'],
    ['background.js', 'sanitizeDownloadFolderSegment'],
    ['options.js', 'sanitizeFolderRulePreviewSegment']
]) {
    test(`${file}: 폴더 이름 끝의 마침표와 공백을 제거하고 내부 마침표는 유지한다`, () => {
        const sanitize = loadFunctions(file, [name])[name];
        const cases = [
            ['예시 도서.', '예시 도서'],
            [' 예시 도서...  ', '예시 도서'],
            ['예시 도서 . \t.\n', '예시 도서'],
            ['예시 도서.:*?', '예시 도서'],
            ['.hack Vol.1. 완결.', '.hack Vol.1. 완결'],
            ['예시 도서…', '예시 도서…'],
            ['예시: 도서 / 제목', '예시 도서 제목'],
            ['. .. \t.', ''],
            ['', ''],
            [null, '']
        ];
        for (const [input, expected] of cases) {
            assert.equal(sanitize(input), expected, String(input));
        }
    });
}

test('다운로드 폴더는 제목과 각 상위 폴더 끝의 마침표를 제거한다', () => {
    const { buildDownloadFolder } = loadFunctions('content.js', [
        'sanitizeDownloadFolderSegment', 'buildDownloadFolder'
    ]);
    assert.equal(buildDownloadFolder('만화. / 연재..\\Vol.1. ', '(미완)예시 도서...'),
        '만화/연재/Vol.1/(미완)예시 도서');
    assert.equal(buildDownloadFolder('', '예시 도서.'), '예시 도서');
    assert.equal(buildDownloadFolder('./ .. / . ', '예시 도서.'), '예시 도서');
    assert.equal(buildDownloadFolder('만화.', '...'), '만화');
    assert.equal(buildDownloadFolder('', '...'), '');
});

test('백그라운드는 이전에 저장한 경로도 폴더마다 정리하고 빈 경로 요소를 제외한다', () => {
    const { sanitizeDownloadFolderPath } = loadFunctions('background.js', [
        'sanitizeDownloadFolderSegment', 'sanitizeDownloadFolderPath'
    ]);
    assert.equal(sanitizeDownloadFolderPath('만화.\\연재. .\\(미완)예시 도서...'),
        '만화/연재/(미완)예시 도서');
    assert.equal(sanitizeDownloadFolderPath('./../만화.:/예시 도서.'), '만화/예시 도서');
    assert.equal(sanitizeDownloadFolderPath('. / .. / '), '');
});

test('폴더 규칙 미리보기는 실제 다운로드 경로와 같은 이름을 표시한다', () => {
    const { getFolderRulePreviewData } = loadFunctions('options.js', [
        'sanitizeFolderRulePreviewSegment', 'getFolderRulePreviewData'
    ]);
    const data = getFolderRulePreviewData({
        value: '만화. / .. / 연재. .',
        closest: () => ({ querySelector: () => ({ value: '예시 도서...' }) })
    });
    assert.equal(data.title, '예시 도서');
    assert.deepEqual(Array.from(data.ruleSegments), ['만화', '연재']);
    assert.equal(data.usesPlaceholder, false);
});

test('다운로드 파일명 제안은 정리된 폴더를 사용하고 파일명과 확장자는 유지한다', () => {
    const source = sources['background.js'];
    const start = source.indexOf('const dynamicFolderListener =');
    const end = source.indexOf('// 1.', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const listener = vm.runInNewContext(`
        ${extractFunction('background.js', 'sanitizeDownloadFolderSegment')}
        ${extractFunction('background.js', 'sanitizeDownloadFolderPath')}
        ${source.slice(start, end)}
        dynamicFolderListener;
    `, {
        downloadTitlesMap: { 42: '만화./예시 도서...' },
        expectedDownloadFolder: '(미완)다른 도서. ',
        chrome: { storage: { local: { get: (_defaults, callback) => callback({ autoFolder: true }) } } }
    });
    for (const [id, expectedFolder] of [[42, '만화/예시 도서'], [43, '(미완)다른 도서']]) {
        let suggestion;
        const result = listener({ id, filename: 'Vol.1.archive.zip' }, value => { suggestion = value; });
        assert.equal(result, true);
        assert.equal(suggestion.filename, `${expectedFolder}/Vol.1.archive.zip`);
        assert.equal(suggestion.conflictAction, 'uniquify');
    }
});
