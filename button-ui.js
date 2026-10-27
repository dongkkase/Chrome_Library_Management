'use strict';

const ButtonUI = (() => {
    const active = new WeakMap();

    function start(button) {
        if (!button) return () => {};
        if (active.has(button) || button.disabled) return null;

        const nodes = Array.from(button.childNodes);
        const previous = {
            disabled: button.disabled,
            busy: button.getAttribute('aria-busy'),
            label: button.getAttribute('aria-label'),
            busyClass: button.classList.contains('is-busy')
        };
        const label = previous.label?.trim() || button.textContent.trim() || button.getAttribute('title')?.trim() || '작업';
        const content = button.ownerDocument.createElement('span');
        content.className = 'button-busy-content';
        content.style.display = 'contents';
        content.setAttribute('aria-hidden', 'true');
        content.append(...nodes);

        const spinner = button.ownerDocument.createElement('span');
        spinner.className = 'button-busy-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        const icon = button.ownerDocument.createElement('span');
        icon.className = 'option-action-icon';
        const iconUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL('images/spinner-solid-full.svg')
            : 'images/spinner-solid-full.svg';
        icon.style.setProperty('--action-icon', `url("${iconUrl}")`);
        spinner.append(icon);
        button.append(content, spinner);
        button.classList.add('is-busy');
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.setAttribute('aria-label', `${label} 처리 중`);

        let finished = false;
        let stopSpin = () => {};
        const finish = () => {
            if (finished) return;
            finished = true;
            active.delete(button);
            try {
                stopSpin();
            } finally {
                button.replaceChildren(...nodes);
                button.disabled = previous.disabled;
                if (!previous.busyClass) button.classList.remove('is-busy');
                for (const [attribute, value] of [['aria-busy', previous.busy], ['aria-label', previous.label]]) {
                    if (value === null) button.removeAttribute(attribute);
                    else button.setAttribute(attribute, value);
                }
            }
        };
        active.set(button, finish);
        if (typeof LibraryMotion !== 'undefined') stopSpin = LibraryMotion.spin(icon);
        return finish;
    }

    async function run(button, task) {
        const finish = start(button);
        if (!finish) return;
        try {
            return await task();
        } finally {
            finish();
        }
    }

    return { start, run };
})();
