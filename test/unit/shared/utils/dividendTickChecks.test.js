// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { explorerCoinCode } from '../../../../packages/core/src/registry/coinTicker.js';
import { bitcoinDescriptors } from '../../../../packages/core/src/registry/descriptors/bitcoin.js';
import {
    isNativeCoinTick,
    nativeCoinTickMessage,
    unknownTickMessage,
} from '../../../../packages/core/src/shared/utils/dividendTickChecks.js';

const bitcoinTestnet = bitcoinDescriptors.find(({ networkKind }) => networkKind === 'testnet');
const nativeCoin = { coinTicker: 'BTC', descriptor: bitcoinTestnet };

describe('isNativeCoinTick', () => {
    it.each([' btc ', '\tBtc\n', ' BTC '])('accepts the coin ticker regardless of case and whitespace: %s', (tick) => {
        expect(isNativeCoinTick(tick, nativeCoin)).toBe(true);
    });

    it('accepts the network form derived from a real chain descriptor', () => {
        const networkTick = explorerCoinCode(bitcoinTestnet);
        expect(networkTick).toBe('TBTC');
        expect(isNativeCoinTick(networkTick, nativeCoin)).toBe(true);
    });

    it('rejects an ordinary token ticker', () => {
        expect(isNativeCoinTick('XCHAIN', nativeCoin)).toBe(false);
    });

    it.each(['', '   ', null])('rejects an empty or null ticker: %s', (tick) => {
        expect(isNativeCoinTick(tick, nativeCoin)).toBe(false);
    });

    it('rejects a native ticker when coinTicker is missing', () => {
        expect(isNativeCoinTick('BTC', { descriptor: bitcoinTestnet })).toBe(false);
    });
});

describe('tick validation messages', () => {
    it('names the native coin and directs the user to an XChain token', () => {
        const message = nativeCoinTickMessage('BTC', 'Bitcoin');
        expect(message).toContain('BTC');
        expect(message).toContain('Bitcoin');
        expect(message).toContain('XChain token');
        expect(message).toMatch(/enter one of those/i);
    });

    it('identifies an unknown token on the selected chain', () => {
        expect(unknownTickMessage('FOO', 'Dogecoin'))
            .toBe('No token named FOO exists on Dogecoin.');
    });
});
