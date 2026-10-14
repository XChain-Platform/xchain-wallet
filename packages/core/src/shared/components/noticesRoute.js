// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { createContext, useContext, useLayoutEffect } from 'react';

/**
 * The current route key, provided around the layout's notices so a notice
 * can close its own disclosures when the user navigates.
 */
export const NoticesRouteContext = createContext(/** @type {string | null} */ (null));

/**
 * The shell's notices, published by `<FullLayoutWithNav>` to the route's
 * `<Screen>`. The notices stay mounted at the layout (their state, polls and
 * live regions survive route changes) and render into one detached `host`
 * element; the outermost Screen moves that element into its scrolling body,
 * above the route content and below the page header.
 *
 * `claim(slot)` moves the host into `slot` and returns a release function.
 * Claims stack, so an overlay Screen mounted beside the route hands the
 * notices back to the route when it closes. With no claim the host sits in
 * the layout's fallback slot at the top of the route area.
 *
 * @typedef {{
 *   claim: (slot: HTMLElement) => () => void,
 *   setReachabilityHidden: (update: (count: number) => number) => void,
 * }} ShellNotices
 */
export const ShellNoticesContext = createContext(/** @type {ShellNotices | null} */ (null));

/** True below a Screen that already renders the shell notices. */
export const NoticesClaimedContext = createContext(false);

/** True while the current screen states the reachability problem itself. */
export const ReachabilityNoticeHiddenContext = createContext(false);

/**
 * Hides the shell's reachability notice while `active`, for a screen whose
 * own content already says its balances could not be checked, so the page
 * never carries the same message twice.
 *
 * @param {boolean} active
 */
export function useHideReachabilityNotice(active) {
    const shellNotices = useContext(ShellNoticesContext);
    const setHidden = shellNotices?.setReachabilityHidden;
    useLayoutEffect(() => {
        if (!active || !setHidden) return undefined;
        setHidden((count) => count + 1);
        return () => setHidden((count) => count - 1);
    }, [active, setHidden]);
}

/**
 * Component form of useHideReachabilityNotice, for a screen that decides
 * after its early returns, where a hook call is not allowed.
 *
 * @param {{ active?: boolean }} props
 */
export function HideReachabilityNotice({ active = true }) {
    useHideReachabilityNotice(active);
    return null;
}
