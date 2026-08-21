// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The fee DISPLAY unit derives from the descriptor's declared
// feeStrategy.unit (registry/validate.js FEE_UNITS), not from a coin-name
// check. Before this, Send.jsx read `desc.coin === 'dogecoin' ? 'DOGE/kB' :
// 'sat/vB'` and the converters branched on the literal 'DOGE/kB', so the
// registry's validated unit was dead: a custom or remote-synced descriptor
// declaring sats-per-kbyte under a non-dogecoin coin rendered as sat/vB and
// misconverted custom rates by 100,000x. These pin the invariant that
// Dogecoin's on-screen behaviour is byte-identical, and that the unit now
// follows the descriptor.

import { describe, it, expect } from 'vitest';
import { ChainRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import {
    resolveFeeUnit,
    isPerKbUnit,
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    settingsCustomToDisplayRate,
    displayRateToSettingsCustom,
} from '../../../packages/core/src/flows/feeEstimate.js';

describe('resolveFeeUnit', () => {
    it('maps the bundled descriptors exactly as the old coin-name check did', () => {
        const reg = new ChainRegistry();
        for (const d of reg.supportedChains()) {
            const legacy = d.coin === 'dogecoin' ? 'DOGE/kB' : 'sat/vB';
            expect(resolveFeeUnit(d)).toBe(legacy);
        }
    });

    it('follows feeStrategy.unit, not the coin name', () => {
        const ltc = BUNDLED_DESCRIPTORS.find((d) => d.id === 'litecoin-regtest');
        const perKbLtc = { ...ltc, feeStrategy: { ...ltc.feeStrategy, unit: 'sats-per-kbyte' } };
        expect(resolveFeeUnit(perKbLtc)).toBe('LTC/kB');
        const doge = BUNDLED_DESCRIPTORS.find((d) => d.id === 'dogecoin-regtest');
        const perVbDoge = { ...doge, feeStrategy: { ...doge.feeStrategy, unit: 'sats-per-vbyte' } };
        expect(resolveFeeUnit(perVbDoge)).toBe('sat/vB');
        expect(resolveFeeUnit(null)).toBe('sat/vB');
        expect(resolveFeeUnit({ coin: 'xcforke2e' })).toBe('sat/vB');
    });

    it('isPerKbUnit recognises any ticker/kB display unit and nothing else', () => {
        expect(isPerKbUnit('DOGE/kB')).toBe(true);
        expect(isPerKbUnit('LTC/kB')).toBe(true);
        expect(isPerKbUnit('sat/vB')).toBe(false);
        expect(isPerKbUnit(undefined)).toBe(false);
    });

    it('a bundled-coin descriptor re-declared as sats-per-kbyte converts per-kB end to end', () => {
        const ltc = BUNDLED_DESCRIPTORS.find((d) => d.id === 'litecoin-regtest');
        const reg = new ChainRegistry();
        reg.applyRemoteDescriptors([{ ...ltc, feeStrategy: { ...ltc.feeStrategy, unit: 'sats-per-kbyte' } }]);
        const tiers = estimateNativeSendFeeTiers({ chainId: 'litecoin-regtest', chainRegistry: reg });
        expect(tiers.unit).toBe('LTC/kB');
        expect(tiers.normal.unit).toBe('LTC/kB');
        expect(tiers.normal.rate).toMatch(/ LTC\/kB$/);
        // 1 LTC/kB typed by the user is 1e8 sats/kB in settings, not 1000.
        expect(displayRateToSettingsCustom(tiers.unit, 1)).toBe(100_000_000);
        expect(settingsCustomToDisplayRate(tiers.unit, 100_000_000)).toBe(1);
        const custom = customFeeEstimate({ chainId: 'litecoin-regtest', chainRegistry: reg, rate: 1 });
        expect(custom.unit).toBe('LTC/kB');
        // 1 LTC/kB over a 250-byte tx = 0.25 LTC = 25_000_000 sats.
        expect(custom.sats).toBe(25_000_000);
    });

    it('Dogecoin is unchanged: DOGE/kB display, per-kB conversion', () => {
        const reg = new ChainRegistry();
        const est = estimateNativeSendFee({ chainId: 'dogecoin-mainnet', chainRegistry: reg, speed: 'normal' });
        expect(est.unit).toBe('DOGE/kB');
        expect(est.rate).toBe('1 DOGE/kB');
        expect(est.rateValue).toBe(1);
    });
});
