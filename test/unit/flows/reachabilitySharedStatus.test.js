// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// checkReachability reads the explorer's /status once per explorer host (the
// document is keyed by coin, so one read serves every chain on that host), and
// counts a rate-limited explorer as reachable rather than down.

import { describe, it, expect } from 'vitest';
import { checkReachability } from '../../../packages/core/src/flows/reachability.js';
import { EXPLORER_BUSY_MESSAGE, HostRateLimiter } from '../../../packages/core/src/sdk/explorerRateLimit.js';

const status = {
    stale: { BTC: false, LTC: true, DOGE: false },
    last_block: { BTC: 1, LTC: 2, DOGE: 3 },
};

function chainSdk(coin, baseUrl, counter, getStatus) {
    return {
        pingHub: async () => true,
        pingEncoder: async () => ({ ok: true }),
        getStatus: getStatus || (async () => { counter.n += 1; return status; }),
        explorer: { coin, baseUrl, port: 443, _get: async () => ({}) },
    };
}

const registryOf = (byChain) => ({ get: (id) => byChain[id] });

describe('checkReachability shares the explorer status read per host', () => {
    it('reads /status once for three chains on one host and keeps each chain\'s own freshness', async () => {
        const counter = { n: 0 };
        const host = 'https://explorer.example';
        const res = await checkReachability({
            sdkRegistry: registryOf({
                'bitcoin-mainnet': chainSdk('BTC', host, counter),
                'litecoin-mainnet': chainSdk('LTC', host, counter),
                'dogecoin-mainnet': chainSdk('DOGE', host, counter),
            }),
            chainIds: ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'],
            timeoutMs: 500,
        });
        expect(counter.n).toBe(1);
        const byId = Object.fromEntries(res.perChain.map((c) => [c.chainId, c]));
        expect(byId['bitcoin-mainnet'].mode).toBe('normal');
        expect(byId['litecoin-mainnet'].mode).toBe('degraded');
        expect(byId['litecoin-mainnet'].freshness.explorer.tipBlock).toBe(2);
        expect(byId['dogecoin-mainnet'].freshness.explorer.tipBlock).toBe(3);
    });

    it('still reads each host once when chains point at different explorers', async () => {
        const counter = { n: 0 };
        await checkReachability({
            sdkRegistry: registryOf({
                'bitcoin-mainnet': chainSdk('BTC', 'https://a.example', counter),
                'litecoin-mainnet': chainSdk('LTC', 'https://b.example', counter),
            }),
            chainIds: ['bitcoin-mainnet', 'litecoin-mainnet'],
            timeoutMs: 500,
        });
        expect(counter.n).toBe(2);
    });

    it('reads again on the next check rather than reusing an old answer', async () => {
        const counter = { n: 0 };
        const sdkRegistry = registryOf({ 'bitcoin-mainnet': chainSdk('BTC', 'https://a.example', counter) });
        await checkReachability({ sdkRegistry, chainIds: ['bitcoin-mainnet'], timeoutMs: 500 });
        await checkReachability({ sdkRegistry, chainIds: ['bitcoin-mainnet'], timeoutMs: 500 });
        expect(counter.n).toBe(2);
    });

    it('skips the read while the explorer host is paused for a rate limit, and calls it reachable', async () => {
        const limiter = new HostRateLimiter();
        limiter.block('explorer.example', 20_000);
        const counter = { n: 0 };
        const sdk = chainSdk('BTC', 'https://explorer.example', counter);
        sdk.explorer.client = { defaults: { baseURL: 'https://explorer.example' }, __xcRateLimiter: limiter };
        const res = await checkReachability({
            sdkRegistry: registryOf({ 'bitcoin-mainnet': sdk }),
            chainIds: ['bitcoin-mainnet'],
            timeoutMs: 500,
        });
        expect(counter.n).toBe(0);
        expect(res.perChain[0].services.explorer).toBe('reachable');
    });

    it('counts a rate-limited explorer as reachable', async () => {
        const limited = async () => {
            throw Object.assign(new Error(EXPLORER_BUSY_MESSAGE), { code: 'RATE_LIMITED', service: 'explorer' });
        };
        const res = await checkReachability({
            sdkRegistry: registryOf({ 'bitcoin-mainnet': chainSdk('BTC', 'https://a.example', { n: 0 }, limited) }),
            chainIds: ['bitcoin-mainnet'],
            timeoutMs: 500,
        });
        expect(res.perChain[0].services.explorer).toBe('reachable');
        expect(res.overall).toBe('normal');
    });
});
