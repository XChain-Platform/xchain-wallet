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

const STORAGE_KEY = 'xc:balanceUnit';
const EVENT = 'xc:balance-unit-change';

function readAssetUnit() {
    try {
        if (typeof globalThis === 'undefined' || !globalThis.localStorage) return false;
        return globalThis.localStorage.getItem(STORAGE_KEY) === 'asset';
    } catch {
        return false;
    }
}

/** A device-wide fiat or asset-unit preference shared by balance heroes. */
export function useBalanceUnit() {
    const [assetUnit, setAssetUnit] = useState(readAssetUnit);

    useEffect(() => {
        const onCustom = (event) => setAssetUnit(event?.detail === 'asset');
        const onStorage = (event) => {
            if (event.key === STORAGE_KEY) setAssetUnit(event.newValue === 'asset');
        };
        window.addEventListener(EVENT, onCustom);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(EVENT, onCustom);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const toggle = useCallback(() => {
        setAssetUnit((previous) => {
            const next = !previous;
            const stored = next ? 'asset' : 'fiat';
            try {
                globalThis.localStorage?.setItem(STORAGE_KEY, stored);
            } catch { /* storage may be blocked in some shells */ }
            const broadcast = () => {
                try {
                    window.dispatchEvent(new CustomEvent(EVENT, { detail: stored }));
                } catch { /* CustomEvent may be unavailable outside browsers */ }
            };
            if (typeof queueMicrotask === 'function') queueMicrotask(broadcast);
            else Promise.resolve().then(broadcast);
            return next;
        });
    }, []);

    return [assetUnit, toggle];
}
