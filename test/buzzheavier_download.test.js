const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'buzzheavier-download.js'), 'utf8');
const pageUrl = 'https://buzzheavier.com/pk6ep0d4zf24';
const signedEndpoint = '/pk6ep0d4zf24/download?t=fresh-signature';
const signedDownload = 'https://ts.buzzheavier.com/d/pk6ep0d4zf24?v=download-signature';

function harness(options = {}) {
    const requests = [];
    const timers = [];
    const cleared = [];
    let cancelledBodies = 0;
    const response = {
        ok: options.status ? options.status < 400 : true,
        status: options.status || 200,
        headers: new Headers(options.headers || { 'HX-Redirect': signedDownload }),
        body: { async cancel() { cancelledBodies++; } },
        async text() { throw new Error('응답 본문을 읽으면 안 된다.'); },
        async arrayBuffer() { throw new Error('파일을 미리 받으면 안 된다.'); }
    };
    const api = vm.runInNewContext(`${source}\nBuzzheavierDownload;`, {
        URL,
        AbortController,
        location: new URL(options.location || pageUrl),
        document: {
            title: options.title || '파일 다운로드',
            querySelectorAll: () => (options.endpoints || [signedEndpoint]).map(value => ({ getAttribute: () => value })),
            querySelector: () => options.challenge ? {} : null
        },
        setTimeout(callback, duration) { timers.push({ callback, duration }); return timers.length; },
        clearTimeout(id) { cleared.push(id); },
        async fetch(url, init) {
            requests.push({ url, init });
            if (options.timeout) {
                timers[0].callback();
                assert.equal(init.signal.aborted, true);
                throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            }
            if (options.networkError) throw new Error('network unavailable');
            return response;
        }
    });
    return { api, requests, timers, cleared, cancelledBodies: () => cancelledBodies };
}

test('공유 링크는 정확한 호스트와 파일 ID를 검사하고 HTTPS 정식 주소로 정규화한다', () => {
    const { api } = harness();
    for (const value of [pageUrl, `${pageUrl}/?tracking=value#section`, pageUrl.replace('https:', 'http:'),
        pageUrl.replace('buzzheavier.com', 'www.buzzheavier.com'), pageUrl.replace('.com/', '.com:443/')]) {
        assert.equal(api.normalizePageUrl(value), pageUrl);
    }
    for (const value of ['not a URL', 'javascript:alert(1)', pageUrl.replace('.com/', '.com.evil.test/'),
        pageUrl.replace('.com/', '.com:8443/'), pageUrl.replace('://', '://user:password@'),
        `${pageUrl}/download`, `${pageUrl}/extra`, 'https://buzzheavier.com/developers',
        'https://evil.test/?url=' + pageUrl, 'https://buzzheavier.com/pk6ep0d4zf24%2fdownload']) {
        assert.throws(() => api.normalizePageUrl(value), /공유 링크/);
    }
});

test('최종 주소도 HTTPS Buzzheavier 호스트로 제한하고 공유 페이지·외부 주소는 거부한다', () => {
    const { api } = harness();
    assert.equal(api.validateDownloadUrl(signedDownload), signedDownload);
    for (const value of ['javascript:alert(1)', signedDownload.replace('https:', 'http:'),
        signedDownload.replace('ts.buzzheavier.com', 'buzzheavier.com.evil.test'),
        signedDownload.replace('ts.buzzheavier.com', 'evil.test'),
        signedDownload.replace('://', '://user:password@'),
        signedDownload.replace('.com/', '.com:8443/'), 'https://ts.buzzheavier.com/', pageUrl]) {
        assert.throws(() => api.validateDownloadUrl(value), /다운로드 주소/);
    }
});

test('현재 페이지의 서명 경로를 사용하고 미러·미리보기·다른 파일·외부 경로는 우선하지 않는다', async () => {
    const fixture = harness({ endpoints: [
        '/pk6ep0d4zf24/preview?t=preview',
        'https://evil.test/pk6ep0d4zf24/download?t=untrusted',
        '/different123/download?t=other',
        `${signedEndpoint}&alt=true`,
        signedEndpoint
    ] });
    const result = await fixture.api.resolveInPage(pageUrl);
    assert.equal(result.ok, true);
    assert.equal(result.url, signedDownload);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0].url, `https://buzzheavier.com${signedEndpoint}`);
    const init = fixture.requests[0].init;
    assert.equal(init.headers['HX-Request'], 'true');
    assert.equal(init.credentials, 'include');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.equal(fixture.timers[0].duration, 15000);
    assert.deepEqual(fixture.cleared, [1]);
    assert.equal(fixture.cancelledBodies(), 1);
});

test('상대 HX-Redirect 주소도 해석하며 다운로드 파일 본문은 읽지 않는다', async () => {
    const fixture = harness({ headers: { 'hx-redirect': '/d/pk6ep0d4zf24?v=relative' } });
    const result = await fixture.api.resolveInPage(pageUrl);
    assert.equal(result.url, 'https://buzzheavier.com/d/pk6ep0d4zf24?v=relative');
    assert.equal(fixture.cancelledBodies(), 1);
});

test('페이지 이동·다운로드 요소 없음·잘못된 대상은 파일 요청으로 이어지지 않는다', async () => {
    for (const options of [
        { location: 'https://evil.test/pk6ep0d4zf24' },
        { location: 'https://buzzheavier.com/another12345' },
        { endpoints: [] },
        { endpoints: ['https://user:password@buzzheavier.com/pk6ep0d4zf24/download?t=bad'] },
        { endpoints: ['/pk6ep0d4zf24%2fdownload?t=bad'] }
    ]) {
        const fixture = harness(options);
        const result = await fixture.api.resolveInPage(pageUrl);
        assert.equal(result.ok, false);
        assert.equal(fixture.requests.length, 0);
    }
});

test('보안 확인 화면이나 응답은 우회하지 않고 사용자 확인이 필요한 상태로 반환한다', async () => {
    for (const options of [
        { endpoints: [], title: 'Just a moment...' },
        { endpoints: [], challenge: true },
        { status: 403, headers: { 'cf-mitigated': 'challenge' } }
    ]) {
        const fixture = harness(options);
        const result = await fixture.api.resolveInPage(pageUrl);
        assert.equal(result.ok, false);
        assert.equal(result.code, 'verification-required');
        assert.match(result.error, /확인/);
    }
});

test('HTTP 오류와 주소 없는 응답은 실패로 처리하고 응답 스트림과 타이머를 정리한다', async () => {
    for (const options of [{ status: 404 }, { status: 410 }, { status: 429 }, { headers: {} }]) {
        const fixture = harness(options);
        const result = await fixture.api.resolveInPage(pageUrl);
        assert.equal(result.ok, false);
        assert.ok(result.error);
        assert.equal(fixture.cancelledBodies(), 1);
        assert.deepEqual(fixture.cleared, [1]);
    }
});

test('네트워크 오류와 제한 시간 초과도 실패로 반환하고 타이머를 정리한다', async () => {
    for (const options of [{ networkError: true }, { timeout: true }]) {
        const fixture = harness(options);
        const result = await fixture.api.resolveInPage(pageUrl);
        assert.equal(result.ok, false);
        assert.match(result.error, options.timeout ? /시간이 초과/ : /가져오지 못/);
        assert.deepEqual(fixture.cleared, [1]);
    }
});
