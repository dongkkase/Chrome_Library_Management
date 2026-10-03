const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, generateKeyPairSync } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const sourceScript = path.join(__dirname, '..', 'scripts', 'package-extension.mjs');
const clientId = '123456789-release_client.apps.googleusercontent.com';
const storeId = 'kjfmielegfhljmjjmhjmidlfdponknpm';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicDer = publicKey.export({ format: 'der', type: 'spki' });
const publicBase64 = publicDer.toString('base64');
const publicPem = publicKey.export({ format: 'pem', type: 'spki' });
const testExtensionId = Array.from(createHash('sha256').update(publicDer).digest().subarray(0, 16))
    .map(value => String.fromCharCode(97 + (value >> 4), 97 + (value & 15))).join('');
const packageFiles = [
    'db.js', 'dexie.min.js', 'background.js', 'common.js', 'content.js',
    'google-drive.js', 'google-sync.js', 'google-sync-ui.js', 'download-book-update.js',
    'book-ui.js', 'book-ui.css', 'book-shortcuts.js', 'icon.png', 'manifest.json',
    'options.html', 'options.css', 'options.js', 'help.html', 'help.css',
    'help.js', 'author.json'
];

function fixture(t, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'book-manager-package-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const root = path.join(directory, 'source');
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'images'));
    const script = path.join(root, 'scripts', 'package-extension.mjs');
    fs.copyFileSync(sourceScript, script);
    for (const file of packageFiles) fs.writeFileSync(path.join(root, file), `fixture: ${file}\n`);
    fs.writeFileSync(path.join(root, 'images', 'fixture.png'), 'fixture image');
    const manifest = JSON.stringify({
        manifest_version: 3,
        name: 'Package fixture',
        version: '1.0.0',
        update_url: 'https://clients2.google.com/service/update2/crx',
        ...options.manifest
    }, null, 4);
    fs.writeFileSync(path.join(root, 'manifest.json'), manifest);
    const syncSource = `const STORE_ID = '${options.extensionId || storeId}';\n`;
    fs.writeFileSync(path.join(root, 'google-sync.js'), syncSource);
    const keyFile = path.join(root, 'public-key.pem');
    if (options.key !== undefined) fs.writeFileSync(keyFile, options.key);
    return { root, script, manifest, syncSource, keyFile, output: path.join(directory, 'release.zip') };
}

function runPackage(input, args = [], defaults = true) {
    return spawnSync(process.execPath, [
        input.script,
        ...(defaults ? ['--client-id', clientId, '--output', input.output] : []),
        ...args
    ], { encoding: 'utf8', cwd: input.root });
}

function packagedManifest(input) {
    return JSON.parse(execFileSync('unzip', ['-p', input.output, 'manifest.json'], { encoding: 'utf8' }));
}

function assertSourceUntouched(input) {
    assert.equal(fs.readFileSync(path.join(input.root, 'manifest.json'), 'utf8'), input.manifest);
    assert.equal(fs.readFileSync(path.join(input.root, 'google-sync.js'), 'utf8'), input.syncSource);
}

function assertFailed(input, result, message) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(fs.existsSync(input.output), false);
    assertSourceUntouched(input);
}

test('기본 웹스토어 패키징은 OAuth와 업데이트 주소를 설정하고 원본을 보존한다', t => {
    const input = fixture(t);
    const result = runPackage(input);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /웹스토어 배포 파일:/);
    const manifest = packagedManifest(input);
    assert.equal(manifest.update_url, 'https://clients2.google.com/service/update2/crx');
    assert.equal(manifest.key, undefined);
    assert.deepEqual(manifest.oauth2, {
        client_id: clientId,
        scopes: ['https://www.googleapis.com/auth/drive.appdata']
    });
    assertSourceUntouched(input);
});

test('직접 설치 패키지는 검증된 PEM 공개 키를 포함하고 웹스토어 업데이트 주소를 제거한다', t => {
    const input = fixture(t, { extensionId: testExtensionId, key: publicPem });
    const result = runPackage(input, ['--target', 'manual', '--public-key-file', input.keyFile]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /직접 설치용 배포 파일:/);
    const manifest = packagedManifest(input);
    assert.equal(manifest.key, publicBase64);
    assert.equal(manifest.update_url, undefined);
    assert.equal(manifest.oauth2.client_id, clientId);
    const entries = execFileSync('unzip', ['-Z1', input.output], { encoding: 'utf8' }).split('\n');
    assert.ok(entries.includes('images/fixture.png'));
    assert.ok(entries.includes('book-shortcuts.js'));
    assert.ok(entries.includes('download-book-update.js'));
    assert.ok(!entries.includes('public-key.pem'));
    assert.ok(!entries.includes('scripts/package-extension.mjs'));
    assert.equal(fs.readFileSync(input.keyFile, 'utf8'), publicPem);
    assertSourceUntouched(input);
});

test('직접 설치 패키지는 Base64 DER 공개 키 파일과 기존 manifest 키를 지원한다', async t => {
    for (const fromManifest of [false, true]) {
        await t.test(fromManifest ? 'manifest key' : 'Base64 DER key file', subtest => {
            const input = fixture(subtest, {
                extensionId: testExtensionId,
                ...(fromManifest ? { manifest: { key: publicBase64 } } : { key: `\n${publicBase64}\n` })
            });
            const result = runPackage(input, [
                '--target', 'manual',
                ...(fromManifest ? [] : ['--public-key-file', input.keyFile])
            ]);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(packagedManifest(input).key, publicBase64);
            assertSourceUntouched(input);
        });
    }
});

test('직접 설치 패키지의 기본 파일명은 웹스토어 패키지와 구분된다', t => {
    const input = fixture(t, { extensionId: testExtensionId, manifest: { key: publicBase64 } });
    const result = runPackage(input, ['--client-id', clientId, '--target', 'manual'], false);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(input.root, 'libmanagement-manual.zip')));
    assert.equal(fs.existsSync(path.join(input.root, 'libmanagement.zip')), false);
    assertSourceUntouched(input);
});

test('직접 설치 패키징은 공개 키가 없으면 중단한다', t => {
    const input = fixture(t);
    assertFailed(input, runPackage(input, ['--target', 'manual']), /웹스토어 공개 키가 필요합니다/);
});

test('다른 확장 프로그램의 공개 키로는 직접 설치 패키지를 만들지 않는다', t => {
    const input = fixture(t, { key: publicPem });
    assertFailed(input, runPackage(input, ['--target', 'manual', '--public-key-file', input.keyFile]),
        /웹스토어 ID와 일치하지 않습니다/);
});

test('개인 키를 거부하고 오류 출력에 키 내용을 노출하지 않는다', t => {
    const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' });
    const input = fixture(t, { key: privatePem });
    const result = runPackage(input, ['--target', 'manual', '--public-key-file', input.keyFile]);
    assertFailed(input, result, /개인 키는 사용할 수 없습니다/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(privatePem.split('\n')[1]));
});

test('잘못된 공개 키 형식과 누락된 동기화 ID는 패키징 전에 거부한다', async t => {
    await t.test('invalid public key', subtest => {
        const input = fixture(subtest, { key: 'not-a-public-key' });
        assertFailed(input, runPackage(input, ['--target', 'manual', '--public-key-file', input.keyFile]),
            /공개 키 형식이 올바르지 않습니다/);
    });
    await t.test('missing extension id', subtest => {
        const input = fixture(subtest, { key: publicPem });
        input.syncSource = 'const UNRELATED_ID = "invalid";\n';
        fs.writeFileSync(path.join(input.root, 'google-sync.js'), input.syncSource);
        assertFailed(input, runPackage(input, ['--target', 'manual', '--public-key-file', input.keyFile]),
            /웹스토어 확장 프로그램 ID를 확인할 수 없습니다/);
    });
});

test('패키징 인수와 OAuth 클라이언트 ID를 검증한다', async t => {
    const cases = [
        { args: ['--target', 'other'], message: /store 또는 manual/ },
        { args: ['--target'], message: /사용법:/ },
        { args: ['--target', 'store', '--target', 'manual'], message: /사용법:/ },
        { args: ['--unknown', 'value'], message: /사용법:/ },
        { args: ['--public-key-file', 'key.pem'], message: /--target manual에서만/ },
        { args: [], defaults: false, message: /OAuth 클라이언트 ID가 필요합니다/ },
        { args: ['--client-id', 'invalid'], defaults: false, message: /OAuth 클라이언트 ID가 필요합니다/ }
    ];
    for (const entry of cases) {
        await t.test(entry.args.join(' ') || 'missing client id', subtest => {
            const input = fixture(subtest);
            assertFailed(input, runPackage(input, entry.args, entry.defaults !== false), entry.message);
        });
    }
});

test('기존 출력 파일을 덮어쓰지 않는다', t => {
    const input = fixture(t);
    fs.writeFileSync(input.output, 'previous release');
    const result = runPackage(input);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /기존 파일을 덮어쓸 수 없습니다/);
    assert.equal(fs.readFileSync(input.output, 'utf8'), 'previous release');
    assertSourceUntouched(input);
});
