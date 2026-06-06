// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive — Step 4 — feeEstimate flow.

import { strict as assert } from 'node:assert';
import {
    estimateNativeSendFee,
    satsToCoinDecimal,
} from '../../../packages/core/src/flows/feeEstimate.js';

// --- satsToCoinDecimal --------------------------------------------------

assert.equal(satsToCoinDecimal(0), '0');
assert.equal(satsToCoinDecimal(1), '0.00000001', 'one sat at coin scale');
assert.equal(satsToCoinDecimal(100_000_000), '1', 'exactly one coin');
assert.equal(satsToCoinDecimal(150_000_000), '1.5', 'fractional coin');
assert.equal(satsToCoinDecimal(1500), '0.000015', 'BTC fee placeholder');
assert.equal(satsToCoinDecimal(25_000_000), '0.25', 'DOGE fee placeholder');
assert.equal(satsToCoinDecimal(-1), '0', 'negative → 0');
assert.equal(satsToCoinDecimal(NaN), '0', 'NaN → 0');

// --- estimateNativeSendFee ---------------------------------------------

const registry = {
    get(id) {
        if (id === 'bitcoin-mainnet') return { coin: 'bitcoin' };
        if (id === 'litecoin-mainnet') return { coin: 'litecoin' };
        if (id === 'dogecoin-mainnet') return { coin: 'dogecoin' };
        if (id === 'mystery-coin') return { coin: 'mystery' };
        return null;
    },
};

const btc = estimateNativeSendFee({ chainId: 'bitcoin-mainnet', chainRegistry: registry });
assert.ok(btc);
assert.equal(btc.sats, 1500);
assert.equal(btc.coinAmount, '0.000015');
assert.equal(btc.source, 'static-placeholder');
assert.equal(btc.confidence, 'low');
assert.equal(btc.rate, '6 sat/vB');
assert.equal(btc.vsize, 250);

const ltc = estimateNativeSendFee({ chainId: 'litecoin-mainnet', chainRegistry: registry });
assert.ok(ltc);
assert.equal(ltc.sats, 250);
assert.equal(ltc.coinAmount, '0.0000025');

const doge = estimateNativeSendFee({ chainId: 'dogecoin-mainnet', chainRegistry: registry });
assert.ok(doge);
assert.equal(doge.sats, 25_000_000);
assert.equal(doge.coinAmount, '0.25');

// Unknown coin family → still returns a result, but with confidence='low'
// and zero sats so callers can detect the absence cleanly.
const mystery = estimateNativeSendFee({ chainId: 'mystery-coin', chainRegistry: registry });
assert.ok(mystery);
assert.equal(mystery.sats, 0);

// Missing inputs → null
assert.equal(estimateNativeSendFee({}), null);
assert.equal(estimateNativeSendFee({ chainId: 'foo' }), null);
assert.equal(
    estimateNativeSendFee({ chainId: 'unknown', chainRegistry: registry }),
    null,
    'unknown chain id → null',
);

console.log('fee-estimate smoke OK');
