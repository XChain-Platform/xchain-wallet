// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Focus trap + background-inert utilities (§5.1).
//
// The confirm modal is a TRUE modal: Tab must cycle within it, focus
// returns to the invoker on close, and the background is `inert`. No
// focus-trap utility existed before this (NoticeModal only wired Escape),
// so this is the shared primitive every variant of the modal uses.
//
// Chromium (the Chrome extension, Electron desktop, and modern web
// targets) has native `inert`, so no shim is needed for the target
// runtimes.

import { useEffect, useRef } from 'react';

/** @type {object[]} */
const activeTraps = [];
// Keyed by document: a modal rendered into an iframe (the style guide's width
// frames) locks that frame's body, never the page around it.
const bodyScrollLocks = new WeakMap();
const inertLocks = new WeakMap();
const FOCUS_VISIBLE_FALLBACK_CLASS = 'xc-focus-visible-fallback';
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';

function installFocusVisibleFallback() {
    if (typeof document === 'undefined') return;
    try {
        if (globalThis.CSS?.supports?.('selector(:focus-visible)')) return;
    } catch { /* use the fallback when selector detection is unavailable */ }

    const root = document.documentElement;
    const eventTarget = document.defaultView || document;
    const useKeyboardModality = (event) => {
        if (event.metaKey || event.altKey || event.ctrlKey) return;
        root.classList.add(FOCUS_VISIBLE_FALLBACK_CLASS);
    };
    const usePointerModality = () => root.classList.remove(FOCUS_VISIBLE_FALLBACK_CLASS);

    eventTarget.addEventListener('keydown', useKeyboardModality, true);
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
        eventTarget.addEventListener(type, usePointerModality, true);
    }
}

installFocusVisibleFallback();

function lockBodyScroll(doc) {
    if (!doc?.body) return;
    const lock = bodyScrollLocks.get(doc);
    if (lock) {
        lock.count += 1;
        return;
    }
    bodyScrollLocks.set(doc, { count: 1, priorOverflow: doc.body.style.overflow });
    doc.body.style.overflow = 'hidden';
}

function unlockBodyScroll(doc) {
    const lock = doc && bodyScrollLocks.get(doc);
    if (!lock) return;
    lock.count -= 1;
    if (lock.count > 0) return;
    if (doc.body) doc.body.style.overflow = lock.priorOverflow;
    bodyScrollLocks.delete(doc);
}

function lockInert(element) {
    const lock = inertLocks.get(element);
    if (lock) {
        lock.count += 1;
        return;
    }
    inertLocks.set(element, { count: 1, hadInert: element.hasAttribute('inert') });
    element.setAttribute('inert', '');
}

function unlockInert(element) {
    const lock = inertLocks.get(element);
    if (!lock) return;
    lock.count -= 1;
    if (lock.count > 0) return;
    if (!lock.hadInert) element.removeAttribute('inert');
    inertLocks.delete(element);
}

function modalRootFor(element) {
    if (!element?.closest) return null;
    return element.closest(MODAL_SELECTOR);
}

function inertTargetsOutside(root) {
    const targets = [];
    let branch = root;
    while (branch?.parentElement) {
        const parent = branch.parentElement;
        const siblings = Array.from(parent.children);
        const branchIndex = siblings.indexOf(branch);
        for (let index = 0; index < siblings.length; index += 1) {
            const element = siblings[index];
            if (element === branch) continue;
            // A later modal is the active layer and must stay outside the
            // earlier modal's inert background.
            const containsLaterModal = index > branchIndex
                && (element.matches(MODAL_SELECTOR) || element.querySelector(MODAL_SELECTOR));
            if (!containsLaterModal) targets.push(element);
        }
        if (parent === document.body) break;
        branch = parent;
    }
    return targets;
}

/** Frames a disabled or inert opener is waited on before focus is handed back. */
const RESTORE_RETRY_FRAMES = 10;

const FOCUSABLE_SELECTOR = [
    'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(container) {
    if (!container) return [];
    // Exclude elements hidden via `hidden`/`inert`/aria-hidden. We do NOT
    // filter on offsetParent: it is null under jsdom (no layout) AND for
    // position:fixed elements, so it would drop legitimately-visible modal
    // controls. The modal never renders hidden focusables, so the selector +
    // hidden/inert checks are sufficient.
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
        if (el.hidden) return false;
        // tabindex=-1 opts a control out of the Tab order, so the trap skips it too.
        if (el.getAttribute('tabindex') === '-1') return false;
        if (el.closest('[inert]')) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        return true;
    });
}

// The element that held focus just before the current one took it. A dialog
// whose own button carries autoFocus has already stolen focus by the time its
// effect runs, so document.activeElement no longer names the control that
// opened it; this does.
let lastBlurred = null;
if (typeof document !== 'undefined') {
    document.addEventListener('focusout', (e) => { lastBlurred = e.target; }, true);
}

/**
 * The control that opened a dialog, or null when it was opened with focus on
 * the page itself (a shortcut key), where there is nothing to hand back to.
 */
function openerFor(container) {
    const active = document.activeElement;
    if (active && active !== document.body && !container.contains(active)) return active;
    const blurred = lastBlurred;
    if (active && container.contains(active) && blurred && blurred.isConnected
        && blurred !== document.body && !container.contains(blurred)) return blurred;
    return null;
}

function pageFocusTarget(closedLayer) {
    const available = (candidate) => candidate
        && candidate.isConnected
        && !closedLayer?.contains(candidate)
        && !candidate.closest('[inert]')
        && candidate.getAttribute('aria-hidden') !== 'true';
    const heading = Array.from(document.querySelectorAll(
        '#xc-main h1, main h1, [role="main"] h1',
    )).find(available);
    if (heading) return heading;
    return Array.from(document.querySelectorAll('#xc-main, main, [role="main"]'))
        .find(available) || null;
}

/**
 * Returns focus after a transient layer closes without overriding a route or
 * control that already claimed it. A removed opener falls back to the active
 * page heading, or its main region when the page has no heading.
 *
 * @param {HTMLElement | null} opener
 * @param {HTMLElement | null} [closedLayer]
 * @returns {boolean} whether focus moved
 */
export function restoreFocusAfterClose(opener, closedLayer = null) {
    const now = document.activeElement;
    const unclaimed = !now || now === document.body || !now.isConnected
        || Boolean(closedLayer?.contains(now));
    if (!unclaimed) return false;

    const target = opener?.isConnected ? opener : pageFocusTarget(closedLayer);
    if (!target || typeof target.focus !== 'function') return false;
    if (!target.matches(FOCUSABLE_SELECTOR) && !target.hasAttribute('tabindex')) {
        target.tabIndex = -1;
    }
    try {
        target.focus({ preventScroll: true });
        return document.activeElement === target;
    } catch {
        return false;
    }
}

/**
 * Trap Tab focus within `containerRef` while `active`. On activate, snapshots
 * the opener and moves focus to `initialFocusRef` (or the first focusable
 * descendant); on deactivate, returns focus to the opener unless something
 * else has already claimed it (a dialog that navigates away).
 *
 * `trap: false` keeps the focus move and the restore but leaves Tab alone for
 * a widget that owns Tab itself.
 *
 * @param {import('react').RefObject<HTMLElement>} containerRef
 * @param {{ active: boolean, initialFocusRef?: import('react').RefObject<HTMLElement>, restoreFocusRef?: import('react').RefObject<HTMLElement>, trap?: boolean }} opts
 */
export function useFocusTrap(containerRef, {
    active,
    initialFocusRef,
    restoreFocusRef,
    trap = true,
} = {}) {
    const previouslyFocused = useRef(null);

    useEffect(() => {
        if (!active) return undefined;
        const container = containerRef.current;
        if (!container) return undefined;

        const layer = {};
        activeTraps.push(layer);
        const ownerDoc = container.ownerDocument;
        lockBodyScroll(ownerDoc);
        const modalRoot = modalRootFor(container);
        const backgroundTargets = modalRoot ? inertTargetsOutside(modalRoot) : [];
        backgroundTargets.forEach(lockInert);

        previouslyFocused.current = restoreFocusRef?.current || openerFor(container);

        // Initial focus: the designated element (password / HW block) or the
        // first focusable descendant.
        const requestedInitial = initialFocusRef?.current;
        const firstFocusable = focusableWithin(container)[0];
        // A container ref keeps the dialog itself as the fallback only when
        // the dialog has no meaningful control to receive focus.
        const initial = requestedInitial === container
            ? (firstFocusable || container)
            : (requestedInitial || firstFocusable);
        if (container.contains(document.activeElement)) {
            // Already focused inside (an autoFocus control): leave it.
        } else if (initial && typeof initial.focus === 'function') {
            // Defer to after paint so the element is actually focusable.
            requestAnimationFrame(() => { try { initial.focus(); } catch { /* noop */ } });
        }

        const onKeyDown = (e) => {
            if (!trap || e.key !== 'Tab' || activeTraps[activeTraps.length - 1] !== layer) return;
            const focusables = focusableWithin(container);
            if (focusables.length === 0) { e.preventDefault(); return; }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const activeEl = document.activeElement;
            const activeIndex = focusables.indexOf(activeEl);
            if (e.shiftKey) {
                if (activeIndex <= 0) {
                    e.preventDefault();
                    last.focus();
                }
            } else if (activeIndex === -1 || activeEl === last) {
                e.preventDefault();
                first.focus();
            }
        };

        container.addEventListener('keydown', onKeyDown);
        return () => {
            container.removeEventListener('keydown', onKeyDown);
            const layerIndex = activeTraps.indexOf(layer);
            if (layerIndex !== -1) activeTraps.splice(layerIndex, 1);
            backgroundTargets.forEach(unlockInert);
            unlockBodyScroll(ownerDoc);
            const prev = previouslyFocused.current;
            // A caller often disables its opener while the dialog is pending
            // (a Delete button marked busy until the confirm settles), and the
            // browser refuses focus to a disabled or inert control, so the
            // hand-back fell to the page body. Such an opener is re-enabled in
            // an update just after the one that closes the dialog, so a
            // blocked opener is retried for a few frames. An opener the close
            // removed (the dialog's action navigated away) hands focus to the
            // new page's heading instead of leaving it on the body.
            const restore = (attempt) => {
                const now = document.activeElement;
                const unclaimed = !now || now === document.body || !now.isConnected || container.contains(now);
                if (!unclaimed) return;
                if (!prev || !prev.isConnected || typeof prev.focus !== 'function') {
                    restoreFocusAfterClose(null, container);
                    return;
                }
                const blocked = prev.disabled || prev.closest?.('[inert]');
                if (blocked && attempt < RESTORE_RETRY_FRAMES && typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => restore(attempt + 1));
                    return;
                }
                try { prev.focus(); } catch { /* noop */ }
            };
            restore(0);
        };
    }, [active, containerRef, initialFocusRef, restoreFocusRef, trap]);
}

/**
 * Mark every branch outside `modalRootRef` as `inert` while `active`, so the
 * background is unreachable by pointer, focus, or AT. Restores prior inert
 * state on deactivate.
 *
 * @param {import('react').RefObject<HTMLElement>} modalRootRef
 * @param {{ active: boolean }} opts
 */
export function useInertBackground(modalRootRef, { active } = {}) {
    useEffect(() => {
        if (!active) return undefined;
        const root = modalRootFor(modalRootRef.current) || modalRootRef.current;
        if (!root || !root.parentElement) return undefined;
        const targets = inertTargetsOutside(root);
        targets.forEach(lockInert);
        return () => targets.forEach(unlockInert);
    }, [active, modalRootRef]);
}
