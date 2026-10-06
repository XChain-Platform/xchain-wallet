// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Guard the wallet's hand-copied per-coin dust table against drift from the SDK coin registry.
// The SDK is read from node_modules, the version the wallet bundles, and is never skipped:
// a conformance test that goes quiet when its oracle is missing reports green exactly when it matters.

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import {
    DUST_THRESHOLD_SATS_BY_COIN,
    dustThresholdForCoin,
} from '../../../packages/core/src/sdk/nativeFeePreflight.js';

const require = createRequire(import.meta.url);
const { NETWORKS } = require('xchain-sdk/src/protocol/networks.js');
const NETWORK_KEYS = Object.keys(NETWORKS);

// Split '<coinFullName>-<network>' at the last hyphen, so the coin name is everything before it.
function coinOf(key) {
    return key.slice(0, key.lastIndexOf('-'));
}

describe('wallet dust table conforms to the SDK coin registry', () => {
    it('reads a non-empty network registry from the installed SDK', () => {
        expect(NETWORK_KEYS.length).toBeGreaterThan(0);
    });

    // One case per coin and network, so a drift names the exact key that moved.
    it.each(NETWORK_KEYS)('%s carries the same dust floor as the wallet copy', (key) => {
        const coin = coinOf(key);
        const sdkFloor = NETWORKS[key].dustThreshold;
        expect(DUST_THRESHOLD_SATS_BY_COIN[coin], key).toBe(sdkFloor);
        expect(dustThresholdForCoin(coin), key).toBe(sdkFloor);
    });

    // Catch a stale wallet entry for a coin the SDK no longer ships.
    it('names no coin the SDK does not ship', () => {
        const sdkCoins = new Set(NETWORK_KEYS.map(coinOf));
        for (const coin of Object.keys(DUST_THRESHOLD_SATS_BY_COIN)) {
            expect(sdkCoins.has(coin), coin).toBe(true);
        }
    });
});
