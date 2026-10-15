// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * Where the toast stack sits. One place per layout: bottom-centre above the
 * tab bar when the phone bar is mounted, bottom-end when the side rail
 * replaces it. The stack never sits on the header, the tab bar, a screen's
 * pinned footer (form submit rows) or the control that has focus: it is
 * lifted inside the scrolling content area until it clears them.
 */

/** Screen.jsx gives the scrolling content area this id; the stack stays inside it. */
export const TOAST_CONTENT_ID = 'xc-main';

/** Breathing room between the stack and whatever it clears, in px. */
export const TOAST_CLEARANCE_PX = 8;

/**
 * A focused element at least this share of the window tall is a container
 * (a list, the content area itself), not a control the toast could hide.
 */
const CONTAINER_SHARE = 0.5;

function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * The resting corner for a toast stack: bottom-centre above the phone tab bar
 * while it is mounted (it publishes --xc-bottom-bar-h), bottom-end otherwise.
 *
 * @returns {'center' | 'end'}
 */
export function restingPlacement() {
    if (typeof document === 'undefined') return 'center';
    return document.documentElement.style.getPropertyValue('--xc-bottom-bar-h').trim() !== '' ? 'center' : 'end';
}

/**
 * How far (px) to move the stack up from its CSS resting place (negative
 * moves it down, never past the content area's bottom edge).
 *
 * The stack first clears the content area's bottom edge (a screen footer or
 * the tab bar sits below it). If it then covers the focused control, it moves
 * to just below that control when it fits above the bottom edge, else to just
 * above it when it fits below the header, else it stays put.
 *
 * @param {object} input
 * @param {{ top: number, bottom: number, left: number, right: number }} input.stack  the stack's rect at rest (lift 0)
 * @param {{ top: number, bottom: number } | null} input.content                     the scrolling content area's rect
 * @param {{ top: number, bottom: number, left: number, right: number, height: number, width: number } | null} input.focused
 * @param {number} input.windowHeight
 * @returns {number}
 */
export function toastLift({ stack, content, focused, windowHeight }) {
    const hasContent = Boolean(content && content.bottom > content.top);
    const floor = hasContent ? content.bottom - TOAST_CLEARANCE_PX : windowHeight;
    const ceiling = hasContent ? content.top : 0;
    const height = stack.bottom - stack.top;
    // Each placement is named by the stack's bottom edge.
    let bottom = Math.min(stack.bottom, floor);
    if (focused && focused.width > 0 && focused.height > 0
        && focused.height < windowHeight * CONTAINER_SHARE) {
        // A control the stack merely touches counts as covered: it keeps the
        // same clearance as the bottom edge. DOMRect fields are prototype
        // getters, so they are copied by name.
        const guarded = {
            left: focused.left,
            right: focused.right,
            top: focused.top - TOAST_CLEARANCE_PX,
            bottom: focused.bottom + TOAST_CLEARANCE_PX,
        };
        const at = (edge) => ({ left: stack.left, right: stack.right, top: edge - height, bottom: edge });
        if (overlaps(at(bottom), guarded)) {
            const below = focused.bottom + TOAST_CLEARANCE_PX + height;
            const above = focused.top - TOAST_CLEARANCE_PX;
            if (below <= floor) bottom = below;
            else if (above - height >= ceiling) bottom = above;
        }
    }
    return Math.round(stack.bottom - bottom);
}

/**
 * Measure the page and place the stack element. Safe to call often; it reads
 * layout once per call and only writes two custom properties and one data
 * attribute.
 *
 * @param {HTMLElement | null} stackEl
 */
export function placeToastStack(stackEl) {
    if (!stackEl || typeof document === 'undefined') return;
    const root = document.documentElement;
    stackEl.dataset.placement = restingPlacement();
    stackEl.style.setProperty('--xc-toast-lift', '0px');
    const stack = stackEl.getBoundingClientRect();
    if (stack.height <= 0) {
        root.style.removeProperty('--xc-toast-room');
        return;
    }
    const contentEl = document.getElementById(TOAST_CONTENT_ID);
    const content = contentEl ? contentEl.getBoundingClientRect() : null;
    const active = document.activeElement;
    const focused = active && active !== document.body && active !== contentEl && !stackEl.contains(active)
        ? active.getBoundingClientRect()
        : null;
    const lift = toastLift({
        stack,
        content,
        focused,
        windowHeight: window.innerHeight || root.clientHeight || 0,
    });
    stackEl.style.setProperty('--xc-toast-lift', `${lift}px`);
    // Scroll room under the last row of content, so anything the stack sits
    // over can be scrolled clear of it while it shows.
    root.style.setProperty('--xc-toast-room', `${Math.round(stack.height + TOAST_CLEARANCE_PX)}px`);
}

/** Drop the page-level scroll room (the stack emptied or unmounted). */
export function clearToastRoom() {
    if (typeof document === 'undefined') return;
    document.documentElement.style.removeProperty('--xc-toast-room');
}
