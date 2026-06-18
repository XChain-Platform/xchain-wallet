// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Persisted, app-wide "show portfolio chart" toggle. Same shape as
// useBalancesHidden: localStorage-backed, broadcast same-tab via a
// CustomEvent and cross-tab via the `storage` event so every mount
// stays in sync. Default is true; the user clicks the chart icon in
// TotalBalanceHero to hide the PortfolioChart card, click again to
// bring it back.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'xc:portfolioChartVisible';
const EVENT = 'xc:portfolio-chart-visible-change';

function readPersistedVisible() {
    if (typeof globalThis === 'undefined' || !globalThis.localStorage) return true;
    try {
        const raw = globalThis.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return true;
        return raw === '1';
    } catch {
        return true;
    }
}

/**
 * @returns {[boolean, () => void]} `[visible, toggle]`
 */
export function usePortfolioChartVisible() {
    const [visible, setVisible] = useState(readPersistedVisible);

    useEffect(() => {
        const onCustom = (e) => setVisible(Boolean(e?.detail));
        const onStorage = (e) => {
            if (e.key === STORAGE_KEY) setVisible(e.newValue !== '0');
        };
        window.addEventListener(EVENT, onCustom);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(EVENT, onCustom);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const toggle = useCallback(() => {
        setVisible((prev) => {
            const next = !prev;
            try {
                globalThis.localStorage?.setItem(STORAGE_KEY, next ? '1' : '0');
            } catch { /* storage may be blocked in some shells */ }
            const broadcast = () => {
                try {
                    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
                } catch { /* CustomEvent unavailable in non-browser shells */ }
            };
            if (typeof queueMicrotask === 'function') queueMicrotask(broadcast);
            else Promise.resolve().then(broadcast);
            return next;
        });
    }, []);

    return [visible, toggle];
}
