// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A path-style link names its chain in the path. The route accepts it only
// when that chain is registered and the destination is an address on it, the
// same bar the coin-code form meets, so a link never opens Send on a network
// the wallet cannot use or with a destination that network rejects.

import { describe, expect, it } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { deepLinkRoute } from '../../../packages/desktop/renderer/deepLinkRoute.js';

const registry = registryLib.defaultRegistry();
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LTC = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

describe('path-style link chain and destination', () => {
    it('routes a registered chain with a destination on that chain', () => {
        expect(deepLinkRoute(`xchain://litecoin-mainnet/LTC?to=${LTC}&amount=1`, registry)).toMatchObject({
            view: 'send',
            sendPrefill: { address: LTC, chainId: 'litecoin-mainnet', amount: '1' },
        });
    });

    it('refuses a chain the registry does not hold', () => {
        expect(deepLinkRoute(`xchain://nope-chain/BTC?to=${BTC}&amount=1`, registry))
            .toMatchObject({ view: 'deep-link-error' });
    });

    it('refuses a destination that belongs to another network than the path names', () => {
        expect(deepLinkRoute(`xchain://litecoin-mainnet/LTC?to=${BTC}&amount=1`, registry))
            .toMatchObject({ view: 'deep-link-error' });
    });

    it('still routes a path-style link that carries no destination', () => {
        expect(deepLinkRoute('xchain://bitcoin-mainnet?amount=3', registry)).toMatchObject({
            view: 'send',
            sendPrefill: { amount: '3', chainId: 'bitcoin-mainnet' },
        });
    });
});
