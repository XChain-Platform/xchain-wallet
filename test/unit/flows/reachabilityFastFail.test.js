// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: the reachability probe's fast-fail verdict.
//
// The wallet's request layer retries a refused request behind a backoff, so a
// probe whose connection is turned away still sits until its 3 s budget ends.
// The probe answers "offline, refused outright" as soon as every configured
// service has refused, from its own failure or from a direct connection check.
// A slow service, an HTTP error answer, or a single failing service keeps the wait.

import { describe, it, expect, vi } from 'vitest';
import { checkReachability } from '../../../packages/core/src/flows/reachability.js';

const NETWORK_ERROR = () => new Error('Encoder request failed: Network Error');
const hangs = () => new Promise(() => {});

function sdkWith({ encoder, hub, explorer }) {
    return {
        pingEncoder: encoder,
        pingHub: hub,
        getStatus: explorer,
        encoder: { client: { defaults: { baseURL: 'https://encoder.example:3003' } } },
        hub: { urls: ['https://hub.example:10000'], _lastGoodIdx: 0 },
        explorer: { client: { defaults: { baseURL: 'https://explorer.example:8080' } } },
    };
}

const registryFor = (sdk) => ({ get: () => sdk });

async function run(sdk, extra = {}) {
    return checkReachability({
        sdkRegistry: registryFor(sdk),
        chainIds: ['bitcoin-mainnet'],
        timeoutMs: 400,
        wireDelayMs: 20,
        wireTimeoutMs: 100,
        ...extra,
    });
}

describe('checkReachability fast-fail verdict', () => {
    it('flags failedFast when every probe fails with a network error', async () => {
        const failing = async () => { throw NETWORK_ERROR(); };
        const res = await run(sdkWith({ encoder: failing, hub: async () => false, explorer: failing }));
        expect(res.overall).toBe('offline');
        expect(res.failedFast).toBe(true);
        expect(res.perChain[0].failedFast).toBe(true);
    });

    it('answers after the direct check refuses, without waiting out probes that are still retrying', async () => {
        const started = Date.now();
        const res = await run(
            sdkWith({ encoder: hangs, hub: async () => false, explorer: hangs }),
            { timeoutMs: 5000, wireCheck: async () => 'refused' },
        );
        expect(Date.now() - started).toBeLessThan(1500);
        expect(res.overall).toBe('offline');
        expect(res.failedFast).toBe(true);
        expect(res.perChain[0].services).toEqual({ encoder: 'unreachable', hub: 'unreachable', explorer: 'unreachable' });
        expect(res.perChain[0].errors.encoder).toBe('connection refused');
    });

    it('keeps the wait when a probe merely times out and the link only looks slow', async () => {
        const res = await run(
            sdkWith({ encoder: hangs, hub: async () => false, explorer: hangs }),
            { timeoutMs: 120, wireCheck: async () => 'unknown' },
        );
        expect(res.overall).toBe('offline');
        expect(res.failedFast).toBeUndefined();
        expect(res.perChain[0].errors.encoder).toMatch(/timed out/);
    });

    it('does not trust a direct check that got an answer', async () => {
        const res = await run(
            sdkWith({ encoder: hangs, hub: async () => false, explorer: hangs }),
            { timeoutMs: 120, wireCheck: async () => 'answered' },
        );
        expect(res.failedFast).toBeUndefined();
    });

    it('a single failing service stays degraded and never fast-fails', async () => {
        const ok = async () => true;
        const res = await run(
            sdkWith({ encoder: ok, hub: async () => false, explorer: ok }),
            { wireCheck: async () => 'refused' },
        );
        expect(res.overall).toBe('degraded');
        expect(res.failedFast).toBeUndefined();
        expect(res.perChain[0].failedFast).toBeUndefined();
    });

    it('does not take an HTTP 500 answer for a refused connection', async () => {
        const http500 = async () => { throw new Error('Encoder request failed: status 500'); };
        const res = await run(sdkWith({ encoder: http500, hub: async () => false, explorer: async () => { throw NETWORK_ERROR(); } }));
        expect(res.overall).toBe('offline');
        expect(res.failedFast).toBeUndefined();
    });

    it('asks nothing directly when the services answer promptly', async () => {
        const calls = [];
        const ok = async () => true;
        const wireDelayMs = 200;
        vi.useFakeTimers();
        try {
            const res = await run(
                sdkWith({ encoder: ok, hub: ok, explorer: ok }),
                { wireDelayMs, wireCheck: async (...args) => { calls.push(args); return 'refused'; } },
            );
            expect(res.overall).toBe('normal');
            // Run the clock well past the wire delay, so a direct check left armed would fire here.
            await vi.advanceTimersByTimeAsync(wireDelayMs * 2);
            expect(calls).toHaveLength(0);
        } finally {
            vi.useRealTimers();
        }
    });
});

// Replays of a regtest web-shell trace (tokens/airdrop.regtest.spec.js:920,
// four shard drivers loading the explorer). Every service answered, yet the
// form said the wallet had no network connection:
//   - the encoders answered their pings in about 250 ms;
//   - the hub answered without CORS headers, so its ping failed in the browser;
//   - the explorer's /status was slow (2.8 s) or held behind a 429 pause;
//   - 800 ms in, the direct checks went to every service, the ones that had
//     already answered included, and each came back blocked by the services'
//     Cross-Origin-Resource-Policy: same-origin header, which fetch reports
//     exactly like a refused connection.
// The round was called offline-refused and published at once.
describe('checkReachability under load, as the trace showed it', () => {
    const CHAINS = ['bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest'];
    const answersAfter = (ms, value = { ok: true }) => () => new Promise((resolve) => setTimeout(() => resolve(value), ms));

    it('never lets a direct check overrule a service that already answered', async () => {
        const wired = [];
        const res = await checkReachability({
            sdkRegistry: registryFor(sdkWith({ encoder: async () => true, hub: async () => false, explorer: answersAfter(150) })),
            chainIds: CHAINS,
            timeoutMs: 600,
            wireDelayMs: 40,
            wireTimeoutMs: 100,
            wireCheck: async (_sdk, service) => { wired.push(service); return 'refused'; },
        });
        expect(wired).not.toContain('encoder');
        expect(res.failedFast).toBeUndefined();
        expect(res.overall).toBe('degraded');
        for (const chain of res.perChain) {
            expect(chain.services).toEqual({ encoder: 'reachable', hub: 'unreachable', explorer: 'reachable' });
        }
    });

    it('counts an explorer held behind a rate-limit pause as reachable, from the direct check and at the budget', async () => {
        let pausedFor = 0;
        const limiter = { pausedSeconds: () => pausedFor };
        const sdk = sdkWith({ encoder: async () => true, hub: async () => false, explorer: hangs });
        sdk.explorer.client.__xcRateLimiter = limiter;
        // The 429 that pauses the host lands on another request after the probe has queued.
        setTimeout(() => { pausedFor = 6; }, 10);
        const res = await checkReachability({
            sdkRegistry: registryFor(sdk),
            chainIds: CHAINS,
            timeoutMs: 200,
            wireDelayMs: 40,
            wireTimeoutMs: 100,
            wireCheck: async () => 'refused',
        });
        expect(res.failedFast).toBeUndefined();
        expect(res.overall).toBe('degraded');
        expect(res.perChain[0].services.explorer).toBe('reachable');
    });

    it('reads a response the browser withheld for its resource policy as an answer, not a refusal', async () => {
        const modes = [];
        vi.stubGlobal('fetch', async (_url, init) => {
            modes.push(init.mode);
            // A no-cors read of a Cross-Origin-Resource-Policy: same-origin response
            // rejects exactly like a refused connection; the CORS read gets through.
            if (init.mode === 'no-cors') throw new TypeError('Failed to fetch');
            return { status: 200 };
        });
        try {
            const res = await run(
                sdkWith({ encoder: hangs, hub: async () => false, explorer: hangs }),
                { timeoutMs: 250, wireDelayMs: 20, wireTimeoutMs: 100 },
            );
            expect(modes).toContain('cors');
            expect(res.failedFast).toBeUndefined();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('still calls a refused connection refused when neither read gets an answer', async () => {
        vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
        try {
            const res = await run(
                sdkWith({ encoder: hangs, hub: async () => false, explorer: hangs }),
                { timeoutMs: 5000, wireDelayMs: 20, wireTimeoutMs: 100 },
            );
            expect(res.overall).toBe('offline');
            expect(res.failedFast).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
