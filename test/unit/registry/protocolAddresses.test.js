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
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import {
    PROTOCOL_DESTINATIONS_BY_CHAIN_ID,
} from '../../../packages/core/src/shared/utils/protocolDestination.js';

const require = createRequire(import.meta.url);
const SDK_COINS = join(
    dirname(require.resolve('xchain-sdk/package.json')),
    'src',
    'coins',
);

function safetyDestinations(coin) {
    return Object.fromEntries(Object.entries(coin.networks).map(([network, config]) => [
        `${coin.fullName}-${network}`,
        Object.fromEntries(Object.entries(config.addresses).filter(([role]) => (
            role === 'BURN' || role.startsWith('BRIDGE_')
        ))),
    ]));
}

describe('chain protocol addresses', () => {
    it('matches the burn and bridge constants in the pinned SDK source', () => {
        const sdkDestinations = Object.assign({}, ...['BTC', 'LTC', 'DOGE'].map((ticker) => (
            safetyDestinations(require(join(SDK_COINS, `${ticker}.js`)))
        )));

        expect(PROTOCOL_DESTINATIONS_BY_CHAIN_ID).toEqual(sdkDestinations);
    });

    it('covers the synchronized descriptors without changing their shape', () => {
        expect(Object.keys(PROTOCOL_DESTINATIONS_BY_CHAIN_ID).sort())
            .toEqual(BUNDLED_DESCRIPTORS.map(({ id }) => id).sort());
        expect(BUNDLED_DESCRIPTORS.every((descriptor) => !('protocolAddresses' in descriptor))).toBe(true);
    });
});
