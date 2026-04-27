// Smoke for §44 Fee UX — Step 1 — fee tier helpers.

import { strict as assert } from 'node:assert';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
} from '../../../packages/core/src/flows/feeEstimate.js';

const registry = {
    get(id) {
        if (id === 'bitcoin-mainnet') return { coin: 'bitcoin' };
        if (id === 'litecoin-mainnet') return { coin: 'litecoin' };
        if (id === 'dogecoin-mainnet') return { coin: 'dogecoin' };
        return null;
    },
};

// --- estimateNativeSendFee tier dispatch ---------------------------------

const btcLow = estimateNativeSendFee({ chainId: 'bitcoin-mainnet', chainRegistry: registry, speed: 'low' });
const btcNormal = estimateNativeSendFee({ chainId: 'bitcoin-mainnet', chainRegistry: registry, speed: 'normal' });
const btcFast = estimateNativeSendFee({ chainId: 'bitcoin-mainnet', chainRegistry: registry, speed: 'fast' });

assert.equal(btcLow.sats, 250, '1 sat/vB × 250 vB');
assert.equal(btcNormal.sats, 1500, '6 sat/vB × 250 vB');
assert.equal(btcFast.sats, 3000, '12 sat/vB × 250 vB');
assert.equal(btcLow.speed, 'low');
assert.equal(btcNormal.speed, 'normal');
assert.equal(btcFast.speed, 'fast');
assert.equal(btcNormal.unit, 'sat/vB');
assert.equal(btcLow.rateValue, 1);
assert.equal(btcFast.rateValue, 12);
assert.match(btcNormal.rate, /sat\/vB/);

// Default speed is 'normal'.
const btcDefault = estimateNativeSendFee({ chainId: 'bitcoin-mainnet', chainRegistry: registry });
assert.equal(btcDefault.sats, btcNormal.sats);
assert.equal(btcDefault.speed, 'normal');

// Unknown speed falls back to normal.
const btcUnknown = estimateNativeSendFee({ chainId: 'bitcoin-mainnet', chainRegistry: registry, speed: 'rocket' });
assert.equal(btcUnknown.sats, btcNormal.sats);

// DOGE shape — koinu/byte rates render as DOGE/kB.
const dogeNormal = estimateNativeSendFee({ chainId: 'dogecoin-mainnet', chainRegistry: registry, speed: 'normal' });
assert.equal(dogeNormal.unit, 'DOGE/kB');
assert.match(dogeNormal.rate, /DOGE\/kB/);
// 100_000 koinu/byte × 250 bytes = 25_000_000 koinu = 0.25 DOGE.
assert.equal(dogeNormal.sats, 25_000_000);

// --- estimateNativeSendFeeTiers ----------------------------------------

const tiers = estimateNativeSendFeeTiers({ chainId: 'bitcoin-mainnet', chainRegistry: registry });
assert.ok(tiers);
assert.equal(tiers.unit, 'sat/vB');
assert.ok(tiers.low.sats < tiers.normal.sats);
assert.ok(tiers.normal.sats < tiers.fast.sats);

// Unknown chain → null
assert.equal(
    estimateNativeSendFeeTiers({ chainId: 'unknown', chainRegistry: registry }),
    null,
);

// --- customFeeEstimate -------------------------------------------------

const custom = customFeeEstimate({ chainId: 'bitcoin-mainnet', chainRegistry: registry, rate: 4 });
assert.ok(custom);
assert.equal(custom.sats, 1000, '4 sat/vB × 250 vB');
assert.equal(custom.source, 'user');
assert.equal(custom.confidence, 'high');
assert.equal(custom.rateValue, 4);
assert.equal(custom.unit, 'sat/vB');

// Negative / NaN rate → null
assert.equal(customFeeEstimate({ chainId: 'bitcoin-mainnet', chainRegistry: registry, rate: -1 }), null);
assert.equal(customFeeEstimate({ chainId: 'bitcoin-mainnet', chainRegistry: registry, rate: NaN }), null);
assert.equal(customFeeEstimate({ chainId: 'bitcoin-mainnet', chainRegistry: registry, rate: 'abc' }), null);

// Rate of zero is allowed (caller may want a fee preview at 0).
const zero = customFeeEstimate({ chainId: 'bitcoin-mainnet', chainRegistry: registry, rate: 0 });
assert.ok(zero);
assert.equal(zero.sats, 0);

console.log('fee-tiers smoke OK');
