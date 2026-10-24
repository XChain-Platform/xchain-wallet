// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { cameraRequests } from '@xchain-wallet/core/ui/cameraRequest.js';

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

function isNativeShell() {
    const cap = /** @type {any} */ (globalThis).Capacitor;
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

/**
 * Connects Capacitor's authoritative active state to the shared idle timer.
 * Initial and duplicate active notifications are ignored, so one background
 * cycle produces at most one lock check and one unlocked resume refresh.
 *
 * A pause while a camera request is waiting is the system permission dialog
 * opening over the app, so the screen stays as it is (no cover, no
 * navigation) to show the answer. If the page then turns hidden, the user
 * left the app from the dialog, and the background runs at that point.
 *
 * @param {object} opts
 * @param {() => boolean} opts.checkAutoLock
 * @param {() => void} opts.onBackground
 * @param {() => void} opts.onUnlockedResume
 * @param {string} [opts.sessionState]
 * @returns {boolean} whether private app content must stay covered
 */
export function useNativeAppLifecycle({
    checkAutoLock,
    onBackground,
    onUnlockedResume,
    sessionState = 'unlocked',
}) {
    const callbacksRef = useRef({ checkAutoLock, onBackground, onUnlockedResume });
    callbacksRef.current = { checkAutoLock, onBackground, onUnlockedResume };
    const [suspended, setSuspended] = useState(false);

    useEffect(() => {
        if (sessionState !== 'unlocked') setSuspended(false);
    }, [sessionState]);

    useEffect(() => {
        const plugin = appPlugin();
        if (!isNativeShell()) return undefined;
        let disposed = false;
        let inactive = false;
        // True while a pause is held for the camera permission dialog.
        let held = false;

        // `held` clears on resume; the page cannot turn hidden twice before it.
        const background = () => {
            setSuspended(true);
            callbacksRef.current.onBackground?.();
        };

        const onStateChange = ({ isActive } = {}) => {
            if (disposed) return;
            if (!isActive) {
                if (inactive) return;
                inactive = true;
                held = cameraRequests.pending > 0;
                if (!held) background();
                return;
            }
            if (!inactive) return;
            inactive = held = false;
            const locking = callbacksRef.current.checkAutoLock?.() === true;
            if (!locking) {
                callbacksRef.current.onUnlockedResume?.();
                setSuspended(false);
            }
        };

        const onPause = () => onStateChange({ isActive: false });
        const onResume = () => onStateChange({ isActive: true });
        const onVisibilityChange = () => {
            if (held && document.hidden) background();
        };
        document.addEventListener('pause', onPause);
        document.addEventListener('resume', onResume);
        document.addEventListener('visibilitychange', onVisibilityChange);

        let handle = null;
        if (plugin) {
            try {
                // A full App plugin exposes this event when available.
                // Capacitor's document events cover narrower plugin builds.
                handle = Promise.resolve(plugin.addListener('appStateChange', onStateChange))
                    .catch(() => null);
            } catch (_err) {
                handle = null;
            }
        }
        return () => {
            disposed = true;
            document.removeEventListener('pause', onPause);
            document.removeEventListener('resume', onResume);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            Promise.resolve(handle)
                .then((listener) => listener?.remove?.())
                .catch(() => { /* already removed */ });
        };
    }, []);

    return suspended;
}
