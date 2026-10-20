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
