'use strict';

(() => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const links = Array.from(sidebar.querySelectorAll('a[href^="#"]'));
    const sections = Array.from(document.querySelectorAll('main > section[id]'));
    const entries = sections.map(section => ({
        section,
        link: links.find(link => link.getAttribute('href') === `#${section.id}`)
    })).filter(entry => entry.link);
    if (!entries.length) return;

    const header = document.querySelector('.page-header');
    let activeLink = null;
    let framePending = false;

    function updateNavigation() {
        framePending = false;
        const scroller = document.scrollingElement || document.documentElement;
        const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
        const scrollPadding = parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        let active = entries[0];

        if (maxScroll > 0 && scroller.scrollTop >= maxScroll - 2) {
            active = entries[entries.length - 1];
        } else {
            for (const entry of entries) {
                const margin = parseFloat(window.getComputedStyle(entry.section).scrollMarginTop) || 0;
                const readingLine = Math.max(headerBottom, scrollPadding) + margin + 1;
                if (entry.section.getBoundingClientRect().top <= readingLine) active = entry;
                else break;
            }
        }
        if (activeLink === active.link) return;
        activeLink = active.link;
        links.forEach(link => {
            if (link === activeLink) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });

        // 목차 내부만 스크롤하고 본문 위치나 키보드 포커스는 바꾸지 않는다.
        if (sidebar.scrollHeight > sidebar.clientHeight) {
            const menuBounds = sidebar.getBoundingClientRect();
            const linkBounds = activeLink.getBoundingClientRect();
            if (linkBounds.top < menuBounds.top) sidebar.scrollTop += linkBounds.top - menuBounds.top;
            else if (linkBounds.bottom > menuBounds.bottom) sidebar.scrollTop += linkBounds.bottom - menuBounds.bottom;
        }
    }

    function scheduleUpdate() {
        if (framePending) return;
        framePending = true;
        window.requestAnimationFrame(updateNavigation);
    }

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    for (const eventName of ['resize', 'hashchange', 'pageshow', 'load']) {
        window.addEventListener(eventName, scheduleUpdate);
    }
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(scheduleUpdate);
        entries.forEach(entry => observer.observe(entry.section));
        if (header) observer.observe(header);
    }
    scheduleUpdate();
})();
