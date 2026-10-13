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

/**
 * Trap Tab focus within `containerRef` while `active`. On activate, snapshots
 * the opener and moves focus to `initialFocusRef` (or the first focusable
 * descendant); on deactivate, returns focus to the opener unless something
 * else has already claimed it (a dialog that navigates away).
 *
 * `trap: false` keeps the focus move and the restore but leaves Tab alone,
 * for a widget that owns Tab itself (the command palette's category jump).
 *
 * @param {import('react').RefObject<HTMLElement>} containerRef
 * @param {{ active: boolean, initialFocusRef?: import('react').RefObject<HTMLElement>, trap?: boolean }} opts
 */
export function useFocusTrap(containerRef, { active, initialFocusRef, trap = true } = {}) {
    const previouslyFocused = useRef(null);

    useEffect(() => {
        if (!active) return undefined;
        const container = containerRef.current;
        if (!container) return undefined;

        previouslyFocused.current = openerFor(container);

        // Initial focus: the designated element (password / HW block) or the
        // first focusable descendant.
        const initial = (initialFocusRef && initialFocusRef.current) || focusableWithin(container)[0];
        if (container.contains(document.activeElement)) {
            // Already focused inside (an autoFocus control): leave it.
        } else if (initial && typeof initial.focus === 'function') {
            // Defer to after paint so the element is actually focusable.
            requestAnimationFrame(() => { try { initial.focus(); } catch { /* noop */ } });
        }

        const onKeyDown = (e) => {
            if (!trap || e.key !== 'Tab') return;
            const focusables = focusableWithin(container);
            if (focusables.length === 0) { e.preventDefault(); return; }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const activeEl = document.activeElement;
            if (e.shiftKey) {
                if (activeEl === first || !container.contains(activeEl)) {
                    e.preventDefault();
                    last.focus();
                }
            } else if (activeEl === last || !container.contains(activeEl)) {
                e.preventDefault();
                first.focus();
            }
        };

        container.addEventListener('keydown', onKeyDown);
        return () => {
            container.removeEventListener('keydown', onKeyDown);
            const prev = previouslyFocused.current;
            const now = document.activeElement;
            const unclaimed = !now || now === document.body || !now.isConnected || container.contains(now);
            if (unclaimed && prev && prev.isConnected && typeof prev.focus === 'function') {
                try { prev.focus(); } catch { /* noop */ }
            }
        };
    }, [active, containerRef, initialFocusRef, trap]);
}

/**
 * Mark every sibling of `modalRootRef` as `inert` while `active`, so the
 * background is unreachable by pointer, focus, or AT. Restores prior inert
 * state on deactivate.
 *
 * @param {import('react').RefObject<HTMLElement>} modalRootRef
 * @param {{ active: boolean }} opts
 */
export function useInertBackground(modalRootRef, { active } = {}) {
    useEffect(() => {
        if (!active) return undefined;
        const root = modalRootRef.current;
        if (!root || !root.parentElement) return undefined;
        const siblings = Array.from(root.parentElement.children).filter((el) => el !== root);
        const prior = siblings.map((el) => el.hasAttribute('inert'));
        siblings.forEach((el) => el.setAttribute('inert', ''));
        return () => {
            siblings.forEach((el, i) => { if (!prior[i]) el.removeAttribute('inert'); });
        };
    }, [active, modalRootRef]);
}
