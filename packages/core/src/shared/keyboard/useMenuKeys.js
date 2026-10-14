// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Keyboard model for the wallet's popup menus and listboxes. About fifteen
// popovers (network and chain filters, the "more" menus, the scan and
// platform menus) are built from real buttons carrying role="menuitem" or
// role="option" inside a role="menu" / role="listbox" container. That role
// promises arrow-key navigation, and they gave only Tab. One delegated
// listener supplies it for all of them:
//
//   - Down/Up/Home/End move focus between the items of the popup that holds
//     focus. Down from the button that opened it (or from a search box inside
//     it) lands on the first item.
//   - When Escape or choosing an item closes the popup, the item that held
//     focus is unmounted and focus would fall to the page; it is handed back
//     to the button that opened the popup instead.
//
// Each popover keeps its own open/close state and its own Escape handler;
// this only moves focus. The command palette is not touched: its options are
// not focusable, its search box drives them with aria-activedescendant.

import { useEffect } from 'react';

const POPUP = '[role="menu"], [role="listbox"]';
const ITEM = '[role="menuitem"], [role="option"], [role="menuitemradio"], [role="menuitemcheckbox"]';

function itemsOf(popup) {
    return Array.from(popup.querySelectorAll(ITEM))
        .filter((el) => (
            el.closest(POPUP) === popup
            && !el.disabled
            && !el.hidden
            && el.getAttribute('aria-disabled') !== 'true'
            && (el.matches('button, a[href], input, select, textarea') || el.hasAttribute('tabindex'))
        ));
}

function setRovingItem(items, current) {
    for (const item of items) item.tabIndex = item === current ? 0 : -1;
}

function normalizePopup(popup) {
    const items = itemsOf(popup);
    if (items.length === 0) return;
    const focused = items.includes(document.activeElement) ? document.activeElement : null;
    const selected = items.find((item) => (
        item.getAttribute('aria-selected') === 'true'
        || item.getAttribute('aria-checked') === 'true'
    ));
    const authored = items.find((item) => item.tabIndex === 0);
    setRovingItem(items, focused || selected || authored || items[0]);
}

/** The button that opened the popup, found from the expanded state it carries. */
function openerOf(popup) {
    const scope = popup.parentElement;
    const own = scope && scope.querySelector('[aria-haspopup][aria-expanded="true"]');
    return own || document.querySelector('[aria-haspopup][aria-expanded="true"]');
}

function isEditable(el) {
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

/** Index of the item to focus for an arrow/Home/End key; null for other keys. */
export function nextMenuIndex(key, index, count) {
    if (count < 1) return null;
    if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
    if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return null;
}

// After a popup closes the focused item is gone and focus falls to <body>;
// give it back to the opener unless the app already put it somewhere.
function restoreToOpener(opener) {
    if (!opener) return;
    requestAnimationFrame(() => {
        const now = document.activeElement;
        if ((!now || now === document.body) && opener.isConnected) opener.focus();
    });
}

/** Handle one delegated menu keydown. */
function handleMenuKeyDown(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;

    const popup = target.closest(POPUP);
    if (popup) {
        const opener = openerOf(popup);
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
            // Enter and Space activate the item; whichever way the popup
            // closes, the opener is where the user was.
            if (e.key === 'Escape' || target.matches(ITEM)) restoreToOpener(opener);
            return;
        }
        const items = itemsOf(popup);
        const editable = isEditable(target);
        // Home and End belong to a search box's caret.
        if (editable && (e.key === 'Home' || e.key === 'End')) return;
        const index = items.indexOf(target.closest(ITEM));
        if (index < 0 && !editable) return;
        const next = nextMenuIndex(e.key, editable ? -1 : index, items.length);
        if (next === null) return;
        e.preventDefault();
        setRovingItem(items, items[next]);
        items[next].focus();
        return;
    }

    // The button that opened a popup: Down moves into it.
    if (e.key === 'ArrowDown' && target.matches('[aria-haspopup][aria-expanded="true"]')) {
        const scope = target.parentElement;
        const open = scope && scope.querySelector(POPUP);
        const items = open ? itemsOf(open) : [];
        if (items.length === 0) return;
        e.preventDefault();
        const selected = items.find((el) => el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true');
        const next = selected || items[0];
        setRovingItem(items, next);
        next.focus();
    }
}

/** Installs the delegated menu key handler for the life of the shell. */
export function useMenuKeys() {
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        document.querySelectorAll(POPUP).forEach(normalizePopup);
        const observer = new MutationObserver((records) => {
            const popups = new Set();
            for (const record of records) {
                const parent = record.target.nodeType === Node.ELEMENT_NODE
                    ? record.target.closest?.(POPUP)
                    : null;
                if (parent) popups.add(parent);
                for (const node of record.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    if (node.matches(POPUP)) popups.add(node);
                    node.querySelectorAll?.(POPUP).forEach((popup) => popups.add(popup));
                }
            }
            popups.forEach(normalizePopup);
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-selected', 'aria-checked', 'aria-disabled', 'disabled', 'hidden'],
        });
        document.addEventListener('keydown', handleMenuKeyDown);
        return () => {
            observer.disconnect();
            document.removeEventListener('keydown', handleMenuKeyDown);
        };
    }, []);
}
