const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const contentPath = path.join(__dirname, '..', 'content.js');
const contentSource = fs.readFileSync(contentPath, 'utf8');

function extractFunction(name) {
    const signature = `function ${name}(`;
    const start = contentSource.indexOf(signature);
    assert.notEqual(start, -1, `${name} 함수를 찾을 수 없습니다.`);

    const bodyStart = contentSource.indexOf('{', start);
    let depth = 0;

    for (let index = bodyStart; index < contentSource.length; index++) {
        if (contentSource[index] === '{') depth++;
        if (contentSource[index] === '}') depth--;
        if (depth === 0) return contentSource.slice(start, index + 1);
    }

    throw new Error(`${name} 함수의 끝을 찾을 수 없습니다.`);
}

function createDownloadUIHarness(initialEnabled = false) {
    const overlay = { style: { display: 'flex' } };
    const updateCalls = [];
    const context = {
        document: {
            getElementById: () => overlay
        },
        updateDownloadUI: (downloads) => updateCalls.push(downloads)
    };
    const setDownloadUIEnabled = extractFunction('setDownloadUIEnabled');
    const handleDownloadProgress = extractFunction('handleDownloadProgress');
    const script = `
        let isDownloadUIEnabled = ${initialEnabled};
        ${setDownloadUIEnabled}
        ${handleDownloadProgress}
        ({ setDownloadUIEnabled, handleDownloadProgress });
    `;
    const api = vm.runInNewContext(script, context);

    return { api, overlay, updateCalls };
}

test('설정을 읽기 전에는 다운로드 현황판을 비활성 상태로 시작한다', () => {
    const initialState = contentSource.match(/let isDownloadUIEnabled = (true|false);/);

    assert.ok(initialState);
    assert.equal(initialState[1], 'false');
});

test('다운로드 UI 설정을 다른 데이터 준비와 분리해 즉시 읽는다', () => {
    assert.match(
        contentSource,
        /safeStorageGet\(\{ showDownloadUI: true \}, \(data\) => \{\s*setDownloadUIEnabled\(data\.showDownloadUI !== false\);\s*\}\);/
    );
});

test('표시 중 설정을 끄면 기존 다운로드 현황판을 즉시 숨긴다', () => {
    const { api, overlay } = createDownloadUIHarness(true);

    api.setDownloadUIEnabled(false);

    assert.equal(overlay.style.display, 'none');
});

test('설정이 꺼져 있으면 다운로드 진행 이벤트도 빈 상태로 처리한다', () => {
    const { api, updateCalls } = createDownloadUIHarness(false);

    api.handleDownloadProgress([{ id: 1, filename: 'book.zip' }]);

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].length, 0);
});

test('설정이 켜져 있으면 다운로드 진행 데이터를 그대로 표시한다', () => {
    const { api, updateCalls } = createDownloadUIHarness(false);
    const downloads = [{ id: 1, filename: 'book.zip' }];

    api.setDownloadUIEnabled(true);
    api.handleDownloadProgress(downloads);

    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0], downloads);
});

test('다운로드 진행 메시지를 설정 상태 처리 함수로 전달한다', () => {
    assert.match(
        contentSource,
        /request\.action === "UPDATE_DOWNLOAD_PROGRESS"\) \{\s*handleDownloadProgress\(request\.downloads\);/
    );
});

test('스토리지 설정 변경을 즉시 다운로드 UI 상태에 반영한다', () => {
    assert.match(
        contentSource,
        /if \(changes\.showDownloadUI\) \{\s*setDownloadUIEnabled\(changes\.showDownloadUI\.newValue !== false\);\s*\}/
    );
});
