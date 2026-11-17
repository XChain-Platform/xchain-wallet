// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

function hostFor(sdk) {
    return createBackgroundHost({
        vault: {},
        chainRegistry: {},
        sdkRegistry: { get: vi.fn(() => sdk) },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

const request = (chainId = 'dogecoin-mainnet') => ({
    type: 'sdk.estimateFee',
    request: { chainId },
});

describe('sdk.estimateFee', () => {
    it('maps the SDK low, medium and high tiers to the wallet contract', async () => {
        const getFeeTiers = vi.fn(async () => ({ low: 1_003, medium: 2_000, high: 50_880 }));

        const response = await hostFor({ getFeeTiers }).handle(request());

        expect(response).toEqual({
            ok: true,
            result: {
                low: { rate: 1_003 },
                normal: { rate: 2_000 },
                fast: { rate: 50_880 },
            },
        });
        expect(getFeeTiers).toHaveBeenCalledOnce();
    });

    it('uses an encoder client fallback and keeps partial valid tiers', async () => {
        const getFeeTiers = vi.fn(async () => ({ low: 1_000, medium: 0, high: Number.NaN }));

        const response = await hostFor({ encoder: { getFeeTiers } }).handle(request());

        expect(response).toEqual({ ok: true, result: { low: { rate: 1_000 } } });
    });

    it('returns null when the encoder is unavailable or rejects', async () => {
        await expect(hostFor({}).handle(request())).resolves.toEqual({ ok: true, result: null });
        await expect(hostFor({
            getFeeTiers: vi.fn(async () => { throw new Error('offline'); }),
        }).handle(request())).resolves.toEqual({ ok: true, result: null });
    });

    it('rejects a missing chain id before reading the SDK', async () => {
        const response = await hostFor({ getFeeTiers: vi.fn() }).handle(request(''));

        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/chainId is required/);
    });
});
