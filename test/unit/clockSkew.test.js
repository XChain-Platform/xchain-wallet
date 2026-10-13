// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { clockSafeElapsed } from '../../packages/core/src/shared/hooks/useAutoLock.js';
import { createPriceOracle } from '../../packages/core/src/flows/priceOracle.js';
import { getRemainingMs } from '../../packages/core/src/flows/lockoutTracking.js';
import {
    checkUnlockAllowed,
    recordFailure,
} from '../../packages/extension/src/background/unlockThrottle.js';
import { formatRelativeTime } from '../../packages/core/src/shared/utils/dateTime.js';
import { isResumable } from '../../packages/core/src/flows/confirmResume.js';

function response(data) {
    return {
        ok: true,
        status: 200,
        json: vi.fn(async () => data),
    };
}

describe('device clock skew', () => {
    it('uses monotonic idle time across multi-hour wall-clock corrections', () => {
        const hour = 60 * 60 * 1000;

        expect(clockSafeElapsed(1_000, 500, 1_000 + 12 * hour, 30_500)).toBe(30_000);
        expect(clockSafeElapsed(1_000 + 12 * hour, 500, 1_000, 30_500)).toBe(30_000);
        expect(clockSafeElapsed(1_000, 500, 61_000, 60_500)).toBe(60_000);
    });

    it('refreshes price caches after the wall clock moves behind their stamps', async () => {
        let now = 10 * 60 * 1000;
        let price = 60_000;
        const fetch = vi.fn(async (url) => response(url.includes('/market_chart')
            ? { prices: [[1, price]] }
            : { bitcoin: { usd: price } }));
        const oracle = createPriceOracle({ fetch, now: () => now });
        const request = { chainIds: ['bitcoin-mainnet'], includeSparkline: true };

        await oracle.getNativePrices(request);
        now -= 24 * 60 * 60 * 1000;
        price = 61_000;
        const refreshed = await oracle.getNativePrices(request);

        expect(fetch).toHaveBeenCalledTimes(4);
        expect(refreshed.prices['bitcoin-mainnet'].priceFiat).toBe(61_000);
        expect(refreshed.prices['bitcoin-mainnet'].sparkline).toEqual([61_000]);
    });

    it('does not extend password throttles when the wall clock moves backward', () => {
        const createdAt = 24 * 60 * 60 * 1000;
        const background = recordFailure({ failCount: 2, lockedUntil: 0 }, createdAt);
        const renderer = {
            failedAttempts: background.failCount,
            lockedUntilMs: background.lockedUntil,
        };

        expect(checkUnlockAllowed(background, createdAt)).toEqual({
            allowed: false,
            retryAfterMs: 5_000,
        });
        expect(getRemainingMs(renderer, createdAt)).toBe(5_000);

        const dayEarlier = createdAt - 24 * 60 * 60 * 1000;
        expect(checkUnlockAllowed(background, dayEarlier)).toEqual({ allowed: true });
        expect(getRemainingMs(renderer, dayEarlier)).toBe(0);
    });

    it('keeps future relative and resumable timestamps safe under a slow clock', () => {
        const now = 1_700_000_000_000;
        expect(formatRelativeTime(now + 24 * 60 * 60 * 1000, now)).toBe('just now');
        expect(isResumable({
            id: 'clock-skew',
            createdAt: now + 24 * 60 * 60 * 1000,
            composed: { psbt: 'psbt' },
            dispatch: { software: 'sendToken', base: {} },
        }, now)).toBe(true);
    });
});
