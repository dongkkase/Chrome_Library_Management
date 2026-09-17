const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const optionsHtml = fs.readFileSync(path.join(projectRoot, 'options.html'), 'utf8');
const optionsScript = fs.readFileSync(path.join(projectRoot, 'options.js'), 'utf8');
const optionsCss = fs.readFileSync(path.join(projectRoot, 'options.css'), 'utf8');

test('일반 옵션창과 슬라이드 패널은 동일한 사이드 패널 레이아웃을 사용한다', () => {
    assert.match(optionsHtml, /<body class="side-panel-mode">/);
    assert.doesNotMatch(optionsScript, /window\.location\.hash === '#sidepanel'/);
    assert.doesNotMatch(optionsScript, /classList\.toggle\('compact-list-mode'/);
});

test('일반 옵션창은 630px 너비를 사용하고 슬라이드 패널은 가용 너비를 유지한다', () => {
    assert.match(
        optionsScript,
        /classList\.toggle\('options-window-mode', window\.location\.hash !== '#sidepanel'\)/,
    );
    assert.match(
        optionsCss,
        /body\.side-panel-mode\.options-window-mode\s*\{[^}]*width:\s*630px;[^}]*min-width:\s*630px;/,
    );
});
