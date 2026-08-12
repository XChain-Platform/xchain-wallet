// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The explorer BASE is bare (no coin) by design; every consumer appends
// the coin path segment (explorerCoinCode). This locks that in and proves the
// mainnet URL is unchanged (the coin just moved from the base to the segment).

import { describe, it, expect } from 'vitest';
import { tickerForCoin, explorerCoinCode } from '../../../packages/core/src/registry/coinTicker.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

describe('explorerCoinCode', () => {
    it('maps coin+network to the platform coin path segment', () => {
        expect(explorerCoinCode({ coin: 'bitcoin', networkKind: 'mainnet' })).toBe('BTC');
        expect(explorerCoinCode({ coin: 'bitcoin', networkKind: 'testnet' })).toBe('TBTC');
        expect(explorerCoinCode({ coin: 'bitcoin', networkKind: 'regtest' })).toBe('RBTC');
        expect(explorerCoinCode({ coin: 'dogecoin', networkKind: 'regtest' })).toBe('RDOGE');
        expect(explorerCoinCode({ coin: 'litecoin', networkKind: 'mainnet' })).toBe('LTC');
    });

    it('returns empty for a missing descriptor or unknown network', () => {
        expect(explorerCoinCode(null)).toBe('');
        expect(explorerCoinCode({ coin: 'bitcoin', networkKind: 'nope' })).toBe('');
    });
});

describe('explorer descriptor bases are bare', () => {
    const reg = defaultRegistry();

    it('mainnet/testnet explorer bases carry NO coin segment', () => {
        for (const id of ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet',
            'bitcoin-testnet', 'litecoin-testnet', 'dogecoin-testnet']) {
            const d = reg.get(id);
            expect(d, id).toBeTruthy();
            expect(d.explorer.defaultUrl, id).toBe('https://explorer.xchain.io');
        }
    });

    it('the composed explorer URL is unchanged on mainnet (coin moved base -> segment)', () => {
        const d = reg.get('bitcoin-mainnet');
        const code = explorerCoinCode(d);
        // base (bare) + /{code} + /path == the historical coin-in-base URL.
        expect(`${d.explorer.defaultUrl}/${code}/api/status`)
            .toBe('https://explorer.xchain.io/BTC/api/status');
    });

    it('encoder/hub bases KEEP their coin segment (clients send verbatim)', () => {
        const d = reg.get('bitcoin-mainnet');
        expect(d.encoder.defaultUrl).toBe('https://encoder.xchain.io/BTC');
        expect(d.hub.defaultUrl).toBe('https://hub.xchain.io/BTC');
    });

    it('regtest composes a correct coin-scoped URL (was previously missing the coin)', () => {
        const d = reg.get('bitcoin-regtest');
        expect(`${d.explorer.defaultUrl}/${explorerCoinCode(d)}/address/x`)
            .toBe('http://localhost/RBTC/address/x');
        expect(tickerForCoin('bitcoin')).toBe('BTC');
    });
});
