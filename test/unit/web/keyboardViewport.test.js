// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The iOS keyboard overlays the page. While it is up, the shell fits the
// visible height, the page pan is undone and the tab bar steps aside; when it
// goes, every override comes off. Android resizes the WebView itself, so a
// viewport that already agrees with the layout viewport changes nothing.

import { describe, it, expect, vi } from 'vitest';
import {
    installKeyboardViewport,
    keyboardHeight,
    revealInScroller,
    resizedForKeyboard,
} from '../../../packages/web/src/platform/keyboardViewport.js';

/** A window stand-in with a controllable visual viewport. */
function fakeWindow({ layoutH = 874, vvH = 874, scale = 1 } = {}) {
    const listeners = {};
    const winListeners = {};
    const docListeners = {};
    const style = new Map();
    const attrs = new Map();
    const vv = {
        height: vvH,
        scale,
        offsetTop: 0,
        addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
        removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    };
    const root = {
        clientHeight: layoutH,
        style: {
            setProperty: (k, v) => style.set(k, v),
            removeProperty: (k) => style.delete(k),
        },
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: (k) => attrs.delete(k),
    };
    const win = {
        innerHeight: layoutH,
        innerWidth: 402,
        scrollY: 0,
        visualViewport: vv,
        document: {
            documentElement: root,
            activeElement: null,
            body: {},
            addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
            removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter((f) => f !== fn); },
        },
        scrollTo: vi.fn(function scrollTo() { win.scrollY = 0; }),
        requestAnimationFrame: (fn) => fn(),
        getComputedStyle: () => ({ overflowY: 'visible' }),
        addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); },
        removeEventListener: (t, fn) => { winListeners[t] = (winListeners[t] || []).filter((f) => f !== fn); },
    };
    const fire = (t) => (listeners[t] || []).forEach((fn) => fn());
    const fireDoc = (t) => (docListeners[t] || []).forEach((fn) => fn());
    return { win, vv, style, attrs, fire, fireDoc, listeners, winListeners, docListeners };
}

/** A focused text input, as the WebView would report it. */
const textInput = () => ({ tagName: 'INPUT', getAttribute: () => 'text', isContentEditable: false });

describe('Android: the WebView resizes for the keyboard', () => {
    it('hides the tab bar while a field has focus and the window has shrunk', () => {
        const { win, vv, attrs, fire, style } = fakeWindow({ layoutH: 760, vvH: 760 });
        const stop = installKeyboardViewport(win);
        win.document.activeElement = textInput();
        win.innerHeight = 420;
        vv.height = 420;
        win.document.documentElement.clientHeight = 420;
        fire('resize');
        expect(attrs.get('data-xc-keyboard')).toBe('open');
        // The WebView already fitted the shell; the height override stays off.
        expect(style.has('--xc-viewport-h')).toBe(false);
        win.innerHeight = 760;
        vv.height = 760;
        win.document.documentElement.clientHeight = 760;
        fire('resize');
        expect(attrs.has('data-xc-keyboard')).toBe(false);
        stop();
    });

    it('shows the tab bar again when focus leaves the field with the window still short', () => {
        const { win, vv, attrs, fire, fireDoc } = fakeWindow({ layoutH: 760, vvH: 760 });
        installKeyboardViewport(win);
        win.document.activeElement = textInput();
        win.innerHeight = 420;
        vv.height = 420;
        win.document.documentElement.clientHeight = 420;
        fire('resize');
        win.document.activeElement = null;
        fireDoc('focusout');
        expect(attrs.has('data-xc-keyboard')).toBe(false);
    });

    it('reads a rotation as a new full height, not a keyboard', () => {
        const { win, vv, attrs, fire } = fakeWindow({ layoutH: 760, vvH: 760 });
        installKeyboardViewport(win);
        win.document.activeElement = textInput();
        win.innerWidth = 760;
        win.innerHeight = 360;
        vv.height = 360;
        win.document.documentElement.clientHeight = 360;
        fire('resize');
        expect(attrs.has('data-xc-keyboard')).toBe(false);
    });

    it('treats checkboxes and buttons as no keyboard', () => {
        expect(resizedForKeyboard(420, 760, { tagName: 'INPUT', getAttribute: () => 'checkbox' })).toBe(false);
        expect(resizedForKeyboard(420, 760, { tagName: 'BUTTON', getAttribute: () => null })).toBe(false);
        expect(resizedForKeyboard(420, 760, { tagName: 'TEXTAREA', getAttribute: () => null })).toBe(true);
        expect(resizedForKeyboard(720, 760, textInput())).toBe(false);
    });
});

describe('keyboardHeight', () => {
    it('measures the keyboard against the layout viewport', () => {
        const { win } = fakeWindow({ layoutH: 874, vvH: 471 });
        expect(keyboardHeight(win)).toBe(403);
    });

    it('counts the accessory bar alone, which iOS reports with innerHeight shrunk too', () => {
        const { win } = fakeWindow({ layoutH: 874, vvH: 765 });
        win.innerHeight = 765;
        expect(keyboardHeight(win)).toBe(109);
    });

    it('reads a pinch zoom as no keyboard', () => {
        const { win } = fakeWindow({ layoutH: 874, vvH: 600, scale: 1.4 });
        expect(keyboardHeight(win)).toBe(0);
    });

    it('reads small chrome differences as no keyboard', () => {
        const { win } = fakeWindow({ layoutH: 874, vvH: 830 });
        expect(keyboardHeight(win)).toBe(0);
    });

    it('is 0 where there is no visualViewport', () => {
        expect(keyboardHeight({ document: { documentElement: { clientHeight: 800 } } })).toBe(0);
    });
});

describe('installKeyboardViewport', () => {
    it('fits the shell to the visible height, undoes the pan and marks the keyboard open', () => {
        const f = fakeWindow();
        installKeyboardViewport(f.win);
        f.vv.height = 471;
        f.win.scrollY = 108;
        f.fire('resize');
        expect(f.style.get('--xc-viewport-h')).toBe('calc(471px - env(safe-area-inset-top, 0px))');
        expect(f.attrs.get('data-xc-keyboard')).toBe('open');
        expect(f.win.scrollTo).toHaveBeenCalledWith(0, 0);
    });

    it('takes every override off when the keyboard goes', () => {
        const f = fakeWindow();
        installKeyboardViewport(f.win);
        f.vv.height = 471;
        f.fire('resize');
        f.vv.height = 874;
        f.fire('resize');
        expect(f.style.has('--xc-viewport-h')).toBe(false);
        expect(f.attrs.has('data-xc-keyboard')).toBe(false);
    });

    it('changes nothing where the WebView resizes for the keyboard (Android)', () => {
        const f = fakeWindow({ layoutH: 500, vvH: 500 });
        installKeyboardViewport(f.win);
        f.fire('resize');
        expect(f.style.size).toBe(0);
        expect(f.attrs.size).toBe(0);
        expect(f.win.scrollTo).not.toHaveBeenCalled();
    });

    it('stops listening when uninstalled and clears a fitted state', () => {
        const f = fakeWindow();
        const stop = installKeyboardViewport(f.win);
        f.vv.height = 471;
        f.fire('resize');
        stop();
        expect(f.style.has('--xc-viewport-h')).toBe(false);
        expect(f.listeners.resize).toEqual([]);
        expect(f.winListeners.scroll).toEqual([]);
    });
});

describe('revealInScroller', () => {
    function boxAt(top, bottom, overflowY, extra = {}) {
        return {
            overflowY,
            scrollTop: 0,
            scrollHeight: 1000,
            clientHeight: bottom - top,
            getBoundingClientRect: () => ({ top, bottom }),
            ...extra,
        };
    }

    it('moves only the nearest scrolling ancestor, never an overflow:hidden shell', () => {
        const shell = boxAt(0, 874, 'hidden');
        const scroller = boxAt(300, 470, 'auto', { parentElement: shell });
        const wrap = { parentElement: scroller };
        const field = { parentElement: wrap, getBoundingClientRect: () => ({ top: 440, bottom: 496 }) };
        const win = {
            document: { body: {} },
            getComputedStyle: (el) => ({ overflowY: el.overflowY || 'visible' }),
        };
        revealInScroller(field, win);
        expect(scroller.scrollTop).toBe(496 - 470 + 12);
        expect(shell.scrollTop).toBe(0);
    });

    it('scrolls up to a field hidden above the scroller top', () => {
        const scroller = boxAt(300, 470, 'auto');
        const field = { parentElement: scroller, getBoundingClientRect: () => ({ top: 280, bottom: 330 }) };
        scroller.scrollTop = 100;
        const win = { document: { body: {} }, getComputedStyle: (el) => ({ overflowY: el.overflowY || 'visible' }) };
        revealInScroller(field, win);
        expect(scroller.scrollTop).toBe(100 - (300 - 280 + 12));
    });

    it('leaves a field that is already in view alone', () => {
        const scroller = boxAt(300, 470, 'auto');
        const field = { parentElement: scroller, getBoundingClientRect: () => ({ top: 350, bottom: 400 }) };
        const win = { document: { body: {} }, getComputedStyle: (el) => ({ overflowY: el.overflowY || 'visible' }) };
        revealInScroller(field, win);
        expect(scroller.scrollTop).toBe(0);
    });
});
