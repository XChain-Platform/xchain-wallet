// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the wallet's copy of the indexer's fee-payment rule
// (xchain-indexer/src/utility.js detectFeePaymentMode). Getting this wrong in
// either direction is expensive: answering false on LTC/DOGE composes actions
// the chain rejects for `insufficient fee (native coin output required)` after
// the miner fee is spent, and answering true on BTC spends real coin on a fee
// that an XCHAIN balance would have covered.

import { describe, it, expect } from 'vitest';
import {
    isNativeFeeMandatory,
    nativeFeeTickerFor,
    protocolCoinTickerFor,
} from '../../../packages/core/src/registry/nativeFee.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

describe('isNativeFeeMandatory', () => {
    it('is false on Bitcoin, the one chain with an XCHAIN fee lane to fall back to', () => {
        expect(isNativeFeeMandatory('BTC')).toBe(false);
        expect(isNativeFeeMandatory('bitcoin')).toBe(false);
        expect(isNativeFeeMandatory('bitcoin-mainnet')).toBe(false);
        expect(isNativeFeeMandatory('bitcoin-regtest')).toBe(false);
        expect(isNativeFeeMandatory({ coin: 'bitcoin' })).toBe(false);
    });

    it('is true on LTC and DOGE, which have no XCHAIN fee lane', () => {
        for (const chain of ['LTC', 'litecoin', 'litecoin-regtest', 'litecoin-mainnet']) {
            expect(isNativeFeeMandatory(chain)).toBe(true);
        }
        for (const chain of ['DOGE', 'dogecoin', 'dogecoin-testnet', 'dogecoin-mainnet']) {
            expect(isNativeFeeMandatory(chain)).toBe(true);
        }
        expect(isNativeFeeMandatory({ coin: 'litecoin' })).toBe(true);
    });

    it('answers for every bundled chain descriptor, on every network', () => {
        const byCoin = { bitcoin: false, litecoin: true, dogecoin: true };
        for (const d of defaultRegistry().supportedChains()) {
            expect(isNativeFeeMandatory(d)).toBe(byCoin[d.coin]);
            expect(isNativeFeeMandatory(d.id)).toBe(byCoin[d.coin]);
        }
    });

    it('applies no protocol fee rule to an unknown or missing chain', () => {
        expect(isNativeFeeMandatory(null)).toBe(false);
        expect(isNativeFeeMandatory(undefined)).toBe(false);
        expect(isNativeFeeMandatory('')).toBe(false);
        expect(isNativeFeeMandatory({})).toBe(false);
        expect(isNativeFeeMandatory('mycoin-mainnet')).toBe(false);
        expect(isNativeFeeMandatory('ETH')).toBe(false);
    });
});

describe('nativeFeeTickerFor', () => {
    it('normalizes descriptor, chain id, coin id, and ticker to one ticker', () => {
        expect(nativeFeeTickerFor({ coin: 'dogecoin' })).toBe('DOGE');
        expect(nativeFeeTickerFor('dogecoin-regtest')).toBe('DOGE');
        expect(nativeFeeTickerFor('dogecoin')).toBe('DOGE');
        expect(nativeFeeTickerFor('DOGE')).toBe('DOGE');
        expect(nativeFeeTickerFor(null)).toBe('');
    });
});

// : the label side of the same answer. NativeFeeToggle renders nothing
// for an empty ticker, so this is what keeps a user-added custom chain from
// being shown a fee control the protocol has no rule for.
describe('protocolCoinTickerFor', () => {
    it('labels the protocol chains from whatever the form has to hand', () => {
        expect(protocolCoinTickerFor('litecoin-regtest')).toBe('LTC');
        expect(protocolCoinTickerFor({ coin: 'bitcoin' })).toBe('BTC');
        expect(protocolCoinTickerFor('dogecoin')).toBe('DOGE');
    });

    it('is empty for a chain the protocol does not run on, so the control hides', () => {
        // tickerForCoin alone would answer 'MYCOIN' here, which would render a
        // fee control offering to pay in a coin the protocol never prices.
        expect(protocolCoinTickerFor('mycoin-mainnet')).toBe('');
        expect(protocolCoinTickerFor(null)).toBe('');
        expect(protocolCoinTickerFor({})).toBe('');
    });
});
