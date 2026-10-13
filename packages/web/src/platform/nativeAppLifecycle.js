// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';

export function canApplyNativeIntent(sessionState, appSuspended) {
    return sessionState === 'unlocked' && !appSuspended;
}

/** @returns {Record<string, Function> | null} */
function appPlugin() {
    const cap = /** @type {any} */ (globalThis).Capacitor;
    if (!cap) return null;
    if (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform()) return null;
    const plugin = cap.Plugins?.App;
    return plugin && typeof plugin.addListener === 'function' ? plugin : null;
}

/**
 * Connects Capacitor's authoritative active state to the shared idle timer.
 * Initial and duplicate active notifications are ignored, so one background
 * cycle produces at most one lock check and one unlocked resume refresh.
 *
 * @param {object} opts
 * @param {() => boolean} opts.checkAutoLock
 * @param {() => void} opts.onBackground
 * @param {() => void} opts.onUnlockedResume
 */
export function useNativeAppLifecycle({ checkAutoLock, onBackground, onUnlockedResume }) {
    const callbacksRef = useRef({ checkAutoLock, onBackground, onUnlockedResume });
    callbacksRef.current = { checkAutoLock, onBackground, onUnlockedResume };

    useEffect(() => {
        const plugin = appPlugin();
        if (!plugin) return undefined;
        let disposed = false;
        let inactive = false;

        const onStateChange = ({ isActive } = {}) => {
            if (disposed) return;
            if (!isActive) {
                if (inactive) return;
                inactive = true;
                callbacksRef.current.onBackground?.();
                return;
            }
            if (!inactive) return;
            inactive = false;
            const locking = callbacksRef.current.checkAutoLock?.() === true;
            if (!locking) callbacksRef.current.onUnlockedResume?.();
        };

        let handle;
        try {
            handle = Promise.resolve(plugin.addListener('appStateChange', onStateChange))
                .catch(() => null);
        } catch (_err) {
            handle = null;
        }
        return () => {
            disposed = true;
            Promise.resolve(handle)
                .then((listener) => listener?.remove?.())
                .catch(() => { /* already removed */ });
        };
    }, []);
}
