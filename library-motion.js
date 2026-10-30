'use strict';

const LibraryMotion = (() => {
    const running = new WeakMap();

    function reducedMotion() {
        return typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function cancel(element) {
        const current = running.get(element);
        if (current) current.cancel();
        return Promise.resolve();
    }

    function animateElement(element, keyframes, duration, { styles = {}, onFinish = () => {} } = {}) {
        cancel(element);
        if (!element || reducedMotion() || typeof Motion === 'undefined') {
            onFinish();
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const properties = new Set([...Object.keys(keyframes), ...Object.keys(styles)]);
            const previous = Object.fromEntries([...properties].map(property => [property, element.style[property]]));
            let finished = false;
            let animation;
            const finish = () => {
                if (finished) return;
                finished = true;
                if (running.get(element)?.finish === finish) running.delete(element);
                Object.entries(previous).forEach(([property, value]) => { element.style[property] = value; });
                onFinish();
                resolve();
            };
            const state = {
                finish,
                cancel() {
                    animation?.stop();
                    finish();
                }
            };
            running.set(element, state);
            try {
                Object.assign(element.style, styles);
                animation = Motion.animate(element, keyframes, { duration, ease: 'easeOut' });
                Promise.resolve(animation).then(finish, finish);
            } catch (_) {
                finish();
            }
        });
    }

    function animateVisibility(element, visible, { duration = visible ? 0.16 : 0.12, offset = 5 } = {}) {
        return animateElement(element, {
            opacity: visible ? [0, 1] : [1, 0],
            transform: visible
                ? [`translateY(${offset}px)`, 'translateY(0px)']
                : ['translateY(0px)', `translateY(${offset}px)`]
        }, duration);
    }

    function toggleSwitch(thumb, checked) {
        if (!thumb?.parentElement) return Promise.resolve();
        const distance = Math.max(0, thumb.parentElement.clientWidth - thumb.offsetWidth - 8);
        return animateElement(thumb, {
            transform: [`translateX(${checked ? -distance : distance}px)`, 'translateX(0px)']
        }, 0.18);
    }

    function spin(element) {
        cancel(element);
        if (!element || reducedMotion() || typeof Motion === 'undefined') return () => {};
        const previousTransform = element.style.transform;
        let finished = false;
        let animation;
        const finish = () => {
            if (finished) return;
            finished = true;
            if (running.get(element)?.finish === finish) running.delete(element);
            try {
                animation?.stop();
            } finally {
                element.style.transform = previousTransform;
            }
        };
        running.set(element, { finish, cancel: finish });
        try {
            animation = Motion.animate(element, {
                transform: ['rotate(0deg)', 'rotate(360deg)']
            }, { duration: 0.8, ease: 'linear', repeat: Infinity });
            Promise.resolve(animation).then(finish, finish);
        } catch (_) {
            finish();
        }
        return finish;
    }

    function resize(element, previousBounds) {
        if (!element || !previousBounds) return Promise.resolve();
        cancel(element);
        const nextBounds = element.getBoundingClientRect();
        return animateElement(element, {
            width: [`${previousBounds.width}px`, `${nextBounds.width}px`],
            height: [`${previousBounds.height}px`, `${nextBounds.height}px`]
        }, 0.22);
    }

    function bindDisclosure(element, trigger, { expanded = false, render, onChange = () => {} }) {
        let isExpanded = expanded;
        let revision = 0;
        const content = Array.from(element.children).filter(child => child !== trigger && !child.contains(trigger));
        const originalInert = new Map(content.map(child => [child, child.inert]));

        function measure() {
            const style = window.getComputedStyle(element);
            return {
                height: element.getBoundingClientRect().height,
                paddingTop: style.paddingTop,
                paddingBottom: style.paddingBottom
            };
        }

        function setExpanded(nextExpanded, { animate = true } = {}) {
            const currentRevision = ++revision;
            const previous = measure();
            cancel(element);
            isExpanded = nextExpanded === true;
            trigger.setAttribute('aria-expanded', String(isExpanded));
            if (!isExpanded && content.some(child => child.contains(document.activeElement))) {
                trigger.focus({ preventScroll: true });
            }
            content.forEach(child => { child.inert = isExpanded ? originalInert.get(child) : true; });
            onChange(isExpanded);
            render(isExpanded);
            const next = measure();
            if (!animate || reducedMotion() || typeof Motion === 'undefined' || previous.height === 0 || next.height === 0) {
                return Promise.resolve();
            }

            // 닫는 동안에도 본문을 유지하고 현재 높이부터 다음 상태의 높이까지 이동한다.
            render(true);
            return animateElement(element, {
                height: [`${previous.height}px`, `${next.height}px`],
                paddingTop: [previous.paddingTop, next.paddingTop],
                paddingBottom: [previous.paddingBottom, next.paddingBottom]
            }, 0.24, {
                styles: { overflow: 'hidden', boxSizing: 'border-box', alignContent: 'start' },
                onFinish() {
                    if (revision === currentRevision) render(isExpanded);
                }
            });
        }

        trigger.addEventListener('click', event => {
            event.preventDefault();
            void setExpanded(!isExpanded);
        });
        void setExpanded(expanded, { animate: false });
        return { setExpanded, getExpanded: () => isExpanded };
    }

    function createSlidePanel(element, { expanded = false, focusTarget = null } = {}) {
        let isExpanded;
        let revision = 0;
        let transition = Promise.resolve();

        function measure() {
            if (element.hidden) return { height: 0, opacity: 0 };
            const opacity = Number.parseFloat(window.getComputedStyle(element).opacity);
            return {
                height: element.getBoundingClientRect().height,
                opacity: Number.isFinite(opacity) ? opacity : 1
            };
        }

        function setExpanded(nextExpanded, { animate = true } = {}) {
            const next = nextExpanded === true;
            if (isExpanded === next) return transition;
            const previous = measure();
            const currentRevision = ++revision;
            cancel(element);
            isExpanded = next;
            focusTarget?.setAttribute('aria-expanded', String(next));
            if (!next && element.contains(document.activeElement)) {
                focusTarget?.focus({ preventScroll: true });
            }
            element.inert = !next;
            element.setAttribute('aria-hidden', String(!next));
            element.hidden = false;
            const natural = measure();
            const finish = () => {
                if (revision !== currentRevision) return;
                element.hidden = !isExpanded;
                element.inert = !isExpanded;
            };
            if (!animate || reducedMotion() || typeof Motion === 'undefined' || natural.height === 0) {
                finish();
                transition = Promise.resolve();
                return transition;
            }
            transition = animateElement(element, {
                height: [`${previous.height}px`, `${next ? natural.height : 0}px`],
                opacity: [previous.opacity, next ? natural.opacity : 0]
            }, 0.22, {
                styles: { overflow: 'hidden', boxSizing: 'border-box' },
                onFinish: finish
            });
            return transition;
        }

        void setExpanded(expanded, { animate: false });
        return { setExpanded, getExpanded: () => isExpanded };
    }

    function feedback(element) {
        cancel(element);
        if (!element || reducedMotion() || typeof anime === 'undefined') return Promise.resolve();
        return new Promise(resolve => {
            let finished = false;
            let animation;
            const finish = () => {
                if (finished) return;
                finished = true;
                animation?.revert();
                if (running.get(element)?.finish === finish) running.delete(element);
                resolve();
            };
            running.set(element, { finish, cancel: finish });
            try {
                animation = anime.animate(element, {
                    scale: [0.97, 1],
                    duration: 180,
                    ease: 'out(3)',
                    onComplete: finish
                });
            } catch (_) {
                finish();
            }
        });
    }

    return {
        reveal: (element, options) => animateVisibility(element, true, options),
        conceal: (element, options) => animateVisibility(element, false, options),
        feedback,
        spin,
        toggleSwitch,
        resize,
        bindDisclosure,
        createSlidePanel,
        cancel
    };
})();
