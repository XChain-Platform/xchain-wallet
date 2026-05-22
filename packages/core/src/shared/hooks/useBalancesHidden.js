// Persisted, app-wide "balances hidden" toggle. Reads from localStorage
// synchronously on first render so the hidden state restores without any
// flash of balance after a reload. Updates are broadcast same-tab via a
// CustomEvent and cross-tab via the standard `storage` event so every
// mounted component (Home hero, TokenDetail hero, BalanceList rows, …)
// stays in sync as the user toggles the eye anywhere.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'xc:balancesHidden';
const EVENT = 'xc:balances-hidden-change';

function readPersistedHidden() {
    if (typeof globalThis === 'undefined' || !globalThis.localStorage) return false;
    try {
        return globalThis.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * @returns {[boolean, () => void]} `[hidden, toggle]`
 */
export function useBalancesHidden() {
    const [hidden, setHidden] = useState(readPersistedHidden);

    useEffect(() => {
        const onCustom = (e) => setHidden(Boolean(e?.detail));
        const onStorage = (e) => {
            if (e.key === STORAGE_KEY) setHidden(e.newValue === '1');
        };
        window.addEventListener(EVENT, onCustom);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(EVENT, onCustom);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const toggle = useCallback(() => {
        setHidden((prev) => {
            const next = !prev;
            try {
                globalThis.localStorage?.setItem(STORAGE_KEY, next ? '1' : '0');
            } catch { /* storage may be blocked in some shells */ }
            // Defer the broadcast to a microtask so subscriber components
            // don't run their `setHidden` synchronously inside *this*
            // component's state-update reconciliation — React warns
            // "Cannot update a component while rendering a different
            // component" when those setStates happen during render.
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

    return [hidden, toggle];
}
