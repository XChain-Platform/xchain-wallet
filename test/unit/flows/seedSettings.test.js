// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: seedSettingsForChains + the §36.1/§36.6 resolution model. Seeding
// creates per-chain entries (their keys mark chains as configured) but
// copies NO default values into them: preference fields start null =
// "follow the current release's default", resolved at read time against
// the chain descriptor. This pins the per-coin §36.1 donation amounts
// end-to-end against the real registry (a flat cross-coin number is
// wrong on at least two of the three coins), the fee resolution, and the
// idempotency guarantee that a user's tuned amounts survive re-seeding.

import { describe, it, expect } from 'vitest';
import { seedSettingsForChains } from '../../../packages/core/src/flows/seedSettings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import {
    ADS_DEFAULT_PER_TX_SATS,
    ADS_DEFAULT_TRIGGER_SATS,
    createDefaultSettings,
    resolveAdsChainConfig,
    resolveFeeConfig,
} from '../../../packages/core/src/schemas/settings.js';

const chainRegistry = defaultRegistry();

describe('seedSettingsForChains (§36.6 sparse per-chain entries)', () => {
    it('seeds entries with null preference fields and zeroed counters', () => {
        const seeded = seedSettingsForChains(createDefaultSettings(), chainRegistry, [
            'bitcoin-mainnet',
            'litecoin-mainnet',
            'dogecoin-mainnet',
        ]);
        for (const cid of ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet']) {
            expect(seeded.ads.perChain[cid]).toEqual({
                perTxAmountSats: null,
                triggerAmountSats: null,
                accumulatedSats: 0,
                lifetimeDonatedSats: 0,
                lifetimeTxCount: 0,
            });
            expect(seeded.fees[cid]).toEqual({
                strategy: null,
                customSatsPerKb: null,
                rbfByDefault: null,
            });
        }
    });

    it('never overwrites an existing (user-tuned) per-chain entry', () => {
        const first = seedSettingsForChains(createDefaultSettings(), chainRegistry, ['dogecoin-mainnet']);
        const tuned = {
            ...first,
            ads: {
                ...first.ads,
                perChain: {
                    'dogecoin-mainnet': { ...first.ads.perChain['dogecoin-mainnet'], perTxAmountSats: 42 },
                },
            },
        };
        const reseeded = seedSettingsForChains(tuned, chainRegistry, ['dogecoin-mainnet']);
        expect(reseeded.ads.perChain['dogecoin-mainnet'].perTxAmountSats).toBe(42);
    });
});

describe('resolveAdsChainConfig pins the §36.1 per-coin donation defaults', () => {
    const seededState = { perTxAmountSats: null, triggerAmountSats: null };

    it.each([
        ['bitcoin-mainnet', 1000, 25000],
        ['litecoin-mainnet', 100_000, 2_500_000],
        ['dogecoin-mainnet', 5_000_000, 125_000_000],
    ])('%s resolves to %i / %i', (cid, perTx, trigger) => {
        const r = resolveAdsChainConfig(seededState, chainRegistry.get(cid));
        expect(r.perTxAmountSats).toBe(perTx);
        expect(r.triggerAmountSats).toBe(trigger);
    });

    it('every network of a coin shares that coin\'s adsDefaults', () => {
        for (const cid of ['bitcoin-mainnet', 'bitcoin-testnet', 'bitcoin-regtest']) {
            const r = resolveAdsChainConfig(seededState, chainRegistry.get(cid));
            expect(r).toEqual({ perTxAmountSats: 1000, triggerAmountSats: 25000 });
        }
    });

    it('a stored number is a user override and wins over the descriptor', () => {
        const r = resolveAdsChainConfig(
            { perTxAmountSats: 7, triggerAmountSats: null },
            chainRegistry.get('dogecoin-mainnet'),
        );
        expect(r.perTxAmountSats).toBe(7);
        expect(r.triggerAmountSats).toBe(125_000_000); // other field still follows the default
    });

    it('falls back to the generic constants without a descriptor (user-added chains)', () => {
        const r = resolveAdsChainConfig(seededState, undefined);
        expect(r.perTxAmountSats).toBe(ADS_DEFAULT_PER_TX_SATS);
        expect(r.triggerAmountSats).toBe(ADS_DEFAULT_TRIGGER_SATS);
    });
});

describe('resolveFeeConfig follows the descriptor feeStrategy defaults', () => {
    const seededEntry = { strategy: null, customSatsPerKb: null, rbfByDefault: null };

    it('DOGE resolves rbfByDefault false, BTC/LTC true, all strategy normal', () => {
        expect(resolveFeeConfig(seededEntry, chainRegistry.get('dogecoin-mainnet')))
            .toEqual({ strategy: 'normal', customSatsPerKb: null, rbfByDefault: false });
        expect(resolveFeeConfig(seededEntry, chainRegistry.get('bitcoin-mainnet')))
            .toEqual({ strategy: 'normal', customSatsPerKb: null, rbfByDefault: true });
        expect(resolveFeeConfig(seededEntry, chainRegistry.get('litecoin-mainnet')))
            .toEqual({ strategy: 'normal', customSatsPerKb: null, rbfByDefault: true });
    });

    it('stored overrides win', () => {
        const r = resolveFeeConfig(
            { strategy: 'custom', customSatsPerKb: 4321, rbfByDefault: true },
            chainRegistry.get('dogecoin-mainnet'),
        );
        expect(r).toEqual({ strategy: 'custom', customSatsPerKb: 4321, rbfByDefault: true });
    });
});
