// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Guard the wallet's hand-copied native-fee destination table against drift from the SDK coin
// registry. A re-pin of a coin's FEE_DESTINATION that the wallet copy missed would make the
// wallet refuse every native-fee quote while the rest of the suite stayed green. The coin
// files are read raw from node_modules, so no regtest environment override can mask a drift.

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { FEE_DESTINATION_BY_CHAIN } from '../../../packages/core/src/sdk/nativeFeePreflight.js';

const require = createRequire(import.meta.url);
const COIN_TICKS = ['BTC', 'LTC', 'DOGE'];

const REGISTRY_ROWS = COIN_TICKS.flatMap((tick) => {
    const coin = require(`xchain-sdk/src/coins/${tick}.js`);
    return Object.entries(coin.networks).map(([network, block]) => ({
        key: `${coin.fullName}-${network}`,
        destination: block.addresses.FEE_DESTINATION,
    }));
});

describe('wallet fee-destination table conforms to the SDK coin registry', () => {
    it('reads a registry row for every coin and network from the installed SDK', () => {
        expect(REGISTRY_ROWS).toHaveLength(COIN_TICKS.length * 3);
        for (const row of REGISTRY_ROWS) expect(typeof row.destination, row.key).toBe('string');
    });

    // One case per coin and network, so a drift names the exact key that moved.
    it.each(REGISTRY_ROWS.map((row) => [row.key, row.destination]))(
        '%s carries the same fee destination as the wallet copy',
        (key, destination) => {
            expect(FEE_DESTINATION_BY_CHAIN[key], key).toBe(destination);
        },
    );

    it('names no chain the SDK registry does not ship', () => {
        const sdkKeys = new Set(REGISTRY_ROWS.map((row) => row.key));
        for (const key of Object.keys(FEE_DESTINATION_BY_CHAIN)) {
            expect(sdkKeys.has(key), key).toBe(true);
        }
    });
});
