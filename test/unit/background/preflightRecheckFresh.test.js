// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Approve-time pre-flight re-check passes bypassCache, which skips the
// SDK's report cache. Its explorer reads go fresh as well, so a read another
// caller made a moment earlier, reused or served from the HTTP cache, never
// answers the re-check. The pre-flight that opens the review reads as before.

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

describe.skipIf(!sdkInstalled())('pre-flight re-check reads fresh', () => {
    function dryRunSdk({ rateLimitFirst = false } = {}) {
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
            if (rateLimitFirst && round === 1) {
                const err = new Error('Request failed with status code 429');
                err.response = { status: 429, headers: { 'retry-after': '4' }, data: null };
                throw err;
            }
            return { status: 200, data: { verdict: 'pass', findings: [], round }, headers: {} };
        };
        const attempts = [];
        const sdk = installSdkNetworkPolicy({
            explorer,
            // The SDK's pre-flight asks the explorer's dry run for the action.
            async preflight(actionString, opts) {
                attempts.push(opts);
                try {
                    return await this.explorer.get('/preflight?action=' + encodeURIComponent(actionString));
                } catch (err) {
                    return {
                        verdict: 'pass',
                        findings: [{
                            code: 'DRYRUN_UNAVAILABLE',
                            message: `The network dry-run was unavailable (${err.message}); relying on client checks.`,
                        }],
                    };
                }
            },
        }, limiter);
        return { sdk, sent, attempts, advance: (ms) => { t += ms; } };
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

    const preflight = (host, bypassCache) => host.handle({
        type: 'action.preflight',
        request: { chainId: 'bitcoin-regtest', actionString: 'VOTE|1|7', bypassCache },
    });

    it('sends the bypassCache re-check to the explorer past an identical read a moment earlier', async () => {
        const { sdk, sent, advance } = dryRunSdk();
        const host = hostFor(sdk);
        expect((await preflight(host, false)).ok).toBe(true);
        advance(700);
        const res = await preflight(host, true);

        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(sent).toHaveLength(2);
        expect(sent[1].config.fetchOptions).toEqual({ cache: 'no-store' });
        expect(res.result.round).toBe(2);
    });

    it('keeps the ordinary pre-flight on the shared reads', async () => {
        const { sdk, sent, advance } = dryRunSdk();
        const host = hostFor(sdk);
        await preflight(host, false);
        advance(700);
        await preflight(host, false);
        expect(sent).toHaveLength(1);
    });

    it('waits out a 429 report and retries with fresh report and HTTP reads', async () => {
        const { sdk, sent, attempts } = dryRunSdk({ rateLimitFirst: true });
        const host = hostFor(sdk);
        const res = await preflight(host, false);

        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result).toMatchObject({ verdict: 'pass', round: 2 });
        expect(sent).toHaveLength(2);
        expect(sent[1].config.fetchOptions).toEqual({ cache: 'no-store' });
        expect(attempts.map((opts) => opts.bypassCache)).toEqual([false, true]);
    });
});
