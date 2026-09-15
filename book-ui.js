'use strict';

const BookMatchUI = (() => {
    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function displayMatchScore(score) {
        return score === 100 ? 100 : Math.min(99, Math.round(score));
    }

    function matchScoreHtml(score, light = false) {
        if (score < 100) {
            return `<span class="bm-match-score bm-match-score--partial" style="color:#5f3b00; background:#fff3bf; border:1px solid #e67700; font-size:10px; font-weight:800; padding:1px 4px; border-radius:3px; margin-left:4px; vertical-align:middle; display:inline-block; line-height:1.15; white-space:nowrap; box-shadow:0 1px 2px rgba(0,0,0,0.12);" title="유사 매칭 ${score}%: 등록된 책 제목을 확인하세요">유사 ${score}%</span>`;
        }
        const textColor = light ? 'rgba(255,255,255,0.8)' : '#868e96';
        return `<span class="bm-match-score bm-match-score--exact" style="color:${textColor}; font-size:10px; margin-left:4px;" title="일치율: ${score}%">(${score}%)</span>`;
    }

    function getUpgrades(book, siteRes, siteVol) {
        const regRes = parseInt(String(book?.resolution || '').replace(/[^0-9]/g, ''), 10) || 0;
        const regVol = parseInt(book?.lastVol, 10) || 0;
        return {
            resolution: siteRes > regRes && regRes > 0,
            volume: siteVol > regVol && regVol > 0
        };
    }

    function shouldHidePost({ book, score = 100, siteRes = 0, siteVol = 0, translated = false, forceTranslationHide = false }, settings) {
        if (forceTranslationHide && translated && settings.hideTranslate) return true;
        if (!book) return !!(settings.hideNew || (translated && settings.hideTranslate));
        const hideByType = (book.type === 'exclude' && settings.hideExclude && score > 95)
            || (book.type === 'complete' && settings.hideComplete)
            || (book.type === 'incomplete' && settings.hideIncomplete)
            || (book.type === 'new' && settings.hideNew);
        const upgrades = getUpgrades(book, siteRes, siteVol);
        if (book.type !== 'exclude' && (upgrades.resolution || upgrades.volume || book.missingVols?.length)) return false;
        return !!(hideByType || (translated && settings.hideTranslate));
    }

    function getPresentation(book, siteRes, siteVol, maxScore = 100, detail = false) {
        const result = { html: '', style: '', titleStyles: {}, score: displayMatchScore(maxScore) };
        if (!book || !['exclude', 'incomplete', 'complete'].includes(book.type)) return result;
        const upgrades = getUpgrades(book, siteRes, siteVol);
        const hasUpgrade = upgrades.resolution || upgrades.volume;
        const resText = escapeHtml(book.resolution || '-');
        const volText = book.lastVol ? escapeHtml(book.lastVol) + '권' : '-';
        const size = detail ? 11 : 10;
        const margin = detail ? 8 : 6;
        const missingHtml = book.missingVols?.length
            ? `<span style="background:#7b1010; color:#fff; font-size:9px; font-weight:bold; padding:1px 4px; border-radius:3px; margin-left:${detail ? 5 : 4}px; vertical-align:middle; display:inline-block; line-height:1.2; box-shadow:0 1px 2px rgba(0,0,0,0.2);">누락:${escapeHtml(book.missingVols.join(','))}</span>`
            : '';
        const orangeValue = (value, up) => up
            ? `<span style="color:#ffc107; font-weight:900;">${value} <b style="background:#ffc107; color:#000; padding:1px 3px; border-radius:2px; font-size:8px;">UP</b></span>`
            : `<span style="color:#ffffff; font-weight:bold;">${value}</span>`;

        if (book.type === 'exclude') {
            result.titleStyles = { 'text-decoration': 'line-through', color: '#aaaaaa', opacity: '0.5' };
            if (!detail) result.titleStyles['font-weight'] = 'normal';
            result.html = `<span style="color:#999;">${resText}</span><span style="color:#ccc;"> | </span><span style="color:#999;">${volText}</span>${missingHtml}${matchScoreHtml(result.score)}`;
            result.style = detail
                ? 'font-size:11px; font-weight:bold; background:#f8f9fa; border:1px solid #dee2e6; padding:2px 5px; border-radius:4px; margin-left:8px; vertical-align:middle; display:inline-block; line-height:1.2; text-decoration:none !important; opacity:1 !important;'
                : 'font-size:10px; background:#f8f9fa; border:1px solid #dee2e6; padding:2px 4px; border-radius:3px; margin-left:6px; vertical-align:middle; display:inline-block; line-height:1.2;';
        } else if (book.type === 'incomplete' || hasUpgrade) {
            result.titleStyles = { 'text-decoration': 'none', color: '#d9480f', 'font-weight': '800' };
            if (!detail) result.titleStyles.opacity = '1';
            result.html = orangeValue(resText, upgrades.resolution) + '<span style="color:rgba(255,255,255,0.5); margin:0 4px;">|</span>' + orangeValue(volText, upgrades.volume) + missingHtml + matchScoreHtml(result.score, true);
            const shadow = hasUpgrade ? 'box-shadow: 0 0 6px rgba(255, 193, 7, 0.8);' : 'box-shadow: 0 1px 2px rgba(0,0,0,0.2);';
            result.style = `font-size:${size}px; background:#e65100; border:1px solid #e65100; padding:3px 6px; border-radius:4px; margin-left:${margin}px; vertical-align:middle; display:inline-block; line-height:1.2; ${shadow}`;
        } else {
            result.titleStyles = { 'text-decoration': 'none', color: '#0056b3', 'font-weight': '600' };
            if (!detail) result.titleStyles.opacity = '1';
            result.html = `<span style="color:#007bff; font-weight:normal;">${resText}</span><span style="color:#007bff; opacity:0.5; margin:0 4px;">|</span><span style="color:#007bff; font-weight:normal;">${volText}</span>${missingHtml}${matchScoreHtml(result.score)}`;
            result.style = `font-size:${size}px; background:#f0f7ff; border:1px solid #007bff; padding:2px ${detail ? 5 : 4}px; border-radius:${detail ? 4 : 3}px; margin-left:${margin}px; vertical-align:middle; display:inline-block; line-height:1.2;`;
        }
        return result;
    }

    const quickButtonStyle = 'padding: 2px 5px; font-size: 11px; font-weight: bold; border-radius: 4px; cursor: pointer; color: white; border: none; text-decoration: none; line-height: 1.2; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: all 0.2s; flex-shrink: 0;';
    const quickButtons = [
        { label: '복사', color: '#845ef7', action: 'copy' },
        { label: '제외', color: '#ff6b6b', action: 'exclude' },
        { label: '미완', color: '#ff922b', action: 'incomplete' },
        { label: '완결', color: '#4dabf7', action: 'complete' },
        { label: '삭제', color: '#868e96', action: 'delete' },
        { label: '누락관리', color: '#f06595', action: 'missing_vol' },
        { label: '구글검색', color: '#20c997', action: 'search' },
        { label: '리디검색', color: '#1e90ff', action: 'ridi_preview' },
        { label: '에브리띵검색', color: '#495057', action: 'everything_search' },
        { label: '제목정정', color: '#5c7cfa', action: 'correct_title' }
    ];

    function createHidePanel(settings, onChange, prefix = 'bm', demo = false) {
        const panel = document.createElement('div');
        panel.id = `${prefix}-quick-hide-panel`;
        panel.className = 'bm-hide-panel';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', demo ? '게시물 숨김 체험' : '게시물 숨김');
        const heading = document.createElement('div');
        heading.className = 'bm-qh-heading';
        const title = document.createElement('span');
        title.textContent = '🙈 게시물 숨김';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.id = `${prefix}-qh-toggle-btn`;
        toggle.className = 'bm-qh-toggle-btn';
        toggle.textContent = '−';
        toggle.setAttribute('aria-label', '게시물 숨김 접기');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-controls', `${prefix}-qh-content`);
        heading.appendChild(title);
        const content = document.createElement('div');
        content.id = `${prefix}-qh-content`;
        content.className = 'bm-qh-content';
        content.setAttribute('role', 'group');
        content.setAttribute('aria-label', '게시물 숨김 유형');
        const body = document.createElement('div');
        body.className = 'bm-qh-body';
        const bodyInner = document.createElement('div');
        bodyInner.className = 'bm-qh-body-inner';
        for (const [type, labelText] of [['exclude', '제외'], ['complete', '완결'], ['incomplete', '미완'], ['translate', '번역'], ['new', '신작']]) {
            const key = `hide${type[0].toUpperCase()}${type.slice(1)}`;
            const label = document.createElement('label');
            label.className = 'bm-qh-label';
            const switchElement = document.createElement('span');
            switchElement.className = 'bm-toggle-switch';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `${prefix}-qh-${type}`;
            input.checked = !!settings[key];
            input.dataset.hideSetting = key;
            input.addEventListener('change', () => onChange(key, input.checked));
            const slider = document.createElement('span');
            slider.className = 'bm-slider';
            switchElement.append(input, slider);
            label.append(switchElement, document.createTextNode(` ${labelText}`));
            content.appendChild(label);
        }
        toggle.addEventListener('click', () => {
            const collapsed = panel.classList.toggle('is-collapsed');
            body.inert = collapsed;
            body.setAttribute('aria-hidden', String(collapsed));
            toggle.textContent = collapsed ? '+' : '−';
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.setAttribute('aria-label', collapsed ? '게시물 숨김 펼치기' : '게시물 숨김 접기');
        });
        bodyInner.appendChild(content);
        if (demo) {
            const caption = document.createElement('small');
            caption.className = 'bm-qh-demo-caption';
            caption.id = `${prefix}-qh-caption`;
            caption.textContent = '체험용 · 위 게시판 예시에만 적용됩니다.';
            title.title = caption.textContent;
            panel.setAttribute('aria-describedby', caption.id);
            bodyInner.appendChild(caption);
        }
        body.appendChild(bodyInner);
        panel.append(heading, body, toggle);
        return panel;
    }

    const missingPopoverStyle = 'position:absolute; display:none; background:#fff; border:1px solid #dee2e6; border-radius:10px; padding:15px; box-shadow:0 6px 18px rgba(0,0,0,0.2); z-index:9999999; width:250px; box-sizing:border-box;';

    function missingPopoverHtml(book, closeId = 'bmClosePopoverBtn') {
        const lastVol = parseInt(book.lastVol, 10);
        const missing = new Set(book.missingVols || []);
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; font-weight:bold; border-bottom:1px solid #dee2e6; padding-bottom:8px; margin-bottom:8px; color:#333;">
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${escapeHtml(book.title)} (총 ${lastVol}권)</span>
                <button type="button" id="${escapeHtml(closeId)}" aria-label="누락관리 닫기" style="background:transparent; color:#333; padding:0; margin-left:5px; font-size:16px; border:none; cursor:pointer;">✕</button>
            </div>
            <div style="font-size:11px; color:#6c757d; margin-bottom:8px;">빈틈이 발생한 누락 번호를 클릭하세요.</div>
            <div class="bm-vol-grid" style="display:grid; grid-template-columns:repeat(5, 1fr); gap:5px; max-height:200px; overflow-y:auto; padding-right:4px; box-sizing:border-box;">
                ${Array.from({ length: lastVol }, (_, i) => i + 1).map(v => `
                    <button type="button" class="bm-vol-item ${missing.has(v) ? 'missing' : ''}" data-vol="${v}" aria-label="${v}권 누락" aria-pressed="${missing.has(v)}" style="text-align:center; padding:6px 0; font-size:12px; background:${missing.has(v) ? '#ffe3e3' : '#f8f9fa'}; border:1px solid ${missing.has(v) ? '#ffa8a8' : '#dee2e6'}; border-radius:4px; cursor:pointer; user-select:none; color:${missing.has(v) ? '#e03131' : '#333'}; font-weight:500; transition:all 0.1s; ${missing.has(v) ? 'text-decoration:line-through; opacity:0.8;' : ''}">${v}</button>
                `).join('')}
            </div>`;
    }

    return { getPresentation, getUpgrades, shouldHidePost, displayMatchScore, matchScoreHtml, createHidePanel, quickButtonStyle, quickButtons, missingPopoverStyle, missingPopoverHtml };
})();
