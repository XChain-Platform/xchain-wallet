// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A coin-scheme link (bitcoin:, litecoin:, dogecoin:) pays on the network its
// address belongs to. Receive writes `bitcoin:<testnet address>?chain=bitcoin-testnet`
// for a testnet request and the scanner reads it as one; opened as a link it
// must reach the same prefilled Send.

import { describe, expect, it } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { encodeBip21Uri } from '../../../packages/core/src/uri/bip21.js';
import { deepLinkRoute } from '../../../packages/desktop/renderer/deepLinkRoute.js';

const registry = registryLib.defaultRegistry();
const MAINNET = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const REGTEST = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
// Legacy testnet and regtest addresses share a version byte.
const SHARED_LEGACY = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';

describe('coin-scheme links on every network', () => {
    it('routes the testnet request Receive writes to bitcoin-testnet', () => {
        const link = encodeBip21Uri({
            scheme: 'bitcoin', address: TESTNET, amount: '0.1', params: { chain: 'bitcoin-testnet' },
        });
        expect(deepLinkRoute(link, registry)).toEqual({
            view: 'send',
            sendPrefill: { address: TESTNET, amount: '0.1', tick: 'BTC', chainId: 'bitcoin-testnet', memo: undefined },
        });
    });

    it('routes a testnet or regtest address with no chain to its own network', () => {
        expect(deepLinkRoute(`bitcoin:${TESTNET}?amount=1`, registry))
            .toMatchObject({ view: 'send', sendPrefill: { chainId: 'bitcoin-testnet', amount: '1' } });
        expect(deepLinkRoute(`bitcoin:${REGTEST}?amount=1`, registry))
            .toMatchObject({ view: 'send', sendPrefill: { chainId: 'bitcoin-regtest', amount: '1' } });
    });

    it('keeps mainnet links on mainnet', () => {
        expect(deepLinkRoute(`bitcoin:${MAINNET}?amount=1`, registry))
            .toMatchObject({ view: 'send', sendPrefill: { chainId: 'bitcoin-mainnet' } });
    });

    it('uses the named chain for an address two networks share and refuses it without one', () => {
        expect(deepLinkRoute(`bitcoin:${SHARED_LEGACY}?amount=1&chain=bitcoin-regtest`, registry))
            .toMatchObject({ view: 'send', sendPrefill: { chainId: 'bitcoin-regtest' } });
        expect(deepLinkRoute(`bitcoin:${SHARED_LEGACY}?amount=1`, registry))
            .toMatchObject({ view: 'deep-link-error' });
    });

    it('refuses a named chain that is not the address network or not the scheme coin', () => {
        expect(deepLinkRoute(`bitcoin:${TESTNET}?amount=1&chain=bitcoin-mainnet`, registry))
            .toMatchObject({ view: 'deep-link-error' });
        expect(deepLinkRoute(`bitcoin:${MAINNET}?amount=1&chain=bitcoin-testnet`, registry))
            .toMatchObject({ view: 'deep-link-error' });
        expect(deepLinkRoute(`bitcoin:${TESTNET}?amount=1&chain=litecoin-testnet`, registry))
            .toMatchObject({ view: 'deep-link-error' });
    });
});
