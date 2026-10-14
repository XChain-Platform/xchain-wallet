// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Returning to a screen puts its scroll offset and focus back where the user
// left them. A screen usually mounts with its list still loading, so an offset
// written at mount is clamped to the height rendered so far (scrolled to 1820,
// back at 822). The restore here keeps re-applying the offset while the
// content grows, for a bounded time, and stops for good the moment the user
// scrolls, taps or presses a key, so it never jumps under them.

/** Longest wait for the content to grow tall enough for the saved offset. */
export const RESTORE_WAIT_MS = 3000;

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
// Ancestors such as data-history-key name a row stably even when its text
// (a relative time, a balance) changes between visits.
const KEY_ATTRIBUTE = /^data-[\w-]*key$/;
const NAME_LIMIT = 160;
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

function accessibleName(el) {
    const name = el.getAttribute('aria-label') || el.textContent || '';
    return name.replace(/\s+/g, ' ').trim().slice(0, NAME_LIMIT);
}

function keyedAncestor(el, scroller) {
    for (let node = el; node && node !== scroller; node = node.parentElement) {
        for (const attr of node.attributes) {
            if (KEY_ATTRIBUTE.test(attr.name) && attr.value) return { node, attr: attr.name, value: attr.value };
        }
    }
    return null;
}

function attributeSelector(attr, value) {
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/["\\]/g, '\\$&');
    return `[${attr}="${escaped}"]`;
}

/**
 * Describes the control `el` sits in so the same control can be found again
 * after its screen remounts or swaps views.
 *
 * @param {Element | null} el
 * @param {Element} scroller
 * @returns {{ keyAttr: string | null, keyValue: string | null, tag: string, name: string | null, nth: number } | null}
 */
export function describeFocusTarget(el, scroller) {
    const target = el && typeof el.closest === 'function' ? el.closest(FOCUSABLE) : null;
    if (!target || target === scroller || !scroller.contains(target)) return null;
    const tag = target.tagName.toLowerCase();
    const keyed = keyedAncestor(target, scroller);
    const scope = keyed ? keyed.node : scroller;
    const name = keyed ? null : accessibleName(target);
    const peers = [...scope.querySelectorAll(tag)]
        .filter((node) => name == null || accessibleName(node) === name);
    const nth = peers.indexOf(target);
    if (nth < 0) return null;
    return { keyAttr: keyed?.attr ?? null, keyValue: keyed?.value ?? null, tag, name, nth };
}

/**
 * Finds the control a `describeFocusTarget` result names, if it has rendered.
 *
 * @param {ReturnType<typeof describeFocusTarget>} target
 * @param {Element} scroller
 * @returns {HTMLElement | null}
 */
export function findFocusTarget(target, scroller) {
    if (!target) return null;
    const scope = target.keyAttr
        ? scroller.querySelector(attributeSelector(target.keyAttr, target.keyValue))
        : scroller;
    if (!scope) return null;
    const peers = [...scope.querySelectorAll(target.tag)]
        .filter((node) => target.name == null || accessibleName(node) === target.name);
    return /** @type {HTMLElement | null} */ (peers[target.nth] ?? null);
}

/**
 * Focus nobody owns yet: nothing, the page, the scroller, a node that went
 * away with the previous view, the heading the shell focuses on every route
 * change, or the page header above the scroller (its Back button keeps focus
 * when Back swaps the view under it). Anything else was focused on purpose
 * and is left alone.
 */
function focusUnclaimed(doc, scroller, header) {
    const active = doc.activeElement;
    return !active
        || active === doc.body
        || active === scroller
        || !active.isConnected
        || /^H[1-6]$/.test(active.tagName)
        || Boolean(header && header.contains(active));
}

/**
 * Restores `scroller` to `saved.top` and refocuses `saved.focus`, waiting up
 * to `waitMs` for the content to render. Returns a handle whose `pending()`
 * says whether it is still waiting and whose `cancel()` stops it.
 *
 * @param {HTMLElement} scroller
 * @param {{ top: number, focus?: ReturnType<typeof describeFocusTarget> }} saved
 * @param {{ waitMs?: number, header?: Element | null, onSettle?: () => void }} [options]
 *   header: the page header above the scroller, whose focus may be taken
 */
export function restoreScrollView(scroller, saved, { waitMs = RESTORE_WAIT_MS, header = null, onSettle } = {}) {
    const doc = scroller.ownerDocument;
    const win = doc.defaultView;
    const top = Math.max(0, saved.top || 0);
    let scrollDone = false;
    let focusDone = !saved.focus;
    let settled = false;
    let cancelFrame = null;
    let timer = null;
    let resizeObserver = null;
    let mutationObserver = null;

    const reached = () => Math.abs(scroller.scrollTop - top) <= 1;

    const applyScroll = () => {
        if (scrollDone) return;
        if (!reached()) scroller.scrollTop = top;
        if (reached()) scrollDone = true;
    };

    const applyFocus = () => {
        if (focusDone) return;
        const target = findFocusTarget(saved.focus, scroller);
        if (!target) return;
        focusDone = true;
        if (focusUnclaimed(doc, scroller, header)) target.focus({ preventScroll: true });
    };

    const stop = () => {
        if (settled) return;
        settled = true;
        cancelFrame?.();
        if (timer != null) win.clearTimeout(timer);
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        doc.removeEventListener('wheel', onUserInput, true);
        doc.removeEventListener('touchstart', onUserInput, true);
        doc.removeEventListener('pointerdown', onUserInput, true);
        doc.removeEventListener('keydown', onKeyDown, true);
        onSettle?.();
    };

    const check = () => {
        cancelFrame = null;
        if (settled) return;
        applyScroll();
        applyFocus();
        if (scrollDone && focusDone) stop();
    };

    // One check per frame however many nodes a long list adds at once.
    const schedule = () => {
        if (settled || cancelFrame) return;
        if (typeof win.requestAnimationFrame === 'function') {
            const id = win.requestAnimationFrame(check);
            cancelFrame = () => win.cancelAnimationFrame(id);
        } else {
            const id = win.setTimeout(check, 0);
            cancelFrame = () => win.clearTimeout(id);
        }
    };

    function onUserInput() { stop(); }
    function onKeyDown(event) {
        if (!MODIFIER_KEYS.has(event.key)) stop();
    }

    applyScroll();
    // Focus waits a frame: the shell focuses the route heading in an effect
    // that runs after this one, and would take focus straight back.
    if (scrollDone && focusDone) {
        settled = true;
        onSettle?.();
        return { pending: () => false, cancel: () => {} };
    }

    doc.addEventListener('wheel', onUserInput, { capture: true, passive: true });
    doc.addEventListener('touchstart', onUserInput, { capture: true, passive: true });
    doc.addEventListener('pointerdown', onUserInput, true);
    doc.addEventListener('keydown', onKeyDown, true);

    // The scroller's own box keeps its size while its content grows, so watch
    // its children; the mutation observer picks up children added later.
    if (typeof win.ResizeObserver === 'function') {
        resizeObserver = new win.ResizeObserver(schedule);
        for (const child of scroller.children) resizeObserver.observe(child);
    }
    if (typeof win.MutationObserver === 'function') {
        mutationObserver = new win.MutationObserver((records) => {
            for (const record of records) {
                if (record.target !== scroller) continue;
                for (const node of record.addedNodes) {
                    if (node.nodeType === 1) resizeObserver?.observe(node);
                }
            }
            schedule();
        });
        mutationObserver.observe(scroller, { childList: true, subtree: true });
    }
    timer = win.setTimeout(stop, waitMs);
    schedule();

    return { pending: () => !settled, cancel: stop };
}
