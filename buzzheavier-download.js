'use strict';

const BuzzheavierDownload = (() => {
    function normalizePageUrl(rawUrl) {
        let url;
        try {
            url = new URL(rawUrl);
        } catch (_) {
            throw new Error('올바른 Buzzheavier 공유 링크가 아닙니다.');
        }
        if (!['http:', 'https:'].includes(url.protocol)
            || !['buzzheavier.com', 'www.buzzheavier.com'].includes(url.hostname)
            || url.username || url.password || url.port
            || !/^\/[a-z0-9]{12}\/?$/i.test(url.pathname)) {
            throw new Error('올바른 Buzzheavier 공유 링크가 아닙니다.');
        }
        return `https://buzzheavier.com/${url.pathname.split('/')[1]}`;
    }

    function validateDownloadUrl(rawUrl) {
        let url;
        try {
            url = new URL(rawUrl);
        } catch (_) {
            throw new Error('Buzzheavier 다운로드 주소를 확인할 수 없습니다.');
        }
        if (url.protocol !== 'https:' || url.username || url.password || url.port
            || !(url.hostname === 'buzzheavier.com' || url.hostname.endsWith('.buzzheavier.com'))
            || url.pathname === '/' || /^\/[a-z0-9]{12}\/?$/i.test(url.pathname)) {
            throw new Error('허용되지 않은 Buzzheavier 다운로드 주소입니다.');
        }
        return url.href;
    }

    // executeScript로 전달하므로 이 함수는 바깥 변수나 다른 모듈을 참조하지 않는다.
    async function resolveInPage(pageUrl) {
        const expected = new URL(pageUrl);
        if (location.origin !== expected.origin || location.pathname.replace(/\/$/, '') !== expected.pathname) {
            return { ok: false, error: 'Buzzheavier 파일 페이지가 다른 주소로 이동했습니다.' };
        }

        const fileId = expected.pathname.slice(1);
        const endpoints = Array.from(document.querySelectorAll('[hx-get]')).flatMap(element => {
            try {
                const endpoint = new URL(element.getAttribute('hx-get'), expected.origin);
                return endpoint.origin === expected.origin && !endpoint.username && !endpoint.password
                    && endpoint.pathname === `/${fileId}/download` ? [endpoint] : [];
            } catch (_) {
                return [];
            }
        });
        const endpoint = endpoints.find(url => url.searchParams.get('alt') !== 'true') || endpoints[0];
        if (!endpoint) {
            const verification = /just a moment|attention required|checking your browser|잠시만/i.test(document.title || '')
                || !!document.querySelector('#challenge-form, #challenge-running, #challenge-stage, .cf-turnstile, iframe[src*="challenges.cloudflare.com"]');
            return verification
                ? { ok: false, code: 'verification-required', error: 'Buzzheavier 페이지에서 보안 확인을 완료한 뒤 바로다운로드를 다시 눌러주세요.' }
                : { ok: false, error: 'Buzzheavier 다운로드 링크를 찾을 수 없습니다. 파일이 삭제되거나 만료되었는지 확인해주세요.' };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
            response = await fetch(endpoint.href, {
                headers: { 'HX-Request': 'true' },
                credentials: 'include',
                redirect: 'error',
                cache: 'no-store',
                signal: controller.signal
            });
            if (response.headers.get('cf-mitigated') === 'challenge') {
                return { ok: false, code: 'verification-required', error: 'Buzzheavier 페이지에서 보안 확인을 완료한 뒤 바로다운로드를 다시 눌러주세요.' };
            }
            if (response.status === 429) {
                return { ok: false, error: 'Buzzheavier 요청이 많습니다. 잠시 후 다시 시도해주세요.' };
            }
            if (!response.ok) {
                return { ok: false, error: `Buzzheavier 다운로드 요청이 실패했습니다. (HTTP ${response.status})` };
            }
            const redirect = response.headers.get('HX-Redirect')?.trim();
            if (!redirect) {
                return { ok: false, error: 'Buzzheavier가 다운로드 주소를 반환하지 않았습니다. 원본 페이지에서 파일 상태를 확인해주세요.' };
            }
            return { ok: true, url: new URL(redirect, endpoint.href).href };
        } catch (error) {
            return {
                ok: false,
                error: error.name === 'AbortError'
                    ? 'Buzzheavier 응답 시간이 초과되었습니다. 다시 시도해주세요.'
                    : 'Buzzheavier 다운로드 주소를 가져오지 못했습니다. 다시 시도해주세요.'
            };
        } finally {
            clearTimeout(timeout);
            // 파일 본문을 미리 받지 않고 다운로드 주소 헤더만 사용한다.
            if (response?.body) await response.body.cancel().catch(() => {});
        }
    }

    return { normalizePageUrl, validateDownloadUrl, resolveInPage };
})();
