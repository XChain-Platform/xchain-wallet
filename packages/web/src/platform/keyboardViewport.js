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
    let fitted = false;

    const update = () => {
        const covered = keyboardHeight(win);
        if (covered > 0) {
            root.style.setProperty(
                '--xc-viewport-h',
                `calc(${Math.round(vv.height)}px - env(safe-area-inset-top, 0px))`,
            );
            root.setAttribute('data-xc-keyboard', 'open');
            fitted = true;
            if (win.scrollY !== 0 || vv.offsetTop !== 0) win.scrollTo(0, 0);
            // WebKit revealed the field against the full-height shell, before
            // it shrank; reveal it again inside the scroller that is left.
            const active = win.document.activeElement;
            if (active && active !== win.document.body) {
                win.requestAnimationFrame(() => revealInScroller(active, win));
            }
        } else if (fitted) {
            root.style.removeProperty('--xc-viewport-h');
            root.removeAttribute('data-xc-keyboard');
            fitted = false;
            if (win.scrollY !== 0) win.scrollTo(0, 0);
        }
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    win.addEventListener('scroll', update, { passive: true });
    return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
        win.removeEventListener('scroll', update);
        if (fitted) {
            root.style.removeProperty('--xc-viewport-h');
            root.removeAttribute('data-xc-keyboard');
        }
    };
}
