// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Fit the shell above the on-screen keyboard where the WebView does not.
//
// iOS (WKWebView and Safari) lays the keyboard OVER the page: the layout
// viewport keeps its full height and WebKit pans the whole document up to
// reveal the focused field. The shell is exactly one screen tall and does not
// scroll, so that pan slides the app header under the status bar and parks
// the field behind the page's own title bar (Send's address field on an
// iPhone 17 Pro simulator, 2026-10-12). Android's WebView resizes instead, so
// the keyboard height measured here is 0 there and this does nothing.
//
// While a keyboard covers the bottom of the screen, --xc-viewport-h becomes
// the visible height (less the top inset body pads by, as in tokens.css) and
// the pan is undone, so the header stays put and the route's own scroller
// brings the field into view inside the space that is left. The html element
// also carries data-xc-keyboard="open", which hides the bottom tab bar: with
// the app header and a page title bar above it, the bar left the field about
// 40pt of room on an iPhone 17 Pro.
//
// Android's WebView shrinks the window instead. The shell follows innerHeight
// explicitly because WebView 102 resolves 100vh against the screen behind the
// native system-bar padding: the bar is painted into the navigation bar while
// the accessibility tree is clipped at the WebView's visible bottom edge (LG
// K51, 2026-10-13). This Android-only override keeps the shell and its absolute
// bottom bar inside that edge. The focused-field check still hides the bar
// while the keyboard is open.

/**
 * Below this the difference is browser chrome settling, not a keyboard. The
 * smallest real case is the input accessory bar alone (a hardware keyboard
 * attached), about 109pt on an iPhone 17 Pro.
 */
const KEYBOARD_MIN_PX = 80;

/**
 * Height the keyboard covers, or 0 when there is none.
 *
 * Measured against the layout viewport (documentElement.clientHeight), not
 * innerHeight: with only the accessory bar showing, iOS shrinks innerHeight
 * together with the visual viewport, so the two agree while the page is
 * still panned. A pinch zoom also shrinks the visual viewport, so a scaled
 * viewport never counts as a keyboard.
 *
 * @param {{ document: { documentElement: { clientHeight: number } }, visualViewport?: { height: number, scale?: number } | null }} win
 * @returns {number}
 */
export function keyboardHeight(win) {
    const vv = win.visualViewport;
    if (!vv) return 0;
    if (typeof vv.scale === 'number' && Math.abs(vv.scale - 1) > 0.01) return 0;
    const covered = win.document.documentElement.clientHeight - vv.height;
    return covered >= KEYBOARD_MIN_PX ? Math.round(covered) : 0;
}

/**
 * True for an element the on-screen keyboard types into.
 *
 * @param {Element | null} el
 * @returns {boolean}
 */
export function isTextEntry(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
}

/**
 * Whether a resizing WebView (Android) has given up height to a keyboard:
 * a text field has focus and the window is at least KEYBOARD_MIN_PX shorter
 * than the tallest it has been at this width.
 *
 * @param {number} innerHeight
 * @param {number} fullHeight   tallest innerHeight seen at the current width
 * @param {Element | null} active
 * @returns {boolean}
 */
export function resizedForKeyboard(innerHeight, fullHeight, active) {
    return isTextEntry(active) && fullHeight - innerHeight >= KEYBOARD_MIN_PX;
}

/** Gap kept between a revealed field and its scroller's edge. */
const REVEAL_MARGIN_PX = 12;

/**
 * Scroll the nearest scrolling ancestor just far enough to show `el`.
 *
 * Not scrollIntoView: that also scrolls overflow:hidden ancestors, and the
 * shell is one, so it slid the app header out of view to reveal the command
 * palette's search field (iPhone 17 Pro simulator, 2026-10-12). Only a box
 * whose own overflow scrolls is moved here.
 *
 * @param {Element} el
 * @param {Window} win
 */
export function revealInScroller(el, win) {
    let box = el.parentElement;
    while (box && box !== win.document.body) {
        const overflowY = win.getComputedStyle(box).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && box.scrollHeight > box.clientHeight) break;
        box = box.parentElement;
    }
    if (!box || box === win.document.body) return;
    const field = el.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (field.bottom > view.bottom - REVEAL_MARGIN_PX) {
        box.scrollTop += field.bottom - view.bottom + REVEAL_MARGIN_PX;
    } else if (field.top < view.top + REVEAL_MARGIN_PX) {
        box.scrollTop -= view.top - field.top + REVEAL_MARGIN_PX;
    }
}

/**
 * Start following the keyboard. Returns a function that stops it.
 *
 * @param {Window} [win]
 * @returns {() => void}
 */
export function installKeyboardViewport(win = window) {
    const vv = win.visualViewport;
    if (!vv) return () => {};
    const root = win.document.documentElement;
    const isAndroid = win.Capacitor?.getPlatform?.() === 'android';
    let fitted = false;
    let resized = false;
    // Tallest window seen at the current width: a rotation changes both, a
    // keyboard only the height.
    let fullWidth = win.innerWidth;
    let fullHeight = win.innerHeight;

    const revealActive = () => {
        const active = win.document.activeElement;
        if (active && active !== win.document.body) {
            win.requestAnimationFrame(() => revealInScroller(active, win));
        }
    };

    const update = () => {
        if (isAndroid) {
            root.style.setProperty(
                '--xc-viewport-h',
                `calc(${Math.round(win.innerHeight)}px - env(safe-area-inset-top, 0px))`,
            );
        }
        if (win.innerWidth !== fullWidth) {
            fullWidth = win.innerWidth;
            fullHeight = win.innerHeight;
        } else if (win.innerHeight > fullHeight) {
            fullHeight = win.innerHeight;
        }
        const covered = keyboardHeight(win);
        if (covered === 0 && !fitted) {
            const open = resizedForKeyboard(win.innerHeight, fullHeight, win.document.activeElement);
            if (open !== resized) {
                resized = open;
                if (open) root.setAttribute('data-xc-keyboard', 'open');
                else root.removeAttribute('data-xc-keyboard');
            }
            if (open) revealActive();
            return;
        }
        if (covered > 0) {
            resized = false;
            root.style.setProperty(
                '--xc-viewport-h',
                `calc(${Math.round(vv.height)}px - env(safe-area-inset-top, 0px))`,
            );
            root.setAttribute('data-xc-keyboard', 'open');
            fitted = true;
            if (win.scrollY !== 0 || vv.offsetTop !== 0) win.scrollTo(0, 0);
            // WebKit revealed the field against the full-height shell, before
            // it shrank; reveal it again inside the scroller that is left.
            revealActive();
        } else if (fitted) {
            if (!isAndroid) root.style.removeProperty('--xc-viewport-h');
            root.removeAttribute('data-xc-keyboard');
            fitted = false;
            if (win.scrollY !== 0) win.scrollTo(0, 0);
        }
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    if (isAndroid) win.addEventListener('resize', update);
    win.addEventListener('scroll', update, { passive: true });
    // Focus moving off a field with the keyboard still up (or onto one after
    // the resize) changes the answer without a resize event.
    win.document.addEventListener('focusin', update);
    win.document.addEventListener('focusout', update);
    if (isAndroid) update();
    return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
        if (isAndroid) win.removeEventListener('resize', update);
        win.removeEventListener('scroll', update);
        win.document.removeEventListener('focusin', update);
        win.document.removeEventListener('focusout', update);
        if (resized) root.removeAttribute('data-xc-keyboard');
        if (fitted || isAndroid) {
            root.style.removeProperty('--xc-viewport-h');
        }
        if (fitted) {
            root.removeAttribute('data-xc-keyboard');
        }
    };
}
