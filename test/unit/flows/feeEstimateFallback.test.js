// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { fetchNativeSendFeeTiers } from '../../../packages/core/src/flows/feeEstimate.js';

const registry = {
    get(chainId) {
        return chainId === 'bitcoin-mainnet'
            ? { coin: 'bitcoin', feeStrategy: { unit: 'sats-per-vbyte' } }
            : null;
    },
};

const fetchTiers = (estimateFee, timeoutMs = 20) => fetchNativeSendFeeTiers({
    messaging: { estimateFee },
    chainId: 'bitcoin-mainnet',
    chainRegistry: registry,
    timeoutMs,
});

describe('fee estimate source fallback', () => {
    it.each([
        ['rejects', async () => { throw new Error('rate limited'); }],
        ['returns a rate-limit response', async () => ({ status: 429, error: 'too many requests' })],
        ['returns unsafe rates', async () => ({
            low: { rate: 0 },
            normal: { rate: -1 },
            fast: { rate: Number.NaN },
        })],
    ])('uses safe defaults when the estimator %s', async (_label, estimateFee) => {
        const tiers = await fetchTiers(estimateFee);

        expect(tiers.normal.source).toBe('static-placeholder');
        expect(tiers.normal.rateValue).toBe(6);
        expect(tiers.normal.sats).toBe(1_500);
        expect(tiers.low.source).toBe('static-placeholder');
        expect(tiers.fast.source).toBe('static-placeholder');
    });

    it('settles on safe defaults when the estimator never responds', async () => {
        const pendingForever = () => new Promise(() => {});

        const tiers = await fetchTiers(pendingForever, 5);

        expect(tiers.normal.source).toBe('static-placeholder');
        expect(tiers.normal.rateValue).toBe(6);
    });
});
