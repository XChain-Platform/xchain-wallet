// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { isDemoWallet, isDemoWalletExpired } from '../../flows/demoMode.js';
import { useMessaging } from '../useMessaging.js';
import { exitDemoWallet } from '../utils/demoGraduation.js';

/**
 * Keeps demo expiry enforcement at the shell level without drawing a notice.
 * The visible countdown and manual exit remain in wallet management.
 *
 * @param {string | null | undefined} walletId
 * @param {() => void} [onExited]
 */
export function useDemoAutoWipe(walletId, onExited) {
    const { messaging } = useMessaging();
    const exitInFlight = useRef(false);

    useEffect(() => {
        if (!isDemoWallet(walletId)) return undefined;
        let active = true;

        const tick = async () => {
            if (!active || exitInFlight.current || !isDemoWalletExpired()) return;
            exitInFlight.current = true;
            try {
                const { reloaded } = await exitDemoWallet({ messaging, walletId });
                if (active && !reloaded && typeof onExited === 'function') onExited();
            } catch {
                // A later tick retries while the shell stays open.
            } finally {
                exitInFlight.current = false;
            }
        };

        void tick();
        const interval = setInterval(tick, 60_000);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [messaging, onExited, walletId]);
}
