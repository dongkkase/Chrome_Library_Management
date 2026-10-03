import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowedArgs = new Set(['--client-id', '--output', '--target', '--public-key-file']);
const options = {};
for (let index = 0; index < args.length; index += 2) {
    if (!allowedArgs.has(args[index]) || Object.hasOwn(options, args[index])
        || !args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error('사용법: node scripts/package-extension.mjs --client-id GOOGLE_CLIENT_ID [--target store|manual] [--public-key-file /path/public-key.pem] [--output /path/extension.zip]');
    }
    options[args[index]] = args[index + 1];
}
const clientId = options['--client-id'];
if (!/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId || '')) {
    throw new Error('Chrome 확장 프로그램용 Google OAuth 클라이언트 ID가 필요합니다.');
}
const target = options['--target'] || 'store';
if (!['store', 'manual'].includes(target)) {
    throw new Error('--target은 store 또는 manual이어야 합니다.');
}
if (target === 'store' && options['--public-key-file']) {
    throw new Error('--public-key-file은 --target manual에서만 사용할 수 있습니다.');
}
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
manifest.oauth2 = {
    client_id: clientId,
    scopes: ['https://www.googleapis.com/auth/drive.appdata']
};
if (target === 'manual') {
    const keyText = options['--public-key-file']
        ? readFileSync(path.resolve(options['--public-key-file']), 'utf8') : manifest.key;
    if (typeof keyText !== 'string' || !keyText.trim()) {
        throw new Error('직접 설치용 패키지에는 웹스토어 공개 키가 필요합니다. --public-key-file로 공개 키 파일을 지정해 주세요.');
    }
    if (/PRIVATE KEY/.test(keyText)) {
        throw new Error('개인 키는 사용할 수 없습니다. 웹스토어의 공개 키를 지정해 주세요.');
    }
    let publicKey;
    try {
        const pem = keyText.trim().match(/^-----BEGIN PUBLIC KEY-----\s+([\s\S]+?)\s+-----END PUBLIC KEY-----$/);
        const base64 = (pem ? pem[1] : keyText).replace(/\s/g, '');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Invalid base64');
        const der = Buffer.from(base64, 'base64');
        if (der.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) {
            throw new Error('Invalid base64');
        }
        publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' })
            .export({ format: 'der', type: 'spki' });
    } catch (_) {
        throw new Error('공개 키 형식이 올바르지 않습니다. PEM PUBLIC KEY 또는 Base64 DER SPKI 공개 키를 사용해 주세요.');
    }
    const storeId = readFileSync(path.join(root, 'google-sync.js'), 'utf8')
        .match(/\bconst\s+STORE_ID\s*=\s*['"]([a-p]{32})['"]/)?.[1];
    if (!storeId) throw new Error('Google 동기화의 웹스토어 확장 프로그램 ID를 확인할 수 없습니다.');
    const extensionId = createHash('sha256').update(publicKey).digest().subarray(0, 16)
        .toString('hex').replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
    if (extensionId !== storeId) {
        throw new Error('공개 키의 확장 프로그램 ID가 웹스토어 ID와 일치하지 않습니다.');
    }
    manifest.key = publicKey.toString('base64');
    delete manifest.update_url;
} else {
    manifest.update_url = 'https://clients2.google.com/service/update2/crx';
}
const filename = target === 'manual' ? 'libmanagement-manual.zip' : 'libmanagement.zip';
const output = path.resolve(options['--output'] || path.join(root, filename));
if (existsSync(output)) throw new Error(`기존 파일을 덮어쓸 수 없습니다. 다른 출력 경로를 지정해 주세요: ${output}`);
const stage = mkdtempSync(path.join(tmpdir(), 'book-manager-release-'));
const files = [
    'db.js', 'dexie.min.js', 'background.js', 'common.js', 'content.js',
    'google-drive.js', 'google-sync.js', 'google-sync-ui.js', 'download-book-update.js',
    'book-ui.js', 'book-ui.css', 'book-shortcuts.js', 'icon.png', 'manifest.json',
    'options.html', 'options.css', 'options.js', 'help.html', 'help.css',
    'help.js', 'images', 'author.json'
];
try {
    for (const file of files) cpSync(path.join(root, file), path.join(stage, file), { recursive: true });
    writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`);
    execFileSync('zip', ['-q', '-r', output, ...files], { cwd: stage, stdio: 'inherit' });
    process.stdout.write(`${target === 'manual' ? '직접 설치용' : '웹스토어'} 배포 파일: ${output}\n`);
} finally {
    rmSync(stage, { recursive: true, force: true });
}
