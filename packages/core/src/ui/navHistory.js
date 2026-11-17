// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One navigation history per wallet shell: opening a page pushes it, Back pops
// it, so Back returns to the page the user came from. The top entry IS the view.
//
// Each entry keeps the item its page showed (which token, which account), so
// a pop reopens the same item even after a later page reused the shell's slot.
// Opening another item on the page already showing (token A, then token B)
// is a step of its own, so Back returns to the first item.
//
// A page opened from a navigation surface (the sidebar, the bottom bar, the
// menu, the command palette) is a root: the history starts over on it and its
// entry is marked root. A page opened from a click on another page is a push.
// The Back chevron shows only while the page on screen is not a root, so a
// page reached from another page always offers the way back to it, and the
// same page opened from the menu has nothing to go back to. The system Back
// gesture still pops a root page to Home.

import { createContext, createElement, useCallback, useLayoutEffect, useRef, useState } from 'react';

/** The page every history starts from and falls back to when nothing is left to pop. */
export const NAV_HOME = 'home';
/** Most entries kept; the oldest above Home drop first. */
export const NAV_HISTORY_LIMIT = 64;

/** @typedef {{ view: string, ctx: object | null, root?: true }} NavEntry */

/**
 * @param {string} view @param {object | null} [ctx] @param {boolean} [root]
 * @returns {NavEntry}
 */
const entry = (view, ctx = null, root = false) => (root ? { view, ctx, root: true } : { view, ctx });

const top = (stack) => stack[stack.length - 1];

/**
 * A fresh history showing `view` as a root page. Home is always the bottom
 * entry, so the system Back from any root page lands on Home.
 *
 * @param {string} [view]
 * @returns {NavEntry[]}
 */
export function createNavStack(view = NAV_HOME) {
    return view === NAV_HOME ? [entry(NAV_HOME, null, true)] : [entry(NAV_HOME, null, true), entry(view, null, true)];
}

/**
 * True when the page on screen was opened from another page, so the header
 * offers Back to it. A root page (Home, or any page opened from a navigation
 * surface) has nothing to go back to.
 *
 * @param {NavEntry[]} stack
 * @returns {boolean}
 */
export function canGoBackIn(stack) {
    return stack.length > 1 && !top(stack).root;
}

/**
 * What the shell tells PageHeader about its history: `canGoBack` is false on
 * a root page. Null outside a shell (onboarding, a bare render), where Back
 * shows whenever the screen gives it a handler.
 */
export const NavHistoryContext = createContext(/** @type {{ canGoBack: boolean } | null} */ (null));

const IN_PAGE = Object.freeze({ canGoBack: true });

/**
 * Wraps a whole screen component that a page shows in its own place (a
 * contract picker, a market's Trade form, an address picker): every header
 * inside it shows Back, since its Back closes it and returns to the page,
 * even when that page is a root.
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export function InPageScreen({ children }) {
    return createElement(NavHistoryContext.Provider, { value: IN_PAGE }, children);
}

/**
 * Open `view` on top of the history. `leavingCtx` is the item context of the
 * page being left, kept on its entry for the pop that returns to it. Opening
 * Home clears the history, since Home is the root every Back leads to.
 *
 * @param {NavEntry[]} stack
 * @param {string} view
 * @param {object | null} [leavingCtx]
 * @returns {NavEntry[]}
 */
export function pushView(stack, view, leavingCtx = null) {
    // Opening the page already on screen adds nothing to go back through.
    if (top(stack).view === view) return stack;
    if (view === NAV_HOME) return createNavStack(NAV_HOME);
    const { view: leaving, root } = top(stack);
    const next = stack.slice(0, -1);
    // Home shows no single item, so it keeps no context to restore. The page
    // left stays a root, so Back to it shows no chevron of its own.
    next.push(entry(leaving, leaving === NAV_HOME ? null : leavingCtx, root), entry(view));
    return withinLimit(next);
}

/** Keep Home at the bottom and drop the oldest pages above it. */
function withinLimit(next) {
    if (next.length > NAV_HISTORY_LIMIT) next.splice(1, next.length - NAV_HISTORY_LIMIT);
    return next;
}

/**
 * Open another item on the page already showing: the item being left keeps
 * its own entry, so Back returns to it on the same page.
 *
 * @param {NavEntry[]} stack
 * @param {object | null} leavingCtx
 * @returns {NavEntry[]}
 */
export function pushItem(stack, leavingCtx) {
    const { view, root } = top(stack);
    if (view === NAV_HOME) return stack;
    return withinLimit([...stack.slice(0, -1), entry(view, leavingCtx, root), entry(view)]);
}

/**
 * Go back one page. With nothing left to pop the user lands on Home.
 *
 * @param {NavEntry[]} stack
 * @returns {NavEntry[]}
 */
export function popView(stack) {
    if (stack.length > 1) return stack.slice(0, -1);
    return top(stack).view === NAV_HOME ? stack : createNavStack(NAV_HOME);
}

/**
 * Swap the current page for `view` without adding a step: redirects, and a
 * page that turns into another. Replacing with the page just below collapses
 * onto it, so the history never shows one page twice in a row. The new page
 * takes the old one's place, root or not.
 *
 * @param {NavEntry[]} stack
 * @param {string} view
 * @returns {NavEntry[]}
 */
export function replaceView(stack, view) {
    if (top(stack).view === view) return stack;
    if (view === NAV_HOME) return createNavStack(NAV_HOME);
    if (stack.length > 1 && stack[stack.length - 2].view === view) return stack.slice(0, -1);
    return [...stack.slice(0, -1), entry(view, null, top(stack).root)];
}

/**
 * Land on `view` after a form is done. If the user came through that page,
 * the history unwinds to it; otherwise the form is replaced by it. Either way
 * Back can never return into the form that was just submitted.
 *
 * @param {NavEntry[]} stack
 * @param {string} view
 * @returns {NavEntry[]}
 */
export function landView(stack, view) {
    // Already there: an earlier item of the same page below is not a landing.
    if (top(stack).view === view) return stack;
    for (let i = stack.length - 2; i >= 0; i -= 1) {
        if (stack[i].view === view) return stack.slice(0, i + 1);
    }
    return replaceView(stack, view);
}

/**
 * Follow a browser Back or Forward to `view`: a pop when it is the page
 * below, nothing when it is already showing, otherwise a push.
 *
 * @param {NavEntry[]} stack
 * @param {string} view
 * @param {object | null} [leavingCtx]
 * @returns {NavEntry[]}
 */
export function syncView(stack, view, leavingCtx = null) {
    if (top(stack).view === view) return stack;
    if (stack.length > 1 && stack[stack.length - 2].view === view) return popView(stack);
    return pushView(stack, view, leavingCtx);
}

/**
 * Keep only the pages `keep` accepts, plus Home at the bottom and the page on
 * screen. A wallet switch uses it: the old wallet's tokens and accounts leave
 * the history, while Settings and the wallet pages that led here stay.
 *
 * @param {NavEntry[]} stack
 * @param {(view: string) => boolean} keep
 * @returns {NavEntry[]}
 */
export function retainViews(stack, keep) {
    const last = stack.length - 1;
    const next = stack.filter((item, index) => index === 0 || index === last || keep(item.view));
    if (next.length === stack.length) return stack;
    // Two kept neighbours may now be the same page; show it once.
    return next.filter((item, index) => index === 0 || item.view !== next[index - 1].view);
}

/** Pages that do not belong to one wallet, so a wallet switch keeps them in the history. */
export const WALLET_SWITCH_KEEPS = Object.freeze(new Set([
    'settings',
    'connected-sites',
    'wallet-picker',
    'wallet-details',
    'wallet-rename',
    'wallet-phrase',
    'add-wallet',
]));

// The fields that name the item a detail page shows, read from the shell's
// page context. Amounts and rates on a ref change with every balance read, so
// only identity fields count.
const ITEM_FIELDS = Object.freeze({
    'token-detail': ['tokenDetailRef', ['chainId', 'tick']],
    'list-detail': ['listRef', ['chainId', 'actionIndex']],
    'dispenser-detail': ['dispenserRef', ['chainId', 'actionIndex']],
    'order-detail': ['orderRef', ['chainId', 'actionIndex']],
    // Edit and Cancel act on the order or swap their detail page shows.
    'edit-order': ['orderRef', ['chainId', 'actionIndex']],
    'cancel-order': ['orderRef', ['chainId', 'actionIndex']],
    'swap-detail': ['swapRef', ['chainId', 'actionIndex']],
    'edit-swap': ['swapRef', ['chainId', 'actionIndex']],
    'cancel-swap': ['swapRef', ['chainId', 'actionIndex']],
    market: ['activeMarket', ['chainId', 'tick1', 'tick2']],
    'contract-detail': ['contractRef', ['chainId', 'contractActionIndex']],
    'stake-detail': ['stakingRef', ['kind', 'chainId', 'address']],
    'governance-poll-detail': ['governanceRef', ['chainId', 'pollIndex']],
    'bet-market-detail': ['betRef', ['chainId', 'feedIndex']],
    'wallet-details': ['walletDetailsId', null],
    'account-details': ['accountDetailsId', null],
    'cosigner-detail': ['coSignerAccountId', null],
});

/**
 * Which item a page shows, from the shell's page context: a token, a list, a
 * wallet. Null for a page that shows no single item or has none yet.
 *
 * @param {string} view
 * @param {object | null} ctx
 * @returns {string | null}
 */
export function navItemKey(view, ctx) {
    // The Addresses list and one selected address share a route. Naming the
    // list too makes the first address selection a history step, so header and
    // hardware Back return to the list after any child action returns here.
    if (view === 'addresses') {
        const target = ctx?.addressDetailTarget;
        if (!target) return 'addresses:list';
        const id = target.record?.id || target.id;
        if (id != null && id !== '') return `addresses:id:${String(id)}`;
        return `addresses:value:${String(target.chainId || '')}:${String(target.address || '')}`;
    }
    const spec = ITEM_FIELDS[view];
    if (!spec || !ctx || typeof ctx !== 'object') return null;
    const [field, parts] = spec;
    const value = ctx[field];
    if (value == null || value === '') return null;
    if (!parts) return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
    if (typeof value !== 'object') return null;
    // Indexes arrive as numbers from one path and strings from another.
    return JSON.stringify(parts.map((part) => (value[part] == null ? null : String(value[part]))));
}

/**
 * The shell's navigation history as React state.
 *
 * `capture()` returns the item context of the page on screen (which token,
 * which account); `restore(ctx)` puts a returned-to page's context back. Both
 * may change identity on every render. Every action reads and writes the
 * history synchronously, so several calls in one handler see each other.
 *
 * `itemKey(view, ctx)` names the item a page shows (see `navItemKey`). With
 * it, a render that shows another item on the same page, with no history
 * step taken, adds a step for the item left; when the item shown is the one
 * on the entry just below (a browser Back between two items), it pops instead.
 *
 * @param {object} [opts]
 * @param {string} [opts.initialView]
 * @param {() => object | null} [opts.capture]
 * @param {(ctx: object) => void} [opts.restore]
 * @param {(view: string, ctx: object | null) => string | null} [opts.itemKey]
 */
export function useNavHistory({ initialView = NAV_HOME, capture, restore, itemKey } = {}) {
    const stackRef = useRef(/** @type {NavEntry[] | null} */ (null));
    if (stackRef.current === null) stackRef.current = createNavStack(initialView);
    const [stack, setStack] = useState(stackRef.current);
    const captureRef = useRef(capture);
    const restoreRef = useRef(restore);
    const itemKeyRef = useRef(itemKey);
    captureRef.current = capture;
    restoreRef.current = restore;
    itemKeyRef.current = itemKey;
    // Back steps taken (a Back, a landing that unwound), so the browser
    // history can follow them backwards; opening Home or a tab root is not one.
    const [backs, setBacks] = useState(0);
    // The history, item key and context the last render showed.
    const shownRef = useRef(/** @type {{ stack: NavEntry[], key: string | null, ctx: object | null } | null} */ (null));

    const commit = useCallback((next, { restoreTop = false } = {}) => {
        if (next === stackRef.current) return;
        stackRef.current = next;
        setStack(next);
        const ctx = top(next).ctx;
        if (restoreTop && ctx) restoreRef.current?.(ctx);
    }, []);

    // Runs after every render, once the shell has published the context of
    // what it shows. A history action in between replaced the stack, so only
    // an item change on an untouched history counts as a step.
    useLayoutEffect(() => {
        const keyOf = itemKeyRef.current;
        if (typeof keyOf !== 'function') return;
        const current = stackRef.current;
        const ctx = captureRef.current?.() ?? null;
        const { view } = top(current);
        const key = keyOf(view, ctx);
        const shown = shownRef.current;
        shownRef.current = { stack: current, key, ctx };
        if (!shown || shown.stack !== current || key === null || shown.key === null || shown.key === key) return;
        const below = current.length > 1 ? current[current.length - 2] : null;
        const next = below && below.view === view && keyOf(view, below.ctx) === key
            ? current.slice(0, -1)
            : pushItem(current, shown.ctx);
        commit(next);
        shownRef.current = { stack: stackRef.current, key, ctx };
    });

    const resolve = (viewOrUpdate) => (typeof viewOrUpdate === 'function'
        ? viewOrUpdate(top(stackRef.current).view)
        : viewOrUpdate);
    const valid = (view) => typeof view === 'string' && view.length > 0;

    /**
     * Open a page from a click on the page on screen: a push, so Back returns
     * to that page. Accepts a view or an updater of the current view, like a
     * state setter.
     */
    const navigate = useCallback((viewOrUpdate) => {
        const view = resolve(viewOrUpdate);
        if (!valid(view)) return;
        if (top(stackRef.current).view === view) return;
        commit(pushView(stackRef.current, view, captureRef.current?.() ?? null));
    }, [commit]);

    /** Back: return to the page the user came from, or Home when there is none. */
    const back = useCallback(() => {
        const current = stackRef.current;
        const next = popView(current);
        commit(next, { restoreTop: true });
        if (next !== current) setBacks((count) => count + 1);
    }, [commit]);

    /** Swap the current page without adding a Back step; the caller sets the new page's item. */
    const replace = useCallback((viewOrUpdate) => {
        const view = resolve(viewOrUpdate);
        if (!valid(view)) return;
        commit(replaceView(stackRef.current, view));
    }, [commit]);

    /** Finish a form on `view`, unwinding to it when the user came through it. */
    const land = useCallback((view) => {
        if (!valid(view)) return;
        const current = stackRef.current;
        const next = landView(current, view);
        commit(next, { restoreTop: true });
        // Unwinding keeps the entry landed on, so it is a Back step.
        if (next.length < current.length && top(next) === current[next.length - 1]) setBacks((count) => count + 1);
    }, [commit]);

    /** Start over on `view` as a root page: lock, unlock, a resume. */
    const reset = useCallback((view = NAV_HOME) => {
        if (!valid(view)) return;
        commit(createNavStack(view));
    }, [commit]);

    /**
     * Open a page from a navigation surface (sidebar, bottom bar, menu,
     * command palette): the history starts over on it, so it shows no Back.
     * It starts over even when the page is already showing, since a page
     * reached from another page and then picked from the menu is a root.
     */
    const navigateRoot = useCallback((viewOrUpdate) => {
        const view = resolve(viewOrUpdate);
        if (!valid(view)) return;
        commit(createNavStack(view));
    }, [commit]);

    /** Follow a browser Back or Forward that arrived at `view`. */
    const sync = useCallback((view) => {
        if (!valid(view)) return;
        const current = stackRef.current;
        if (top(current).view === view) return;
        const popping = current.length > 1 && current[current.length - 2].view === view;
        commit(syncView(current, view, captureRef.current?.() ?? null), { restoreTop: popping });
    }, [commit]);

    /** Drop every page `keep` refuses, keeping Home and the page on screen. */
    const retain = useCallback((keep) => {
        commit(retainViews(stackRef.current, keep));
    }, [commit]);

    /** True when `view` is the page directly below the current one. */
    const isPrevious = useCallback((view) => {
        const current = stackRef.current;
        return current.length > 1 && current[current.length - 2].view === view;
    }, []);

    return {
        view: top(stack).view,
        previousView: stack.length > 1 ? stack[stack.length - 2].view : null,
        depth: stack.length,
        canGoBack: canGoBackIn(stack),
        backs,
        navigate,
        navigateRoot,
        back,
        replace,
        land,
        reset,
        sync,
        retain,
        isPrevious,
    };
}
