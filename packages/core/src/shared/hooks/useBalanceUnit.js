// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useState } from 'react';

const PREFERENCES = Object.freeze({
    home: Object.freeze({
        storageKey: 'xc:balanceUnit',
        eventName: 'xc:balance-unit-change',
    }),
    asset: Object.freeze({
        storageKey: 'xc:assetBalanceUnit',
        eventName: 'xc:asset-balance-unit-change',
    }),
});

function readAssetUnit(storageKey) {
    try {
        if (typeof globalThis === 'undefined' || !globalThis.localStorage) return false;
        return globalThis.localStorage.getItem(storageKey) === 'asset';
    } catch {
        return false;
    }
}

/**
 * A device-wide fiat or asset-unit preference within one hero family.
 * Home and asset-detail heroes are deliberately separate; asset details share
 * one preference across assets and across standalone and embedded surfaces.
 *
 * @param {'home' | 'asset'} [scope]
 */
export function useBalanceUnit(scope = 'home') {
    const preference = scope === 'asset' ? PREFERENCES.asset : PREFERENCES.home;
    const { storageKey, eventName } = preference;
    const [assetUnit, setAssetUnit] = useState(() => readAssetUnit(storageKey));

    useEffect(() => {
        const onCustom = (event) => setAssetUnit(event?.detail === 'asset');
        const onStorage = (event) => {
            if (event.key === storageKey) setAssetUnit(event.newValue === 'asset');
        };
        window.addEventListener(eventName, onCustom);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(eventName, onCustom);
            window.removeEventListener('storage', onStorage);
        };
    }, [eventName, storageKey]);

    const toggle = useCallback(() => {
        setAssetUnit((previous) => {
            const next = !previous;
            const stored = next ? 'asset' : 'fiat';
            try {
                globalThis.localStorage?.setItem(storageKey, stored);
            } catch { /* storage may be blocked in some shells */ }
            const broadcast = () => {
                try {
                    window.dispatchEvent(new CustomEvent(eventName, { detail: stored }));
                } catch { /* CustomEvent may be unavailable outside browsers */ }
            };
            if (typeof queueMicrotask === 'function') queueMicrotask(broadcast);
            else Promise.resolve().then(broadcast);
            return next;
        });
    }, [eventName, storageKey]);

    return [assetUnit, toggle];
}
