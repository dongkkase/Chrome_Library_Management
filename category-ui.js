'use strict';

const BookCategoryUI = (() => {
    const storageKey = 'lastRegistrationCategory';
    const subscribers = new Set();
    let registrationCategory = 'uncategorized';
    let savedCategory = registrationCategory;
    let selectionRevision = 0;
    let pendingWrites = 0;
    let writeQueue = Promise.resolve();
    let nextId = 0;
    let openDropdown = null;
    let tooltipOwner = null;
    let tooltip = null;
    let tooltipTimer = null;
    let removalObserver = null;

    function notifyRegistration() {
        subscribers.forEach(callback => {
            try {
                callback(registrationCategory);
            } catch (error) {
                console.warn('분류 선택 표시를 갱신하지 못했습니다.', error);
            }
        });
    }

    async function readRegistrationCategory(expectedRevision = selectionRevision) {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        const data = await chrome.storage.local.get({ [storageKey]: 'uncategorized' });
        if (expectedRevision !== selectionRevision || pendingWrites) return;
        savedCategory = normalizeBookCategory(data[storageKey]);
        if (registrationCategory !== savedCategory) {
            registrationCategory = savedCategory;
            notifyRegistration();
        }
    }

    const ready = readRegistrationCategory().catch(error => {
        console.warn('마지막 등록 분류를 불러오지 못했습니다.', error);
    });

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes[storageKey]) return;
            savedCategory = normalizeBookCategory(changes[storageKey].newValue);
            if (!pendingWrites && registrationCategory !== savedCategory) {
                selectionRevision++;
                registrationCategory = savedCategory;
                notifyRegistration();
            }
        });
    }

    function setRegistrationCategory(value) {
        const category = normalizeBookCategory(value);
        const revision = ++selectionRevision;
        registrationCategory = category;
        pendingWrites++;
        notifyRegistration();
        const operation = writeQueue.catch(() => {}).then(async () => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) {
                throw new Error('확장 프로그램 저장소를 사용할 수 없습니다.');
            }
            await chrome.storage.local.set({ [storageKey]: category });
            savedCategory = category;
        });
        writeQueue = operation;
        return operation.catch(error => {
            if (revision === selectionRevision) {
                registrationCategory = savedCategory;
                notifyRegistration();
            }
            throw error;
        }).finally(() => {
            pendingWrites--;
            if (!pendingWrites) readRegistrationCategory().catch(() => {});
        });
    }

    function subscribeRegistrationCategory(callback) {
        subscribers.add(callback);
        callback(registrationCategory);
        return () => subscribers.delete(callback);
    }

    function categoryOptions({ includeAll = false, includeUnchanged = false } = {}) {
        const options = BOOK_CATEGORIES.map(category => ({ value: category.id, label: category.label }));
        if (includeAll) options.unshift({ value: 'all', label: '전체 분류' });
        if (includeUnchanged) options.unshift({ value: 'unchanged', label: '변경 안 함' });
        return options;
    }

    function refreshRemovalObserver() {
        if (!openDropdown && !tooltipOwner) {
            removalObserver?.disconnect();
            return;
        }
        if (typeof MutationObserver === 'undefined' || !document.body) return;
        if (!removalObserver) {
            removalObserver = new MutationObserver(() => {
                if (openDropdown && !openDropdown.element.isConnected) openDropdown.close(false, true);
                if (tooltipOwner && !tooltipOwner.isConnected) hideTooltip();
            });
        }
        removalObserver.observe(document.body, { childList: true, subtree: true });
    }

    function placeFloating(floating, anchor, tooltipMode = false) {
        const margin = 8;
        const gap = tooltipMode ? 9 : 6;
        const rect = anchor.getBoundingClientRect();
        const width = Math.min(window.innerWidth || document.documentElement.clientWidth, document.documentElement.clientWidth || Infinity);
        const height = window.innerHeight || document.documentElement.clientHeight;
        floating.style.maxWidth = `${Math.max(0, width - margin * 2)}px`;
        if (!tooltipMode) {
            const availableBelow = height - rect.bottom - gap - margin;
            const availableAbove = rect.top - gap - margin;
            floating.style.maxHeight = `${Math.max(80, Math.min(340, Math.max(availableBelow, availableAbove)))}px`;
        }
        const floatingRect = floating.getBoundingClientRect();
        let top = rect.bottom + gap;
        if (tooltipMode || top + floatingRect.height > height - margin) {
            if (rect.top - gap - floatingRect.height >= margin) top = rect.top - gap - floatingRect.height;
        }
        top = Math.max(margin, Math.min(top, height - floatingRect.height - margin));
        const desiredLeft = tooltipMode ? rect.left + (rect.width - floatingRect.width) / 2 : rect.left;
        const left = Math.max(margin, Math.min(desiredLeft, width - floatingRect.width - margin));
        floating.style.left = `${left}px`;
        floating.style.top = `${top}px`;
        floating.dataset.placement = top < rect.top ? 'top' : 'bottom';
        if (tooltipMode) floating.style.setProperty('--bm-tooltip-arrow-x', `${Math.max(10, Math.min(floatingRect.width - 10, rect.left + rect.width / 2 - left))}px`);
    }

    function syncTheme(element) {
        element.classList.toggle('bm-category-dark', !!document.body?.classList.contains('dark-mode'));
    }

    function hideTooltip() {
        clearTimeout(tooltipTimer);
        tooltipTimer = null;
        if (tooltipOwner) tooltipOwner.removeAttribute('aria-describedby');
        tooltipOwner = null;
        const oldTooltip = tooltip;
        tooltip = null;
        if (oldTooltip) {
            LibraryMotion.cancel(oldTooltip);
            oldTooltip.remove();
        }
        refreshRemovalObserver();
    }

    function scheduleTooltip(button, getText) {
        hideTooltip();
        if (openDropdown?.button === button) return;
        tooltipOwner = button;
        tooltipTimer = setTimeout(() => {
            if (tooltipOwner !== button || !button.isConnected || openDropdown?.button === button) return;
            tooltip = document.createElement('div');
            tooltip.className = 'bm-category-tooltip';
            tooltip.id = `bm-category-tooltip-${++nextId}`;
            tooltip.setAttribute('role', 'tooltip');
            tooltip.textContent = getText();
            syncTheme(tooltip);
            document.body.appendChild(tooltip);
            button.setAttribute('aria-describedby', tooltip.id);
            placeFloating(tooltip, button, true);
            LibraryMotion.reveal(tooltip, { duration: 0.12, offset: 3 });
            refreshRemovalObserver();
        }, 300);
    }

    function iconUrl(filename) {
        const resource = filename.startsWith('images/') ? filename : `images/${filename}`;
        try {
            return typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(resource) : resource;
        } catch (_) {
            return resource;
        }
    }

    function attachTooltip(button, getText) {
        const show = () => scheduleTooltip(button, typeof getText === 'function' ? getText : () => String(getText));
        const hide = () => { if (tooltipOwner === button) hideTooltip(); };
        button.addEventListener('pointerenter', show);
        button.addEventListener('pointerleave', hide);
        button.addEventListener('focus', show);
        button.addEventListener('blur', hide);
        return () => {
            hide();
            button.removeEventListener('pointerenter', show);
            button.removeEventListener('pointerleave', hide);
            button.removeEventListener('focus', show);
            button.removeEventListener('blur', hide);
        };
    }

    function createDropdown({ options, value, label = '분류 선택', onChange, icon, text, showText = true, className = '' }) {
        const entries = options.map(option => ({ value: String(option.value), label: String(option.label) }));
        let current = entries.some(option => option.value === String(value)) ? String(value) : entries[0]?.value || '';
        let menu = null;
        let activeIndex = 0;
        let destroyed = false;
        let changeRevision = 0;
        const element = document.createElement('span');
        element.className = `bm-dropdown bm-category-dropdown ${className}`.trim();
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bm-dropdown-button bm-category-button';
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        const menuId = `bm-category-menu-${++nextId}`;
        button.setAttribute('aria-controls', menuId);
        const iconElement = document.createElement('span');
        iconElement.className = 'bm-category-icon';
        iconElement.setAttribute('aria-hidden', 'true');
        const textElement = document.createElement('span');
        textElement.className = 'bm-category-button-text';
        textElement.hidden = !showText;
        const arrow = document.createElement('span');
        arrow.className = 'bm-category-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.style.setProperty('--bm-category-arrow', `url("${iconUrl('caret-down-solid-full.svg')}")`);
        button.append(iconElement, textElement, arrow);
        element.appendChild(button);

        const selectedLabel = () => entries.find(option => option.value === current)?.label || current;
        const tooltipText = () => `${label}: ${selectedLabel()}`;

        function update() {
            const selectedText = selectedLabel();
            textElement.textContent = typeof text === 'function' ? text(current, selectedText) : selectedText;
            button.setAttribute('aria-label', tooltipText());
            button.dataset.value = current;
            const filename = typeof icon === 'function' ? icon(current) : icon;
            iconElement.hidden = !filename;
            if (filename) iconElement.style.setProperty('--bm-category-icon', `url("${iconUrl(filename)}")`);
            if (menu) {
                menu.querySelectorAll('[role="option"]').forEach(option => {
                    option.setAttribute('aria-selected', String(option.dataset.value === current));
                });
            }
        }

        function setValue(nextValue) {
            if (!entries.some(option => option.value === String(nextValue))) return;
            current = String(nextValue);
            update();
        }

        function focusOption(index) {
            if (!menu || !entries.length) return;
            activeIndex = (index + entries.length) % entries.length;
            const buttons = menu.querySelectorAll('[role="option"]');
            buttons.forEach((option, itemIndex) => { option.tabIndex = itemIndex === activeIndex ? 0 : -1; });
            buttons[activeIndex]?.focus({ preventScroll: true });
            buttons[activeIndex]?.scrollIntoView({ block: 'nearest' });
        }

        function close(restoreFocus = false, immediate = false) {
            if (!menu) return;
            const previousMenu = menu;
            menu = null;
            if (openDropdown === api) openDropdown = null;
            button.setAttribute('aria-expanded', 'false');
            previousMenu.inert = true;
            previousMenu.style.pointerEvents = 'none';
            if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
            if (immediate) {
                LibraryMotion.cancel(previousMenu);
                previousMenu.remove();
            } else LibraryMotion.conceal(previousMenu).then(() => previousMenu.remove());
            refreshRemovalObserver();
        }

        function choose(index) {
            const entry = entries[index];
            if (!entry) return;
            const previous = current;
            const revision = ++changeRevision;
            setValue(entry.value);
            close(true);
            LibraryMotion.feedback(button);
            if (previous === current || typeof onChange !== 'function') return;
            try {
                Promise.resolve(onChange(current)).catch(error => {
                    if (revision === changeRevision && !destroyed) setValue(previous);
                    console.warn('분류 선택을 적용하지 못했습니다.', error);
                });
            } catch (error) {
                setValue(previous);
                console.warn('분류 선택을 적용하지 못했습니다.', error);
            }
        }

        function open() {
            if (destroyed || !element.isConnected || !entries.length) return;
            hideTooltip();
            if (openDropdown && openDropdown !== api) openDropdown.close(false, true);
            if (menu) return;
            menu = document.createElement('div');
            menu.id = menuId;
            menu.className = 'bm-category-menu';
            menu.setAttribute('role', 'listbox');
            menu.setAttribute('aria-label', label);
            syncTheme(menu);
            entries.forEach((entry, index) => {
                const option = document.createElement('button');
                option.type = 'button';
                option.className = 'bm-category-option';
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', String(entry.value === current));
                option.dataset.value = entry.value;
                option.tabIndex = -1;
                option.textContent = entry.label;
                option.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    choose(index);
                });
                menu.appendChild(option);
            });
            menu.addEventListener('keydown', event => {
                let handled = true;
                if (event.key === 'ArrowDown') focusOption(activeIndex + 1);
                else if (event.key === 'ArrowUp') focusOption(activeIndex - 1);
                else if (event.key === 'Home') focusOption(0);
                else if (event.key === 'End') focusOption(entries.length - 1);
                else if (event.key === 'Enter' || event.key === ' ') choose(activeIndex);
                else if (event.key === 'Escape') close(true);
                else if (event.key === 'Tab') {
                    button.focus({ preventScroll: true });
                    close(false, true);
                    handled = false;
                } else handled = false;
                if (handled) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
            document.body.appendChild(menu);
            openDropdown = api;
            button.setAttribute('aria-expanded', 'true');
            placeFloating(menu, button);
            focusOption(Math.max(0, entries.findIndex(entry => entry.value === current)));
            LibraryMotion.reveal(menu);
            refreshRemovalObserver();
        }

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (menu) close(true);
            else open();
        });
        button.addEventListener('keydown', event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') close(true);
            else {
                open();
                if (event.key === 'Home') focusOption(0);
                if (event.key === 'End') focusOption(entries.length - 1);
            }
        });
        const detachTooltip = attachTooltip(button, tooltipText);
        button.addEventListener('pointerdown', event => event.stopPropagation());
        const api = {
            element,
            button,
            setValue,
            getValue: () => current,
            close,
            reposition() { if (menu) placeFloating(menu, button); },
            contains(target) { return element.contains(target) || !!menu?.contains(target); },
            destroy() {
                destroyed = true;
                close(false, true);
                detachTooltip();
                LibraryMotion.cancel(button);
                element.remove();
            }
        };
        update();
        return api;
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('pointerdown', event => {
            if (openDropdown && !openDropdown.contains(event.target)) openDropdown.close(false);
            hideTooltip();
        }, true);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') hideTooltip();
        }, true);
        document.addEventListener('scroll', event => {
            if (event.target instanceof Element && event.target.closest('.bm-category-menu')) return;
            openDropdown?.reposition();
            hideTooltip();
        }, true);
        window.addEventListener('resize', () => {
            openDropdown?.reposition();
            hideTooltip();
        });
        window.addEventListener('blur', () => {
            openDropdown?.close(false, true);
            hideTooltip();
        });
    }

    return {
        ready,
        createDropdown,
        attachTooltip,
        categoryOptions,
        getRegistrationCategory: () => registrationCategory,
        setRegistrationCategory,
        subscribeRegistrationCategory
    };
})();
