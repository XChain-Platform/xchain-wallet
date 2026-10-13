// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';

/** Release a native launch splash without making browser startup depend on it. */
export function hideNativeSplash(capacitor = globalThis.Capacitor) {
    try {
        const result = capacitor?.Plugins?.SplashScreen?.hide?.();
        result?.catch?.(() => {});
    } catch { /* native chrome must never block shell startup */ }
}

/** Signals readiness only after React commits the application shell. */
export function NativeShellReady() {
    useEffect(() => {
        hideNativeSplash();
    }, []);
    return null;
}
