// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The shared explorer rate-limit layer: header parsing, the 429 retry and its
// cap, coalescing of identical GETs, pacing when the window runs low, and the
// plain sentence a surfaced 429 carries. The last block drives the real SDK
// ExplorerClient so the SDK's own error typing is part of what is proven.

import { describe, it, expect } from 'vitest';
import {
    EXPLORER_BUSY_MESSAGE,
    HostRateLimiter,
    installExplorerRateLimit,
    parseRateLimitResetMs,
    parseRetryAfterMs,
    rateLimitWaitMs,
} from '../../../packages/core/src/sdk/explorerRateLimit.js';
import {
    explorerErrorCode,
    explorerReadFailure,
    rateLimitRetryAfterSeconds,
} from '../../../packages/core/src/sdk/explorerErrors.js';
import { serializeError, hydrateEnvelopeError } from '../../../packages/extension/src/background/MessageHost.js';
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
    return { limiter, sleeps, now: () => t, advance: (ms) => { t += ms; } };
}

function http429(headers = {}) {
    const err = /** @type {any} */ (new Error('Request failed with status code 429'));
    err.response = { status: 429, headers, data: null };
    return err;
}

function ok(data, headers = {}) {
    return { status: 200, data, headers };
}

describe('Retry-After and ratelimit-reset parsing', () => {
    it('reads Retry-After as delta seconds', () => {
        expect(parseRetryAfterMs('12', T0)).toBe(12_000);
        expect(parseRetryAfterMs(' 0 ', T0)).toBe(0);
    });

    it('reads Retry-After as an HTTP date relative to now', () => {
        const at = new Date(T0 + 7_000).toUTCString();
        expect(parseRetryAfterMs(at, T0)).toBe(7_000);
        expect(parseRetryAfterMs(new Date(T0 - 5_000).toUTCString(), T0)).toBe(0);
    });

    it('returns null for absent or unreadable values', () => {
        expect(parseRetryAfterMs(undefined, T0)).toBeNull();
        expect(parseRetryAfterMs('', T0)).toBeNull();
        expect(parseRetryAfterMs('soon', T0)).toBeNull();
        expect(parseRateLimitResetMs('soon', T0)).toBeNull();
        expect(parseRateLimitResetMs(null, T0)).toBeNull();
    });

    it('reads ratelimit-reset as delta seconds, or as an epoch second when it is that large', () => {
        expect(parseRateLimitResetMs('41', T0)).toBe(41_000);
        expect(parseRateLimitResetMs(String((T0 + 9_000) / 1000), T0)).toBe(9_000);
    });

    it('prefers Retry-After and falls back to ratelimit-reset, case-insensitively', () => {
        expect(rateLimitWaitMs({ 'retry-after': '3', 'ratelimit-reset': '40' }, T0)).toBe(3_000);
        expect(rateLimitWaitMs({ 'RateLimit-Reset': '40' }, T0)).toBe(40_000);
        expect(rateLimitWaitMs({ get: (n) => (n === 'retry-after' ? '5' : undefined) }, T0)).toBe(5_000);
        expect(rateLimitWaitMs({}, T0)).toBeNull();
    });
});

describe('429 retry', () => {
    it('waits the named Retry-After, then retries and succeeds', async () => {
        const { limiter, sleeps } = fakeLimiter();
        let calls = 0;
        const res = await limiter.request('h', null, async () => {
            calls += 1;
            if (calls === 1) throw http429({ 'retry-after': '4' });
            return ok('fine');
        }, () => new Error('unused'));
        expect(res.data).toBe('fine');
        expect(calls).toBe(2);
        // 4 s plus a bounded jitter, never less than asked.
        expect(sleeps[0]).toBeGreaterThanOrEqual(4_000);
        expect(sleeps[0]).toBeLessThanOrEqual(5_000);
    });

    it('backs off with doubling, jittered waits when the 429 names no wait', async () => {
        const { limiter, sleeps } = fakeLimiter({ baseBackoffMs: 1_000 });
        let calls = 0;
        await limiter.request('h', null, async () => {
            calls += 1;
            if (calls <= 2) throw http429();
            return ok(1);
        }, () => new Error('unused'));
        expect(calls).toBe(3);
        const [first, second] = sleeps;
        expect(first).toBeGreaterThanOrEqual(1_000);
        expect(second).toBeGreaterThanOrEqual(2_000);
        expect(second).toBeGreaterThan(first);
    });

    it('stops after the retry budget and surfaces the last 429', async () => {
        const { limiter } = fakeLimiter({ maxRetries: 2 });
        let calls = 0;
        await expect(limiter.request('h', null, async () => {
            calls += 1;
            throw http429({ 'retry-after': '1' });
        }, () => new Error('unused'))).rejects.toMatchObject({ response: { status: 429 } });
        expect(calls).toBe(3);
    });

    it('raises the backoff for the host, so each fresh wave after a header-less 429 waits longer', async () => {
        const { limiter, sleeps } = fakeLimiter({ baseBackoffMs: 1_000, maxRetries: 0 });
        const fail = async () => { throw http429(); };
        for (let i = 0; i < 3; i++) await limiter.request('h', null, fail, () => null).catch(() => {});
        // The second and third requests waited out the pauses the earlier 429s set.
        expect(sleeps.length).toBe(2);
        expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
        // A success resets the level for the next 429.
        await limiter.request('h', null, async () => ok(1), () => null);
        expect(limiter.state('h').strikes).toBe(0);
    });

    it('counts a burst of concurrent 429s as one strike, not one per request', async () => {
        const { limiter } = fakeLimiter({ maxRetries: 0 });
        let release;
        const gate = new Promise((r) => { release = r; });
        const fail = async () => { await gate; throw http429(); };
        const burst = Array.from({ length: 6 }, () => limiter.request('h', null, fail, () => null).catch(() => {}));
        release();
        await Promise.all(burst);
        expect(limiter.state('h').strikes).toBe(1);
    });

    it('sends one trial request after a 429 and holds the rest until it answers', async () => {
        const { limiter } = fakeLimiter({ baseBackoffMs: 1_000 });
        let window = 'empty';
        let sent = 0;
        const send = async () => {
            sent += 1;
            if (window === 'empty') { window = 'refilled'; throw http429(); }
            return ok('fine');
        };
        await limiter.request('h', null, send, () => null);
        expect(sent).toBe(2);
        // Now the window is empty again: the next wave of five sends one trial,
        // and only after it succeeds do the other four go.
        window = 'empty';
        sent = 0;
        const wave = await Promise.all(Array.from({ length: 5 }, () => limiter.request('h', null, send, () => null)));
        expect(wave.every((r) => r.data === 'fine')).toBe(true);
        expect(sent).toBe(6);
        expect(limiter.state('h').needsTrial).toBe(false);
    });

    it('gives up a request that has spent its total time budget waiting', async () => {
        const { limiter } = fakeLimiter({ maxWaitMs: 30_000, maxTotalMs: 10_000 });
        limiter.block('h', 20_000);
        let sent = 0;
        const err = await limiter.request('h', null, async () => { sent += 1; return ok(1); },
            (seconds) => Object.assign(new Error('paused'), { seconds })).catch((e) => e);
        expect(sent).toBe(0);
        expect(err.seconds).toBe(20);
    });

    it('does not retry other failures', async () => {
        const { limiter } = fakeLimiter();
        let calls = 0;
        const boom = Object.assign(new Error('502'), { response: { status: 502, headers: {} } });
        await expect(limiter.request('h', null, async () => { calls += 1; throw boom; }, () => null))
            .rejects.toBe(boom);
        expect(calls).toBe(1);
    });

    it('can gate a non-GET request without retrying its 429 response', async () => {
        const { limiter } = fakeLimiter();
        let calls = 0;
        await expect(limiter.request('h', null, async () => {
            calls += 1;
            throw http429();
        }, () => null, 0)).rejects.toMatchObject({ response: { status: 429 } });
        expect(calls).toBe(1);
    });
});

describe('the wait cap', () => {
    it('cancels a paused request before the Retry-After wait expires', async () => {
        const limiter = new HostRateLimiter({ random: () => 0 });
        const controller = new AbortController();
        let sent = 0;
        limiter.block('h', 30_000);

        const pending = limiter.request(
            'h', null, async () => { sent += 1; return ok(1); }, () => null,
            undefined, controller.signal,
        );
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(sent).toBe(0);
    });

    it('does not sit through a wait longer than the cap; it surfaces the 429 at once', async () => {
        const { limiter, sleeps } = fakeLimiter({ maxWaitMs: 10_000 });
        let calls = 0;
        await expect(limiter.request('h', null, async () => {
            calls += 1;
            throw http429({ 'retry-after': '45' });
        }, () => new Error('unused'))).rejects.toMatchObject({ response: { status: 429 } });
        expect(calls).toBe(1);
        expect(sleeps).toEqual([]);
    });

    it('fails later requests fast while the host is paused past the cap, without sending them', async () => {
        const { limiter } = fakeLimiter({ maxWaitMs: 10_000 });
        await expect(limiter.request('h', null, async () => { throw http429({ 'retry-after': '45' }); },
            () => new Error('unused'))).rejects.toBeTruthy();
        let sent = 0;
        const paused = await limiter.request('h', null, async () => { sent += 1; return ok(1); },
            (seconds) => Object.assign(new Error('paused'), { seconds })).catch((e) => e);
        expect(sent).toBe(0);
        expect(paused.seconds).toBe(45);
        expect(limiter.pausedSeconds('h')).toBe(45);
    });

    it('holds other requests to the same host until a short pause ends, then sends them', async () => {
        const { limiter, now } = fakeLimiter();
        limiter.block('h', 3_000);
        const startedAt = now();
        let sentAt = null;
        await limiter.request('h', null, async () => { sentAt = now(); return ok(1); }, () => null);
        expect(sentAt - startedAt).toBeGreaterThanOrEqual(3_000);
        // A different host is not held.
        let otherSentAt = null;
        limiter.block('h', 3_000);
        const before = now();
        await limiter.request('other', null, async () => { otherSentAt = now(); return ok(1); }, () => null);
        expect(otherSentAt).toBe(before);
    });
});

describe('coalescing identical GETs', () => {
    it('shares one in-flight request between concurrent identical callers', async () => {
        const { limiter } = fakeLimiter();
        let sent = 0;
        let release;
        const gate = new Promise((r) => { release = r; });
        const send = async () => { sent += 1; await gate; return ok({ rows: [1, 2] }); };
        const a = limiter.request('h', 'GET /x', send, () => null);
        const b = limiter.request('h', 'GET /x', send, () => null);
        release();
        const [ra, rb] = await Promise.all([a, b]);
        expect(sent).toBe(1);
        expect(ra.data).toEqual({ rows: [1, 2] });
        expect(rb.data).toEqual({ rows: [1, 2] });
        // Each caller owns its copy of the body.
        expect(ra.data).not.toBe(rb.data);
    });

    it('serves a GET that finished inside the reuse window, and re-sends after it', async () => {
        const { limiter, advance } = fakeLimiter({ reuseMs: 2_000 });
        let sent = 0;
        const send = async () => { sent += 1; return ok(sent); };
        await limiter.request('h', 'GET /y', send, () => null);
        advance(1_000);
        expect((await limiter.request('h', 'GET /y', send, () => null)).data).toBe(1);
        advance(1_500);
        expect((await limiter.request('h', 'GET /y', send, () => null)).data).toBe(2);
        expect(sent).toBe(2);
    });

    it('never coalesces uncoalescable requests (a null key)', async () => {
        const { limiter } = fakeLimiter();
        let sent = 0;
        const send = async () => { sent += 1; return ok(sent); };
        await Promise.all([limiter.request('h', null, send, () => null), limiter.request('h', null, send, () => null)]);
        expect(sent).toBe(2);
    });

    it('does not keep a failure for reuse', async () => {
        const { limiter } = fakeLimiter();
        let sent = 0;
        const send = async () => { sent += 1; if (sent === 1) throw new Error('down'); return ok('up'); };
        await expect(limiter.request('h', 'GET /z', send, () => null)).rejects.toThrow('down');
        expect((await limiter.request('h', 'GET /z', send, () => null)).data).toBe('up');
    });
});

describe('explorer response integrity', () => {
    it('requires strict JSON parsing on the axios client', () => {
        const client = {
            defaults: { baseURL: 'https://explorer.test' },
            get: async () => ok({}),
        };
        installExplorerRateLimit({ explorer: { client } }, fakeLimiter().limiter);

        expect(client.defaults.responseType).toBe('json');
        expect(client.defaults.transitional).toMatchObject({ silentJSONParsing: false });
    });

    it('rejects a response from a client replaced during the request', async () => {
        let finish;
        let markStarted;
        const started = new Promise((resolve) => { markStarted = resolve; });
        const first = {
            defaults: { baseURL: 'https://old-explorer.test' },
            get: () => new Promise((resolve) => {
                finish = resolve;
                markStarted();
            }),
        };
        const second = {
            defaults: { baseURL: 'https://new-explorer.test' },
            get: async () => ok('new'),
        };
        const explorer = {
            client: first,
            buildClient() { this.client = second; },
            get(path) { return this.client.get(path); },
        };
        installExplorerRateLimit({ explorer }, fakeLimiter().limiter);

        const pending = explorer.get('/status');
        await started;
        explorer.buildClient();
        finish(ok('old'));

        await expect(pending).rejects.toMatchObject({
            name: 'NetworkChangedError',
            code: 'EXPLORER_NETWORK_CHANGED',
        });
    });
});

describe('pacing when ratelimit-remaining runs low', () => {
    it('spreads requests over what is left of the window', async () => {
        const { limiter, sleeps } = fakeLimiter({ lowWater: 5 });
        // 4 left, window resets in 20 s: about one request every 5 s.
        limiter.observe('h', { 'ratelimit-remaining': '4', 'ratelimit-reset': '20' });
        for (let i = 0; i < 3; i++) await limiter.request('h', null, async () => ok(i), () => null);
        expect(sleeps.length).toBe(2);
        for (const ms of sleeps) expect(ms).toBeGreaterThanOrEqual(4_000);
    });

    it('does not pace while plenty of the window is left', async () => {
        const { limiter, sleeps } = fakeLimiter({ lowWater: 5 });
        limiter.observe('h', { 'ratelimit-remaining': '150', 'ratelimit-reset': '30' });
        for (let i = 0; i < 5; i++) await limiter.request('h', null, async () => ok(i), () => null);
        expect(sleeps).toEqual([]);
    });

    it('treats an empty window as a pause until it resets', () => {
        const { limiter } = fakeLimiter();
        limiter.observe('h', { 'ratelimit-remaining': '0', 'ratelimit-reset': '12' });
        expect(limiter.pausedSeconds('h')).toBe(12);
    });
});

describe('the friendly message across the wallet', () => {
    it('is recognised as a rate limit even after the messaging envelope strips the fields', () => {
        const err = Object.assign(new Error(EXPLORER_BUSY_MESSAGE), {
            name: 'SDKRateLimitedError', code: 'RATE_LIMITED', retryAfterSeconds: 9, retryAfterMs: 9_000,
        });
        const crossed = hydrateEnvelopeError(serializeError(err).error);
        expect(crossed.message).toBe(EXPLORER_BUSY_MESSAGE);
        expect(explorerErrorCode(crossed)).toBe('RATE_LIMITED');
        expect(rateLimitRetryAfterSeconds(crossed)).toBe(9);
        expect(explorerErrorCode({ message: EXPLORER_BUSY_MESSAGE })).toBe('RATE_LIMITED');
        expect(explorerReadFailure(crossed, 'load lists')).toMatchObject({ cause: 'rate_limited', retryAfterSeconds: 9 });
    });
});

const sdkReady = sdkInstalled();

describe.skipIf(!sdkReady)('installed on the real SDK ExplorerClient', () => {
    function realExplorer(stubGet, stubPost) {
        const ExplorerClient = requireSdkDeep('explorerClient');
        const ex = new ExplorerClient({
            network: 'bitcoin-mainnet',
            explorerUrl: 'https://explorer.example',
            retry: { maxRetries: 1, baseDelay: 1, maxDelay: 2, retryAfterMaxDelay: 60_000 },
        });
        ex.client.get = stubGet;
        if (stubPost) ex.client.post = stubPost;
        return ex;
    }

    it('retries a 429 inside the layer and returns the data to the SDK caller', async () => {
        const { limiter } = fakeLimiter();
        let calls = 0;
        const ex = realExplorer(async () => {
            calls += 1;
            if (calls === 1) throw Object.assign(http429({ 'retry-after': '2' }), { isAxiosError: true });
            return ok({ data: ['list'] });
        });
        const sdk = installExplorerRateLimit({ explorer: ex }, limiter);
        await expect(sdk.explorer.get('/lists/bc1qx/address')).resolves.toEqual({ data: ['list'] });
        expect(calls).toBe(2);
    });

    it('rejects malformed JSON instead of returning it as successful data', async () => {
        const ExplorerClient = requireSdkDeep('explorerClient');
        const ex = new ExplorerClient({
            network: 'bitcoin-mainnet',
            explorerUrl: 'https://explorer.example',
        });
        installExplorerRateLimit({ explorer: ex }, fakeLimiter().limiter);
        ex.client.defaults.adapter = async (config) => ({
            data: '{"broken":',
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            config,
            request: {},
        });

        await expect(ex.client.get('/BTC/api/status')).rejects.toBeTruthy();
    });

    it('surfaces an exhausted 429 as the plain sentence, with the wait kept for the screens', async () => {
        const { limiter } = fakeLimiter({ maxRetries: 1 });
        let calls = 0;
        const ex = realExplorer(async () => {
            calls += 1;
            throw Object.assign(http429({ 'retry-after': '3' }), { isAxiosError: true });
        });
        const sdk = installExplorerRateLimit({ explorer: ex }, limiter);
        const err = await sdk.explorer.get('/lists/bc1qx/address').catch((e) => e);
        // The SDK's own honoured retry is off, so the layer's budget is the only one spent.
        expect(calls).toBe(2);
        expect(err.message).toBe(EXPLORER_BUSY_MESSAGE);
        expect(err.message).not.toMatch(/HTTP|\/api\//);
        expect(err.code).toBe('RATE_LIMITED');
        expect(err.retryAfterSeconds).toBe(3);
        expect(err.retryAfterMs).toBe(3_000);
        expect(err.detail).toMatch(/Explorer returned HTTP 429 for \/BTC\/api\/lists/);
        expect(explorerReadFailure(err, 'load lists').cause).toBe('rate_limited');
    });

    it('does not retry an explorer POST read', async () => {
        const { limiter } = fakeLimiter();
        let calls = 0;
        const ex = realExplorer(async () => ok(1), async () => {
            calls += 1;
            throw Object.assign(http429(), { isAxiosError: true });
        });
        const sdk = installExplorerRateLimit({ explorer: ex }, limiter);

        await expect(sdk.explorer.post('/balances', { addresses: ['bc1q'] }))
            .rejects.toMatchObject({ message: EXPLORER_BUSY_MESSAGE });
        expect(calls).toBe(1);
    });

    it('leaves non-429 explorer errors worded as before', async () => {
        const { limiter } = fakeLimiter();
        const ex = realExplorer(async () => {
            throw Object.assign(new Error('nf'), { isAxiosError: true, response: { status: 404, headers: {} } });
        });
        const sdk = installExplorerRateLimit({ explorer: ex }, limiter);
        const err = await sdk.explorer.get('/asset/NOPE').catch((e) => e);
        expect(err.message).toMatch(/^Explorer returned HTTP 404 for \/BTC\/api\/asset\/NOPE/);
    });

    it('coalesces identical concurrent SDK reads into one HTTP request', async () => {
        const { limiter } = fakeLimiter();
        let calls = 0;
        const ex = realExplorer(async () => { calls += 1; await Promise.resolve(); return ok({ n: calls }); });
        const sdk = installExplorerRateLimit({ explorer: ex }, limiter);
        const [a, b] = await Promise.all([sdk.explorer.get('/status'), sdk.explorer.get('/status')]);
        expect(calls).toBe(1);
        expect(a).toEqual(b);
    });

    it('wraps a client the SDK assigns later and one it rebuilds on setBase', async () => {
        const { limiter } = fakeLimiter();
        const sdk = installExplorerRateLimit({ explorer: realExplorer(async () => ok(1)) }, limiter);
        const ExplorerClient = requireSdkDeep('explorerClient');
        const next = new ExplorerClient({ network: 'bitcoin-mainnet', explorerUrl: 'https://explorer.example' });
        sdk.explorer = next;
        expect(sdk.explorer).toBe(next);
        expect(next.client.__xcRateLimited).toBe(true);
        next.setBase('https://explorer2.example', 443);
        expect(next.client.__xcRateLimited).toBe(true);
    });

    it('leaves a stand-in SDK with no axios-backed explorer untouched', () => {
        const mock = { explorer: { get: async () => 1 } };
        installExplorerRateLimit(mock);
        expect(Object.getOwnPropertyDescriptor(mock, 'explorer')).toHaveProperty('value');
    });
});
