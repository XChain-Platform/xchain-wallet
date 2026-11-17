// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: seedSettingsForChains + the §36.6 resolution model. Seeding creates
// per-chain fee entries (their keys mark chains as configured) but copies NO
// default values into them: preference fields start null = "follow the
// current release's default", resolved at read time against the chain
// descriptor. Automatic donations are one wallet-wide setting (ruling
// 2026-11-14), so seeding a chain leaves them untouched.

import { describe, it, expect } from 'vitest';
import { seedSettingsForChains } from '../../../packages/core/src/flows/seedSettings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import {
    createDefaultSettings,
    resolveFeeConfig,
} from '../../../packages/core/src/schemas/settings.js';

const chainRegistry = defaultRegistry();

describe('seedSettingsForChains (§36.6 sparse per-chain entries)', () => {
    it('seeds fee entries with null preference fields and leaves donations wallet-wide', () => {
        const base = createDefaultSettings();
        const seeded = seedSettingsForChains(base, chainRegistry, [
            'bitcoin-mainnet',
            'litecoin-mainnet',
            'dogecoin-mainnet',
        ]);
        for (const cid of ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet']) {
            expect(seeded.fees[cid]).toEqual({
                strategy: null,
                customSatsPerKb: null,
                rbfByDefault: null,
            });
        }
        expect(seeded.ads).toBe(base.ads);
        expect(seeded.ads.perChain).toBeUndefined();
    });

    it('never overwrites an existing (user-tuned) per-chain entry', () => {
        const first = seedSettingsForChains(createDefaultSettings(), chainRegistry, ['dogecoin-mainnet']);
        const tuned = {
            ...first,
            fees: { 'dogecoin-mainnet': { ...first.fees['dogecoin-mainnet'], strategy: 'fast' } },
        };
        const reseeded = seedSettingsForChains(tuned, chainRegistry, ['dogecoin-mainnet']);
        expect(reseeded.fees['dogecoin-mainnet'].strategy).toBe('fast');
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
            { strategy: 'custom', customSatsPerKb: 4321, rbfByDefault: false },
            chainRegistry.get('bitcoin-mainnet'),
        );
        expect(r).toEqual({ strategy: 'custom', customSatsPerKb: 4321, rbfByDefault: false });
    });

    it('a stored rbfByDefault true is capped on a chain without RBF support', () => {
        const r = resolveFeeConfig(
            { strategy: 'custom', customSatsPerKb: 4321, rbfByDefault: true },
            chainRegistry.get('dogecoin-mainnet'),
        );
        expect(r).toEqual({ strategy: 'custom', customSatsPerKb: 4321, rbfByDefault: false });
        expect(resolveFeeConfig(undefined, chainRegistry.get('dogecoin-mainnet')).rbfByDefault).toBe(false);
        expect(resolveFeeConfig({ rbfByDefault: true }, chainRegistry.get('litecoin-mainnet')).rbfByDefault).toBe(true);
    });

    // A stale entry whose chain left the registry must agree with the fee-bump
    // flow and the Fees panel: no declared capability means no RBF.
    it('an entry with no descriptor, or no declared capability, resolves rbfByDefault false', () => {
        expect(resolveFeeConfig(undefined, undefined).rbfByDefault).toBe(false);
        expect(resolveFeeConfig({ rbfByDefault: true }, undefined).rbfByDefault).toBe(false);
        expect(resolveFeeConfig({ rbfByDefault: true }, { feeStrategy: { defaultStrategy: 'normal' } }).rbfByDefault)
            .toBe(false);
    });
});
