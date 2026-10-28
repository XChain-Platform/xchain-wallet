// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A read that passes `noRetry` makes exactly one attempt through the shared
// host gate, while every other read keeps its retries and the gate keeps its
// concurrency ceiling.

import { describe, it, expect } from 'vitest';
import {
    HostRateLimiter,
    installSdkNetworkPolicy,
} from '../../../packages/core/src/sdk/explorerRateLimit.js';
import { DEFAULT_SDK_NETWORK_OPTIONS } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

const T0 = 1_760_000_000_000;

/** A limiter on a fake clock: sleep advances time instead of waiting. */
function fakeLimiter(opts = {}) {
    let t = T0;
    const sleeps = [];
    const limiter = new HostRateLimiter({
        now: () => t,
        sleep: async (ms) => { sleeps.push(ms); t += ms; },
        random: () => 0.5,
        ...opts,
    });
    return { limiter, sleeps, now: () => t };
}

function networkError() {
    return Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
}

function ok(data) {
    return { status: 200, data, headers: {} };
}

const sdkReady = sdkInstalled();

describe.skipIf(!sdkReady)('noRetry through the shared gate on the real SDK ExplorerClient', () => {
    /** An explorer built with the retry options the wallet hands every SDK. */
    function walletExplorer({ get, post } = {}) {
        const ExplorerClient = requireSdkDeep('explorerClient');
        const ex = new ExplorerClient({
            network: 'bitcoin-mainnet',
            explorerUrl: 'https://explorer.example',
            retry: DEFAULT_SDK_NETWORK_OPTIONS.retry,
        });
        if (get) ex.client.get = get;
        if (post) ex.client.post = post;
        return ex;
    }

    function failingSends() {
        const sent = [];
        const send = async (url) => {
            sent.push(url);
            throw networkError();
        };
        return { sent, send };
    }

    it('sends a GET that asks for noRetry exactly once', async () => {
        const { limiter, sleeps } = fakeLimiter();
        const { sent, send } = failingSends();
        const sdk = installSdkNetworkPolicy({ explorer: walletExplorer({ get: send }) }, limiter);

        await expect(sdk.explorer.get('/shared_lists', { noRetry: true }))
            .rejects.toMatchObject({ code: 'EXPLORER_NETWORK' });
        expect(sent).toEqual(['/BTC/api/shared_lists']);
        expect(sleeps).toEqual([]);
    });

    it('keeps the configured retries for a GET and a POST that do not ask for noRetry', async () => {
        expect(DEFAULT_SDK_NETWORK_OPTIONS.retry.maxRetries).toBeGreaterThan(0);
        const { limiter } = fakeLimiter();
        const { sent, send } = failingSends();
        const sdk = installSdkNetworkPolicy({ explorer: walletExplorer({ get: send, post: send }) }, limiter);

        await expect(sdk.explorer.get('/shared_lists')).rejects.toMatchObject({ code: 'EXPLORER_NETWORK' });
        expect(sent).toHaveLength(1 + DEFAULT_SDK_NETWORK_OPTIONS.retry.maxRetries);

        const { limiter: postLimiter } = fakeLimiter();
        const posts = failingSends();
        const postSdk = installSdkNetworkPolicy(
            { explorer: walletExplorer({ post: posts.send }) }, postLimiter,
        );
        await expect(postSdk.explorer.post('/balances', { addresses: ['bc1q'] }))
            .rejects.toMatchObject({ code: 'EXPLORER_NETWORK' });
        expect(posts.sent).toHaveLength(1 + DEFAULT_SDK_NETWORK_OPTIONS.retry.maxRetries);
    });

    it('sends a POST that asks for noRetry exactly once', async () => {
        const { limiter } = fakeLimiter();
        const { sent, send } = failingSends();
        const sdk = installSdkNetworkPolicy({ explorer: walletExplorer({ post: send }) }, limiter);

        await expect(sdk.explorer.post('/balances', { addresses: ['bc1q'] }, { noRetry: true }))
            .rejects.toMatchObject({ code: 'EXPLORER_NETWORK' });
        expect(sent).toHaveLength(1);
    });

    it('leaves the query string of a noRetry read unchanged', async () => {
        const { limiter } = fakeLimiter();
        const seen = [];
        const sdk = installSdkNetworkPolicy({
            explorer: walletExplorer({
                get: async (url, config) => {
                    seen.push({ url, params: config.params, keys: Reflect.ownKeys(config.params) });
                    return ok([]);
                },
            }),
        }, limiter);

        await sdk.explorer.get('/blocks', { limit: 11, noRetry: true });
        expect(seen).toEqual([{ url: '/BTC/api/blocks', params: { limit: 11 }, keys: ['limit'] }]);
    });

    it('refuses a noRetry read at once while the host is paused, without sending or sleeping', async () => {
        const { limiter, sleeps } = fakeLimiter();
        const { sent, send } = failingSends();
        const sdk = installSdkNetworkPolicy({ explorer: walletExplorer({ get: send }) }, limiter);
        limiter.block('explorer.example', 20_000, false);

        await expect(sdk.explorer.get('/shared_lists', { noRetry: true }))
            .rejects.toMatchObject({ code: 'EXPLORER_NETWORK' });
        expect(sent).toEqual([]);
        expect(sleeps).toEqual([]);
    });

    it('does not join an identical read that is still retrying', async () => {
        const { limiter } = fakeLimiter();
        let calls = 0;
        let releaseFirst;
        const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
        const sdk = installSdkNetworkPolicy({
            explorer: walletExplorer({
                get: async () => {
                    calls += 1;
                    if (calls === 1) {
                        await firstHeld;
                        throw networkError();
                    }
                    return ok({ calls });
                },
            }),
        }, limiter);

        const retrying = sdk.explorer.get('/status');
        await Promise.resolve();
        const single = sdk.explorer.get('/status', { noRetry: true });
        await expect(single).resolves.toEqual({ calls: 2 });
        releaseFirst();
        await expect(retrying).resolves.toEqual({ calls: 3 });
    });
});

describe('single-attempt requests in the host gate', () => {
    it('keeps a wave of single-attempt reads at the concurrency ceiling', async () => {
        const { limiter } = fakeLimiter({ maxConcurrency: 2 });
        let active = 0;
        let peak = 0;
        let sends = 0;
        const send = async () => {
            sends += 1;
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return ok('fine');
        };
        const wave = Array.from({ length: 6 }, () => limiter.request(
            'h', null, send, () => new Error('paused'), 3, undefined, undefined, { singleAttempt: true },
        ));

        await expect(Promise.all(wave)).resolves.toHaveLength(6);
        expect(sends).toBe(6);
        expect(peak).toBe(2);
    });

    it('releases a queued single-attempt read when the host is paused, and keeps a queued ordinary read', async () => {
        const { limiter } = fakeLimiter({ maxConcurrency: 1 });
        let releaseHolder;
        const holder = limiter.request('h', null, () => new Promise((resolve) => {
            releaseHolder = () => resolve(ok('held'));
        }), () => new Error('paused'), 0);
        await Promise.resolve();

        let ordinarySent = 0;
        const ordinary = limiter.request('h', null, async () => {
            ordinarySent += 1;
            return ok('ordinary');
        }, () => new Error('paused'), 0);
        let singleSent = 0;
        const single = limiter.request('h', null, async () => {
            singleSent += 1;
            return ok('single');
        }, (seconds) => Object.assign(new Error('paused'), { seconds }), 3, undefined, undefined,
        { singleAttempt: true });
        const singleSettled = single.catch((e) => e);

        limiter.block('h', 5_000, false);
        const err = await singleSettled;
        expect(err).toMatchObject({ message: 'paused', seconds: 5 });
        expect(singleSent).toBe(0);

        releaseHolder();
        await expect(holder).resolves.toMatchObject({ data: 'held' });
        await expect(ordinary).resolves.toMatchObject({ data: 'ordinary' });
        expect(ordinarySent).toBe(1);
    });
});
