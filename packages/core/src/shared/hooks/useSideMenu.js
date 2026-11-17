// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The side menu's persisted display choice (G100): its state (collapsed,
// icons or full) and how far the user dragged the full menu past its
// default width. Same shape as useBalancesHidden and usePortfolioChartVisible,
// the wallet's other per-device display choices: one `xc:` localStorage key,
// read synchronously in the first render so a reload paints the saved state
// with no shift, and broadcast same-tab (CustomEvent) and cross-tab (the
// `storage` event) so every window agrees.
//
// The width is stored as the EXTRA pixels over the default, not as an
// absolute width. The default is whatever the widest row needs (CSS
// max-content), which moves with the language and the rows the wallet shows,
// so an absolute number would go stale; "default plus N, N at most 300"
// stays true whatever the default becomes.

import { createContext, useCallback, useEffect, useState } from 'react';

export const SIDE_MENU_STORAGE_KEY = 'xc:sideMenu';

/**
 * What FullLayoutWithNav hands the side menu it renders: the state on screen
 * (`icons` on the rail tier even when the saved choice is `full`), whether
 * the layout has room for the full menu, and the setter. Null outside the
 * layout, where LeftNav shows no state control.
 */
export const SideMenuContext = createContext(
    /** @type {{ state: 'icons'|'full', canShowNames: boolean, setState: (s: 'collapsed'|'icons'|'full') => void } | null} */ (null),
);
const EVENT = 'xc:side-menu-change';

/** The three states, narrowest first. */
export const SIDE_MENU_STATES = Object.freeze(['collapsed', 'icons', 'full']);

/** How far past its default width the full menu can be dragged. */
export const SIDE_MENU_MAX_EXTRA_PX = 300;

/** One arrow-key step on the resize edge; Shift takes four. */
export const SIDE_MENU_KEY_STEP_PX = 16;

/**
 * The route area never gets narrower than this because of a wide menu: it
 * is what the 640px rail tier has always left beside the 64px icon rail, so
 * every page already lays out in it.
 */
export const SIDE_MENU_MIN_CONTENT_PX = 576;

/** A drag this far left of the full menu's minimum drops it to icons. */
export const SIDE_MENU_SNAP_TO_ICONS_PX = 48;

/** The default width assumed where nothing can be measured (no layout engine). */
export const SIDE_MENU_FALLBACK_WIDTH_PX = 220;

// railOpen: the open state chosen on rail-width windows (an iPad), kept
// apart so a wide window's Full never widens the iPad's rail by itself.
const DEFAULT_PREFS = Object.freeze({ state: 'full', extra: 0, lastOpen: 'full', railOpen: 'icons' });

function isState(value) {
    return SIDE_MENU_STATES.includes(value);
}

/**
 * Clamp a dragged extra width to 0..max, whole pixels. Anything that is not
 * a finite number resets to the default width.
 *
 * @param {number} px
 * @param {number} [max]
 */
export function clampSideMenuExtra(px, max = SIDE_MENU_MAX_EXTRA_PX) {
    const value = Number(px);
    const ceiling = Math.max(0, Math.min(SIDE_MENU_MAX_EXTRA_PX, Number(max) || 0));
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(ceiling, Math.round(value)));
}

/**
 * The extra width the layout can give the menu right now: the saved extra,
 * less whatever would push the route area under SIDE_MENU_MIN_CONTENT_PX.
 * An unmeasured layout (0) applies no cap.
 *
 * @param {number} layoutWidth the whole shell's width
 * @param {number} defaultWidth the full menu's default (minimum) width
 */
export function sideMenuExtraCeiling(layoutWidth, defaultWidth) {
    if (!(layoutWidth > 0) || !(defaultWidth > 0)) return SIDE_MENU_MAX_EXTRA_PX;
    return clampSideMenuExtra(layoutWidth - SIDE_MENU_MIN_CONTENT_PX - defaultWidth);
}

/**
 * The next state one step narrower (-1) or wider (+1), clamped at the ends.
 * `widest` caps the walk where the layout cannot show the full menu (the
 * rail tier).
 *
 * @param {'collapsed'|'icons'|'full'} state
 * @param {-1|1} direction
 * @param {'icons'|'full'} [widest]
 */
export function stepSideMenuState(state, direction, widest = 'full') {
    const top = SIDE_MENU_STATES.indexOf(widest);
    const at = Math.min(SIDE_MENU_STATES.indexOf(isState(state) ? state : 'full'), top);
    const next = Math.max(0, Math.min(top, at + direction));
    return SIDE_MENU_STATES[next];
}

function normalize(raw) {
    const state = isState(raw?.state) ? raw.state : DEFAULT_PREFS.state;
    const lastOpen = raw?.lastOpen === 'icons' || raw?.lastOpen === 'full'
        ? raw.lastOpen
        : (state === 'collapsed' ? DEFAULT_PREFS.lastOpen : state);
    const railOpen = raw?.railOpen === 'full' ? 'full' : 'icons';
    return { state, extra: clampSideMenuExtra(raw?.extra ?? 0), lastOpen, railOpen };
}

/** @returns {{ state: 'collapsed'|'icons'|'full', extra: number, lastOpen: 'icons'|'full' }} */
export function readSideMenuPrefs() {
    try {
        const raw = globalThis.localStorage?.getItem(SIDE_MENU_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_PREFS };
        return normalize(JSON.parse(raw));
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

function writeSideMenuPrefs(prefs) {
    try {
        globalThis.localStorage?.setItem(SIDE_MENU_STORAGE_KEY, JSON.stringify(prefs));
    } catch { /* storage may be blocked in some shells */ }
    // Deferred, as useBalancesHidden does, so other mounts never update
    // inside this component's render.
    const broadcast = () => {
        try {
            window.dispatchEvent(new CustomEvent(EVENT, { detail: prefs }));
        } catch { /* CustomEvent unavailable in non-browser shells */ }
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(broadcast);
    else Promise.resolve().then(broadcast);
}

/**
 * @returns {{
 *   state: 'collapsed'|'icons'|'full',
 *   extra: number,
 *   lastOpen: 'icons'|'full',
 *   setState: (state: 'collapsed'|'icons'|'full') => void,
 *   toggleCollapsed: () => void,
 *   setExtra: (px: number) => void,
 *   resetWidth: () => void,
 * }}
 */
export function useSideMenu() {
    const [prefs, setPrefs] = useState(readSideMenuPrefs);

    useEffect(() => {
        const onCustom = (e) => setPrefs(normalize(e?.detail));
        const onStorage = (e) => {
            if (e.key === SIDE_MENU_STORAGE_KEY) setPrefs(readSideMenuPrefs());
        };
        window.addEventListener(EVENT, onCustom);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(EVENT, onCustom);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const update = useCallback((change) => {
        setPrefs((prev) => {
            const next = normalize({ ...prev, ...change(prev) });
            if (next.state === prev.state && next.extra === prev.extra && next.lastOpen === prev.lastOpen
                && next.railOpen === prev.railOpen) {
                return prev;
            }
            writeSideMenuPrefs(next);
            return next;
        });
    }, []);

    const setState = useCallback((state) => update(() => ({
        state,
        ...(state === 'collapsed' ? {} : { lastOpen: state }),
    })), [update]);
    const toggleCollapsed = useCallback(() => update((prev) => (
        prev.state === 'collapsed' ? { state: prev.lastOpen } : { state: 'collapsed', lastOpen: prev.state }
    )), [update]);
    const setRailOpen = useCallback((state) => update(() => ({ railOpen: state })), [update]);
    const setExtra = useCallback((px) => update(() => ({ extra: clampSideMenuExtra(px) })), [update]);
    const resetWidth = useCallback(() => update(() => ({ extra: 0 })), [update]);

    return { ...prefs, setState, setRailOpen, toggleCollapsed, setExtra, resetWidth };
}
