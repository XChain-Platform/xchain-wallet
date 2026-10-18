// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Kept apart from noticesRoute.js, which the shell loads at startup, so only
// the screens that hide the notice carry this code.

import { useContext, useLayoutEffect } from 'react';
import { ShellNoticesContext } from './noticesRoute.js';

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
