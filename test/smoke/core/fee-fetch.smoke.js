// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §44 Fee UX — Step 4 — async fetchNativeSendFeeTiers.

import { strict as assert } from 'node:assert';
import { fetchNativeSendFeeTiers } from '../../../packages/core/src/flows/feeEstimate.js';

const registry = {
    get(id) {
        if (id === 'bitcoin-mainnet') return { coin: 'bitcoin' };
        if (id === 'litecoin-mainnet') return { coin: 'litecoin' };
        if (id === 'dogecoin-mainnet') return { coin: 'dogecoin' };
        return null;
    },
};

// --- no messaging → placeholder ----------------------------------------

const noMsg = await fetchNativeSendFeeTiers({ chainId: 'bitcoin-mainnet', chainRegistry: registry });
assert.ok(noMsg);
assert.equal(noMsg.normal.source, 'static-placeholder');
assert.equal(noMsg.normal.confidence, 'low');
assert.equal(noMsg.unit, 'sat/vB');

// --- messaging without estimateFee → placeholder ----------------------

const stubMsg = await fetchNativeSendFeeTiers({
    messaging: {},
    chainId: 'bitcoin-mainnet',
    chainRegistry: registry,
});
assert.equal(stubMsg.normal.source, 'static-placeholder');

// --- SDK returns valid tiers → live ------------------------------------

let captured = null;
const liveMsg = {
    estimateFee: async (req) => {
        captured = req;
        return {
            unit: 'sat/vB',
            low: { rate: 2, etaMinutes: 50 },
            normal: { rate: 8, etaMinutes: 20 },
            fast: { rate: 18, etaMinutes: 5 },
        };
    },
};
const live = await fetchNativeSendFeeTiers({
    messaging: liveMsg,
    chainId: 'bitcoin-mainnet',
    chainRegistry: registry,
});
assert.ok(live);
assert.equal(captured.chainId, 'bitcoin-mainnet');
assert.equal(live.low.source, 'sdk');
assert.equal(live.normal.source, 'sdk');
assert.equal(live.fast.source, 'sdk');
assert.equal(live.normal.confidence, 'high');
assert.equal(live.normal.sats, 8 * 250, '8 sat/vB × 250 vB');
assert.equal(live.fast.etaMinutes, 5);
assert.equal(live.normal.rateValue, 8);

// --- SDK throws → silent fallback to placeholder ----------------------

const throwingMsg = {
    estimateFee: async () => { throw new Error('upstream error'); },
};
const throws = await fetchNativeSendFeeTiers({
    messaging: throwingMsg,
    chainId: 'bitcoin-mainnet',
    chainRegistry: registry,
});
assert.equal(throws.normal.source, 'static-placeholder', 'throw → silent fallback');

// --- SDK returns null → placeholder ----------------------------------

const nullMsg = { estimateFee: async () => null };
const nulled = await fetchNativeSendFeeTiers({
    messaging: nullMsg,
    chainId: 'bitcoin-mainnet',
    chainRegistry: registry,
});
assert.equal(nulled.normal.source, 'static-placeholder');

// --- partial SDK response → mixed ------------------------------------

const partialMsg = {
    estimateFee: async () => ({
        unit: 'sat/vB',
        normal: { rate: 5 },
        // low + fast missing
    }),
};
const partial = await fetchNativeSendFeeTiers({
    messaging: partialMsg,
    chainId: 'bitcoin-mainnet',
    chainRegistry: registry,
});
assert.equal(partial.normal.source, 'sdk');
assert.equal(partial.normal.sats, 5 * 250);
assert.equal(partial.low.source, 'static-placeholder', 'missing tier → placeholder fallback');
assert.equal(partial.fast.source, 'static-placeholder');

// --- DOGE live SDK → unit + rateValue in DOGE/kB ---------------------

const dogeLiveMsg = {
    estimateFee: async () => ({
        unit: 'DOGE/kB',
        // SDK reports per-byte koinu rates per the contract.
        normal: { rate: 80_000 },
    }),
};
const dogeLive = await fetchNativeSendFeeTiers({
    messaging: dogeLiveMsg,
    chainId: 'dogecoin-mainnet',
    chainRegistry: registry,
});
assert.equal(dogeLive.normal.source, 'sdk');
// 80_000 koinu/byte × 250 = 20_000_000 koinu
assert.equal(dogeLive.normal.sats, 20_000_000);
// rateValue is the displayed value: 80_000 * 1000 / 1e8 = 0.8 DOGE/kB
assert.equal(dogeLive.normal.rateValue, 0.8);

// --- unknown chain → null --------------------------------------------

assert.equal(
    await fetchNativeSendFeeTiers({ chainId: 'unknown', chainRegistry: registry }),
    null,
);

console.log('fee-fetch smoke OK');
