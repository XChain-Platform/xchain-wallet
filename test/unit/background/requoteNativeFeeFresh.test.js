// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Approve-time native-fee re-quote exists to catch an oracle round that
// landed after compose. Compose asked the explorer the same GET /feequote a
// moment earlier, and the explorer serves it as cacheable, so the re-quote
// reads fresh: past the wrapper's read reuse and with cache no-store.

import { describe, it, expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import {
    HostRateLimiter,
    installSdkNetworkPolicy,
    explorerFreshScope,
} from '../../../packages/core/src/sdk/explorerRateLimit.js';
import { DEFAULT_SDK_NETWORK_OPTIONS } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';
import { chainRegistry, memCollection } from './_addressesByChainFixture.js';

const T0 = 1_760_000_000_000;

describe.skipIf(!sdkInstalled())('native-fee re-quote reads fresh', () => {
    function quotingSdk() {
        let t = T0;
        const limiter = new HostRateLimiter({ now: () => t, sleep: async (ms) => { t += ms; }, random: () => 0.5 });
        const ExplorerClient = requireSdkDeep('explorerClient');
        const explorer = new ExplorerClient({
            network: 'bitcoin-mainnet',
            explorerUrl: 'https://explorer.example',
            retry: DEFAULT_SDK_NETWORK_OPTIONS.retry,
        });
        const sent = [];
        let round = 0;
        explorer.client.get = async (url, config) => {
            sent.push({ url, config });
            round += 1;
            return { status: 200, data: { supported: true, valid: true, requiredFeeSats: 1000 * round }, headers: {} };
        };
        const sdk = installSdkNetworkPolicy({
            explorer,
            // The SDK's quoteNativeFee splits the action string and asks getFeeQuote.
            async quoteNativeFee(actionString, opts = {}) {
                const [action, ...params] = String(actionString).split('|');
                return this.explorer.getFeeQuote({ action, params, source: opts.source });
            },
        }, limiter);
        return { sdk, sent, advance: (ms) => { t += ms; } };
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

    it('asks the explorer again at Approve instead of reusing the compose quote', async () => {
        const { sdk, sent, advance } = quotingSdk();
        const composed = await sdk.quoteNativeFee('VOTE|1|7', { source: 'bc1qsrc' });
        advance(700);
        const res = await hostFor(sdk).handle({
            type: 'action.requoteNativeFee',
            request: { chainId: 'bitcoin-regtest', actionString: 'VOTE|1|7', source: 'bc1qsrc' },
        });

        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(sent).toHaveLength(2);
        expect(sent[0].url).toBe(sent[1].url);
        expect(sent[1].config.fetchOptions).toEqual({ cache: 'no-store' });
        expect(res.result.requiredFeeSats).not.toBe(composed.requiredFeeSats);
    });

    it('sends reads fresh only while the scope is open', async () => {
        const { sdk, sent } = quotingSdk();
        await sdk.explorer.get('/status');
        await explorerFreshScope(sdk, () => sdk.explorer.get('/status'));
        await sdk.explorer.get('/status');

        expect(sent).toHaveLength(2);
        expect(sent[1].config.fetchOptions).toEqual({ cache: 'no-store' });
    });
});
