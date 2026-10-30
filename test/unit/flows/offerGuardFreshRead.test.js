// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The sign-time check that refuses a cancel, edit or close of an offer that
// filled, closed or expired reads the offer and the chain clock fresh. Through
// the wallet's explorer wrapper, an identical read from a moment earlier (the
// My orders list hydrating the same offer) would otherwise answer it.

import { describe, it, expect } from 'vitest';
import { HostRateLimiter, installSdkNetworkPolicy } from '../../../packages/core/src/sdk/explorerRateLimit.js';
import { DEFAULT_SDK_NETWORK_OPTIONS } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { assertReferencedOfferActionable } from '../../../packages/core/src/flows/marketExpiry.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

const T0 = 1_760_000_000_000;

describe.skipIf(!sdkInstalled())('offer guard reads fresh through the explorer wrapper', () => {
    function walletSdk(answers) {
        let t = T0;
        const limiter = new HostRateLimiter({ now: () => t, sleep: async (ms) => { t += ms; }, random: () => 0.5 });
        const ExplorerClient = requireSdkDeep('explorerClient');
        const explorer = new ExplorerClient({
            network: 'bitcoin-mainnet',
            explorerUrl: 'https://explorer.example',
            retry: DEFAULT_SDK_NETWORK_OPTIONS.retry,
        });
        const sent = [];
        explorer.client.get = async (url, config) => {
            sent.push({ url, config });
            return { status: 200, data: answers(url), headers: {} };
        };
        const sdk = installSdkNetworkPolicy({
            explorer,
            getAction(index) { return this.explorer.getAction(index); },
            getStatus(opts) { return this.explorer.getStatus(opts); },
        }, limiter);
        return { sdk, sent, advance: (ms) => { t += ms; } };
    }

    it('refuses a cancel of an order that filled a moment after the list read it', async () => {
        let orderStatus = 'open';
        const { sdk, sent, advance } = walletSdk((url) => (url.endsWith('/status')
            ? { last_block: { BTC: 800 }, chain_tip: { BTC: 800 }, last_block_time: { BTC: 4_000 } }
            : { state: { status: orderStatus, expiration: 9_000 } }));

        // The list hydrates the order, then it fills and the user presses Cancel.
        await sdk.getAction('9');
        orderStatus = 'filled';
        advance(800);

        await expect(assertReferencedOfferActionable({
            sdkRegistry: { get: () => sdk },
            chainId: 'bitcoin-mainnet',
            actionData: { action: 'ORDER', params: { VERSION: '1', ORDER_ACTION_INDEX: '9' } },
        })).rejects.toThrow('This order has already been filled.');
        expect(sent.map((s) => s.url)).toEqual(['/BTC/api/action/9', '/BTC/api/action/9']);
        expect(sent[1].config.fetchOptions).toEqual({ cache: 'no-store' });
    });

    it('reads the expiry clock fresh', async () => {
        const { sdk, sent } = walletSdk((url) => (url.endsWith('/status')
            ? { last_block: { BTC: 800 }, chain_tip: { BTC: 800 }, last_block_time: { BTC: 4_000 } }
            : { state: { status: 'open', expiration: 9_000 } }));
        await sdk.explorer.get('/status');

        await assertReferencedOfferActionable({
            sdkRegistry: { get: () => sdk },
            chainId: 'bitcoin-mainnet',
            actionData: { action: 'SWAP', params: { VERSION: '1', SWAP_ACTION_INDEX: '9' } },
        });
        const statusReads = sent.filter((s) => s.url.endsWith('/status'));
        expect(statusReads).toHaveLength(2);
        expect(statusReads[1].config.fetchOptions).toEqual({ cache: 'no-store' });
    });
});
