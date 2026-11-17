// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Whether wide Home's top section (the wallet value card and the allocation
// donut, G115) is collapsed, remembered on this device the way the side
// menu's state is (useSideMenu): one `xc:` localStorage key, read in the
// first render so a reload paints the saved state with no shift, and
// broadcast same-tab (CustomEvent) and cross-tab (the `storage` event) so
// every window agrees.

import { useCallback, useEffect, useState } from 'react';

export const HOME_TOP_STORAGE_KEY = 'xc:homeTop';
const EVENT = 'xc:home-top-change';

/** @returns {boolean} */
export function readHomeTopCollapsed() {
    try {
        const raw = globalThis.localStorage?.getItem(HOME_TOP_STORAGE_KEY);
        if (!raw) return false;
        return JSON.parse(raw)?.collapsed === true;
    } catch {
        return false;
    }
}

function writeHomeTopCollapsed(collapsed) {
    try {
        globalThis.localStorage?.setItem(HOME_TOP_STORAGE_KEY, JSON.stringify({ collapsed }));
    } catch { /* storage may be blocked in some shells */ }
    // Deferred, as useSideMenu does, so other mounts never update inside
    // this component's render.
    const broadcast = () => {
        try {
            window.dispatchEvent(new CustomEvent(EVENT, { detail: { collapsed } }));
        } catch { /* CustomEvent unavailable in non-browser shells */ }
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(broadcast);
    else Promise.resolve().then(broadcast);
}

/** @returns {{ collapsed: boolean, toggle: () => void, setCollapsed: (next: boolean) => void }} */
export function useHomeTopCollapsed() {
    const [collapsed, setState] = useState(readHomeTopCollapsed);

    useEffect(() => {
        const onCustom = (e) => setState(e?.detail?.collapsed === true);
        const onStorage = (e) => {
            if (e.key === HOME_TOP_STORAGE_KEY) setState(readHomeTopCollapsed());
        };
        window.addEventListener(EVENT, onCustom);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(EVENT, onCustom);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const setCollapsed = useCallback((next) => {
        const value = next === true;
        setState(value);
        writeHomeTopCollapsed(value);
    }, []);
    const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

    return { collapsed, toggle, setCollapsed };
}
