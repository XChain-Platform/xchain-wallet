// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The pre-flight that opens the confirm screen reads the explorer fresh.
//
// The explorer serves /balances/ with max-age=5, stale-while-revalidate=10.
// A seller who had just issued a token opened a dispenser for it, and the
// browser answered the pre-flight's balance read with the listing from before
// the ISSUE. The SDK reads a listing without the token as "holds none", so the
// review refused with "Balance of DISPTHETLU (0) does not cover the escrow
// (100)" while the seller held 1000. The HTTP cache is stood in for here by the
// client stub, which answers any read not sent no-store with that old listing;
// the wrapper's own reuse window is exercised by a real read made a moment
// earlier.

import { describe, it, expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import {
    HostRateLimiter,
    installSdkNetworkPolicy,
} from '../../../packages/core/src/sdk/explorerRateLimit.js';
import { DEFAULT_SDK_NETWORK_OPTIONS } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';
import { chainRegistry, memCollection } from './_addressesByChainFixture.js';

const T0 = 1_760_000_000_000;
const SELLER = 'bcrt1q6r8f';

const PRE_ISSUE = { address: SELLER, data: [{ tick: 'XCHAIN', amount: '5000', decimals: 0 }], total: 1 };
const POST_ISSUE = {
    address: SELLER,
    data: [{ tick: 'DISPTHETLU', amount: '1000', decimals: 8 }, { tick: 'XCHAIN', amount: '4999', decimals: 0 }],
    total: 2,
};
const TOKEN = { info: { coin: 'BTC', tick: 'DISPTHETLU', tick_id: 9, decimals: 8 } };

describe.skipIf(!sdkInstalled())('the first pre-flight reads fresh', () => {
    function sellerSdk() {
        let t = T0;
        const limiter = new HostRateLimiter({ now: () => t, sleep: async (ms) => { t += ms; }, random: () => 0.5 });
        const ExplorerClient = requireSdkDeep('explorerClient');
        const { CheckContext } = requireSdkDeep('preflightContext');
        const explorer = new ExplorerClient({
            network: 'bitcoin-mainnet',
            explorerUrl: 'https://explorer.example',
            retry: DEFAULT_SDK_NETWORK_OPTIONS.retry,
        });
        const sent = [];
        let issued = false;
        explorer.client.get = async (url, config) => {
            sent.push({ url, config });
            const fresh = config?.fetchOptions?.cache === 'no-store';
            if (url.includes('/balances/')) {
                // Before the ISSUE the listing lacks the token; after it, only a
                // no-store read gets past the cached copy.
                return { status: 200, data: issued && fresh ? POST_ISSUE : PRE_ISSUE, headers: {} };
            }
            if (url.includes('/token/')) return { status: 200, data: TOKEN, headers: {} };
            throw Object.assign(new Error(`unexpected read ${url}`), { response: { status: 404, headers: {} } });
        };
        const sdk = installSdkNetworkPolicy({
            explorer,
            // The SDK's dispenser check: does the seller hold the escrow? It
            // reads the real CheckContext, the path that turned a stale listing
            // into a balance of "0".
            async preflight(actionString, opts) {
                const ctx = new CheckContext({
                    sdk: this, parsed: { params: {} }, source: opts.source, mode: 'report', timeoutMs: 4_000,
                });
                const balance = await ctx.balance(opts.source, 'DISPTHETLU');
                return { verdict: balance === '0' ? 'fail' : 'pass', balance, unverified: ctx.unverified };
            },
        }, limiter);
        return {
            sdk, sent,
            issue: () => { issued = true; },
            advance: (ms) => { t += ms; },
        };
    }

    function hostFor(sdk) {
        return createBackgroundHost({
            vault: {
                wallets: memCollection(), accounts: memCollection(), addresses: memCollection(), signers: memCollection(),
                settings: { async get() { return { schemaVersion: 1, activeNetwork: 'regtest', fees: {}, ads: { perChain: {} } }; }, async put() {} },
            },
            chainRegistry,
            sdkRegistry: { get: () => sdk },
            signerPool: { get: () => null, has: () => false },
            broadcastQueueStorage: null,
            signThrottleStorage: null,
            logConsoleStorage: null,
        });
    }

    const openReview = (host) => host.handle({
        type: 'action.preflight',
        request: { chainId: 'bitcoin-regtest', actionString: 'DISPENSER|DISPTHETLU|100|10|1', source: SELLER },
    });

    it('sees a balance that arrived after an earlier read of the same listing', async () => {
        const { sdk, sent, issue, advance } = sellerSdk();
        // The ISSUE form's own pre-flight read the listing moments earlier.
        await sdk.explorer.getBalances(SELLER);
        issue();
        advance(700);

        const res = await openReview(hostFor(sdk));

        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result).toMatchObject({ verdict: 'pass', balance: '1000' });
        const reviewReads = sent.slice(1);
        expect(reviewReads.map((r) => r.url)).toEqual(expect.arrayContaining([
            expect.stringContaining('/balances/'), expect.stringContaining('/token/'),
        ]));
        for (const read of reviewReads) expect(read.config.fetchOptions).toEqual({ cache: 'no-store' });
    });

    it('asks for the same URL with the same headers, so no CORS preflight is added', async () => {
        const { sdk, sent, issue } = sellerSdk();
        await sdk.explorer.getBalances(SELLER);
        issue();
        await openReview(hostFor(sdk));

        const earlier = sent[0];
        const review = sent.slice(1).find((r) => r.url.includes('/balances/'));
        expect(review.url).toBe(earlier.url);
        expect(review.config.params).toEqual(earlier.config.params);
        expect(review.config.headers).toEqual(earlier.config.headers);
    });
});
