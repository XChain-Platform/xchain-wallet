// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A read that passes `fresh` guards a signature: it goes to the network even
// when an identical read finished a moment ago, it never joins one in flight,
// and it asks the HTTP cache for nothing. Every other read keeps its reuse.

import { describe, it, expect, afterEach } from 'vitest';
import {
    HostRateLimiter,
    installSdkNetworkPolicy,
    explorerReadFresh,
} from '../../../packages/core/src/sdk/explorerRateLimit.js';
import { DEFAULT_SDK_NETWORK_OPTIONS } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

const T0 = 1_760_000_000_000;

/** A limiter on a fake clock that the test moves by hand. */
function fakeLimiter() {
    let t = T0;
    const limiter = new HostRateLimiter({
        now: () => t,
        sleep: async (ms) => { t += ms; },
        random: () => 0.5,
    });
    return { limiter, advance: (ms) => { t += ms; } };
}

const sdkReady = sdkInstalled();

describe.skipIf(!sdkReady)('fresh reads through the shared gate on the real SDK ExplorerClient', () => {
    /** An explorer built with the options the wallet hands every SDK, its sends recorded. */
    function walletExplorer() {
        const ExplorerClient = requireSdkDeep('explorerClient');
        const ex = new ExplorerClient({
            network: 'bitcoin-mainnet',
            explorerUrl: 'https://explorer.example',
            retry: DEFAULT_SDK_NETWORK_OPTIONS.retry,
        });
        const sent = [];
        let n = 0;
        ex.client.get = async (url, config) => {
            sent.push({ method: 'GET', url, config });
            n += 1;
            return { status: 200, data: { n }, headers: {} };
        };
        ex.client.post = async (url, body, config) => {
            sent.push({ method: 'POST', url, config });
            n += 1;
            return { status: 200, data: { n }, headers: {} };
        };
        return { ex, sent };
    }

    it('sends a fresh GET that follows an identical ordinary GET within the reuse window', async () => {
        const { limiter, advance } = fakeLimiter();
        const { ex, sent } = walletExplorer();
        const sdk = installSdkNetworkPolicy({ explorer: ex }, limiter);

        const first = await sdk.explorer.get('/dispensers/bc1qx/address');
        advance(1_000);
        const second = await sdk.explorer.get('/dispensers/bc1qx/address', { fresh: true });

        expect(limiter.opts.reuseMs).toBeGreaterThan(1_000);
        expect(sent).toHaveLength(2);
        expect(first).toEqual({ n: 1 });
        expect(second).toEqual({ n: 2 });
    });

    it('keeps the reuse window for an ordinary GET', async () => {
        const { limiter, advance } = fakeLimiter();
        const { ex, sent } = walletExplorer();
        const sdk = installSdkNetworkPolicy({ explorer: ex }, limiter);

        await sdk.explorer.get('/dispensers/bc1qx/address');
        advance(1_000);
        const again = await sdk.explorer.get('/dispensers/bc1qx/address');

        expect(sent).toHaveLength(1);
        expect(again).toEqual({ n: 1 });
    });

    it('never joins an identical ordinary GET already in flight', async () => {
        const { limiter } = fakeLimiter();
        const { ex, sent } = walletExplorer();
        const sdk = installSdkNetworkPolicy({ explorer: ex }, limiter);

        const [a, b] = await Promise.all([
            sdk.explorer.get('/action/7', {}),
            sdk.explorer.get('/action/7', { fresh: true }),
        ]);

        expect(sent).toHaveLength(2);
        expect(a).not.toEqual(b);
    });

    it('sends a fresh GET and POST with cache no-store and an ordinary one without it', async () => {
        const { limiter } = fakeLimiter();
        const { ex, sent } = walletExplorer();
        const sdk = installSdkNetworkPolicy({ explorer: ex }, limiter);

        await sdk.explorer.get('/action/7', { fresh: true });
        await sdk.explorer.post('/balances', { addresses: ['bc1q'] }, { fresh: true });
        await sdk.explorer.get('/action/8');

        expect(sent[0].url).toBe('/BTC/api/action/7');
        expect(sent[0].config.fetchOptions).toEqual({ cache: 'no-store' });
        expect(sent[1].config.fetchOptions).toEqual({ cache: 'no-store' });
        expect(sent[2].config.fetchOptions).toBeUndefined();
        // The tag never reaches the query string the explorer caches on.
        expect(Object.keys(sent[0].config.params)).toEqual([]);
    });

    it('reads a facade path with no options fresh through explorerReadFresh', async () => {
        const { limiter, advance } = fakeLimiter();
        const { ex, sent } = walletExplorer();
        const sdk = installSdkNetworkPolicy({ explorer: ex }, limiter);

        await sdk.explorer.getAction('7');
        advance(500);
        await explorerReadFresh(sdk, '/action/7', () => { throw new Error('fallback'); });

        expect(sent).toHaveLength(2);
        expect(sent[1].config.fetchOptions).toEqual({ cache: 'no-store' });
    });
});

describe('fresh read adapter choice', () => {
    const hadXhr = 'XMLHttpRequest' in globalThis;
    const xhr = globalThis.XMLHttpRequest;
    afterEach(() => {
        if (hadXhr) globalThis.XMLHttpRequest = xhr;
        else delete globalThis.XMLHttpRequest;
    });

    /** A bare axios-shaped client so the test sees the exact config handed to it. */
    function bareExplorer(sent) {
        const params = {};
        return {
            client: {
                defaults: { baseURL: 'https://explorer.example' },
                get: async (url, config) => { sent.push(config); return { status: 200, data: {}, headers: {} }; },
            },
            buildParams() { return params; },
            async get(path, opts = {}) {
                return (await this.client.get(path, { params: this.buildParams(opts) })).data;
            },
        };
    }

    it('sends a fresh read through fetch where a page would pick XMLHttpRequest', async () => {
        globalThis.XMLHttpRequest = function FakeXhr() {};
        const sent = [];
        const sdk = installSdkNetworkPolicy({ explorer: bareExplorer(sent) }, fakeLimiter().limiter);
        await sdk.explorer.get('/action/7', { fresh: true });
        expect(sent[0].adapter).toBe('fetch');
        expect(sent[0].fetchOptions).toEqual({ cache: 'no-store' });
    });

    it('leaves the adapter alone where there is no XMLHttpRequest', async () => {
        delete globalThis.XMLHttpRequest;
        const sent = [];
        const sdk = installSdkNetworkPolicy({ explorer: bareExplorer(sent) }, fakeLimiter().limiter);
        await sdk.explorer.get('/action/7', { fresh: true });
        expect(sent[0].adapter).toBeUndefined();
        expect(sent[0].fetchOptions).toEqual({ cache: 'no-store' });
    });
});
