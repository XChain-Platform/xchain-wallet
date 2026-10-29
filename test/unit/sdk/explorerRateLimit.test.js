// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The shared SDK host gate: transient read retries, 4xx finality, coalescing,
// pacing when a rate-limit window runs low, and the plain sentence a surfaced
// 429 carries. The last block drives the real SDK ExplorerClient so the SDK's
// own error typing is part of what is proven.

import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    EXPLORER_BUSY_MESSAGE,
    HostRateLimiter,
    installExplorerRateLimit,
    parseRateLimitResetMs,
    parseRetryAfterMs,
    rateLimitWaitMs,
    retryRateLimitedPreflight,
} from '../../../packages/core/src/sdk/explorerRateLimit.js';
import {
    explorerErrorCode,
    explorerReadFailure,
    rateLimitRetryAfterSeconds,
} from '../../../packages/core/src/sdk/explorerErrors.js';
import { serializeError, hydrateEnvelopeError } from '../../../packages/extension/src/background/MessageHost.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

const T0 = 1_760_000_000_000;

afterEach(() => {
    vi.useRealTimers();
});

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

describe('pre-flight rate-limit recovery', () => {
    const unavailable = {
        verdict: 'pass',
        findings: [{
            code: 'DRYRUN_UNAVAILABLE',
            message: 'The network dry-run was unavailable (The XChain explorer is busy. Try again shortly.); relying on client checks.',
        }],
    };

    function sdkWith(limiter) {
        return {
            explorer: {
                client: {
                    defaults: { baseURL: 'https://explorer.example' },
                    __xcRateLimiter: limiter,
                },
            },
        };
    }

    it('honors the recorded Retry-After pause before a fresh attempt', async () => {
        const { limiter, sleeps } = fakeLimiter();
        const sdk = sdkWith(limiter);
        const run = vi.fn(async (attempt) => {
            if (attempt === 0) {
                limiter.block('explorer.example', 7_000, true);
                return unavailable;
            }
            return { verdict: 'fail', findings: [] };
        });

        await expect(retryRateLimitedPreflight(sdk, run, { sleep: limiter.sleep }))
            .resolves.toMatchObject({ verdict: 'fail' });
        expect(run.mock.calls.map(([attempt]) => attempt)).toEqual([0, 1]);
        expect(sleeps).toEqual([7_000]);
    });

    it('returns the local-only report when Retry-After exceeds the total bound', async () => {
        const { limiter, sleeps } = fakeLimiter();
        const sdk = sdkWith(limiter);
        const run = vi.fn(async () => {
            limiter.block('explorer.example', 61_000, true);
            return unavailable;
        });

        await expect(retryRateLimitedPreflight(sdk, run, { sleep: limiter.sleep }))
            .resolves.toBe(unavailable);
        expect(run).toHaveBeenCalledOnce();
        expect(sleeps).toEqual([]);
    });

    it('does not retry an unreached dry-run that was not rate limited', async () => {
        const { limiter, sleeps } = fakeLimiter();
        const sdk = sdkWith(limiter);
        const timedOut = {
            verdict: 'pass',
            findings: [{
                code: 'DRYRUN_UNAVAILABLE',
                message: 'The network dry-run was unavailable (tier1 timeout after 4000ms); relying on client checks.',
            }],
        };
        const run = vi.fn(async () => timedOut);

        await expect(retryRateLimitedPreflight(sdk, run, { sleep: limiter.sleep }))
            .resolves.toBe(timedOut);
        expect(run).toHaveBeenCalledOnce();
        expect(sleeps).toEqual([]);
    });
});

describe('4xx handling', () => {
    it('surfaces a named 429 without retrying and pauses the next request', async () => {
        const { limiter, sleeps } = fakeLimiter();
        let calls = 0;
        const send = async () => {
            calls += 1;
            if (calls === 1) throw http429({ 'retry-after': '4' });
            return ok('fine');
        };
        await expect(limiter.request('h', null, send, () => new Error('unused')))
            .rejects.toMatchObject({ response: { status: 429 } });
        expect(calls).toBe(1);

        const res = await limiter.request('h', null, send, () => new Error('unused'));
        expect(res.data).toBe('fine');
        expect(calls).toBe(2);
        // Later work honors the pause plus bounded wake-up jitter.
        expect(sleeps[0]).toBeGreaterThanOrEqual(4_000);
        expect(sleeps[0]).toBeLessThanOrEqual(5_000);
    });

    it('reports a host paused after a network failure as a network error, never a 429', async () => {
        const { limiter } = fakeLimiter({ maxTotalMs: 1_000, baseBackoffMs: 18_000, maxRetries: 0 });
        const offline = async () => { throw Object.assign(new Error('offline'), { code: 'ERR_NETWORK' }); };
        const paused = (s, rateLimited) => Object.assign(new Error(rateLimited ? 'rate' : 'net'), { rateLimited });
        await expect(limiter.request('h', null, offline, paused)).rejects.toMatchObject({ code: 'ERR_NETWORK' });
        // The next call meets the backoff pause, which is longer than the layer waits.
        await expect(limiter.request('h', null, async () => ok('x'), paused))
            .rejects.toMatchObject({ rateLimited: false });
        expect(limiter.pausedSeconds('h')).toBe(0);
    });

    it('still reports a host paused by a 429 as rate limited', async () => {
        const { limiter } = fakeLimiter({ maxTotalMs: 1_000 });
        const paused = (s, rateLimited) => Object.assign(new Error('rate'), { rateLimited, s });
        await expect(limiter.request('h', null, async () => { throw http429({ 'retry-after': '18' }); }, paused))
            .rejects.toMatchObject({ response: { status: 429 } });
        await expect(limiter.request('h', null, async () => ok('x'), paused))
            .rejects.toMatchObject({ rateLimited: true, s: 18 });
        expect(limiter.pausedSeconds('h')).toBe(18);
    });

    it('never retries any other 4xx response', async () => {
        const { limiter, sleeps } = fakeLimiter();
        let calls = 0;
        const error = Object.assign(new Error('bad request'), {
            response: { status: 400, headers: {} },
        });
        await expect(limiter.request('h', null, async () => {
            calls += 1;
            throw error;
        }, () => null)).rejects.toBe(error);
        expect(calls).toBe(1);
        expect(sleeps).toEqual([]);
    });

    it('backs off later calls after header-less 429 responses', async () => {
        const { limiter, sleeps } = fakeLimiter({ baseBackoffMs: 1_000 });
        let calls = 0;
        const fail = async () => {
            calls += 1;
            throw http429();
        };
        await limiter.request('h', null, fail, () => null).catch(() => {});
        await limiter.request('h', null, fail, () => null).catch(() => {});
        expect(calls).toBe(2);
        expect(sleeps[0]).toBeGreaterThanOrEqual(1_000);
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
        const { limiter } = fakeLimiter({ maxRetries: 0, maxConcurrency: 6 });
        let release;
        const gate = new Promise((r) => { release = r; });
        const fail = async () => { await gate; throw http429(); };
        const burst = Array.from({ length: 6 }, () => limiter.request('h', null, fail, () => null).catch(() => {}));
        release();
        await Promise.all(burst);
        expect(limiter.state('h').strikes).toBe(1);
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

describe('transient read retry policy', () => {
    it('retries HTTP 500 after jittered backoff with fake timers', async () => {
        vi.useFakeTimers();
        const limiter = new HostRateLimiter({ baseBackoffMs: 100, random: () => 0 });
        let calls = 0;
        const pending = limiter.request('h', null, async () => {
            calls += 1;
            if (calls === 1) {
                throw Object.assign(new Error('server failed'), {
                    response: { status: 500, headers: {} },
                });
            }
            return ok('fine');
        }, () => null, 1);

        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toBe(1);
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toMatchObject({ data: 'fine' });
        expect(calls).toBe(2);
    });

    it('retries network errors but caps the caller retry budget', async () => {
        vi.useFakeTimers();
        const limiter = new HostRateLimiter({ maxRetries: 2, baseBackoffMs: 100, random: () => 0 });
        let calls = 0;
        const pending = limiter.request('h', null, async () => {
            calls += 1;
            throw Object.assign(new Error('offline'), { code: 'ERR_NETWORK' });
        }, () => null, 20);
        const rejected = expect(pending).rejects.toMatchObject({ code: 'ERR_NETWORK' });

        await vi.runAllTimersAsync();
        await rejected;
        expect(calls).toBe(3);
    });

    it('caps retry concurrency after one trial clears a concurrent failure wave', async () => {
        vi.useFakeTimers();
        const limiter = new HostRateLimiter({
            maxRetries: 1, baseBackoffMs: 100, maxConcurrentRetries: 2, random: () => 0,
        });
        let retriesStarted = 0;
        let activeRetries = 0;
        let peakRetries = 0;
        const sends = Array.from({ length: 6 }, () => {
            let calls = 0;
            return async () => {
                calls += 1;
                if (calls === 1) {
                    throw Object.assign(new Error('unavailable'), {
                        response: { status: 503, headers: {} },
                    });
                }
                retriesStarted += 1;
                activeRetries += 1;
                peakRetries = Math.max(peakRetries, activeRetries);
                await new Promise((resolve) => setTimeout(resolve, 10));
                activeRetries -= 1;
                return ok('fine');
            };
        });
        const pending = sends.map((send) => limiter.request('h', null, send, () => null, 1));

        await vi.advanceTimersByTimeAsync(75);
        expect(retriesStarted).toBe(1);
        await vi.runAllTimersAsync();
        await expect(Promise.all(pending)).resolves.toHaveLength(6);
        expect(retriesStarted).toBe(6);
        expect(peakRetries).toBe(2);
    });
});

describe('SDK service policy', () => {
    it('retries encoder reads but never retries broadcasts', async () => {
        vi.useFakeTimers();
        const limiter = new HostRateLimiter({ maxRetries: 1, baseBackoffMs: 100, random: () => 0 });
        const calls = { health: 0, broadcast_tx: 0 };
        const client = {
            defaults: { baseURL: 'https://encoder.test' },
            post: vi.fn(async (_url, body) => {
                calls[body.method] += 1;
                if (body.method === 'health' && calls.health > 1) return ok({ result: { healthy: true } });
                throw Object.assign(new Error('server failed'), {
                    response: { status: 503, headers: {} },
                });
            }),
        };
        const sdk = { encoder: { client, retry: { maxRetries: 1 } } };
        installExplorerRateLimit(sdk, limiter);

        const health = sdk.encoder.client.post('/', { method: 'health', params: {}, id: 1 });
        await vi.runAllTimersAsync();
        await expect(health).resolves.toMatchObject({ status: 200 });
        expect(calls.health).toBe(2);

        await expect(sdk.encoder.client.post('/', {
            method: 'broadcast_tx', params: { tx_hex: '00' }, id: 2,
        })).rejects.toMatchObject({ response: { status: 503 } });
        expect(calls.broadcast_tx).toBe(1);
        expect(sdk.encoder.retry).toBe(false);
    });

    it('retries transient hub discovery without retrying a hub 4xx', async () => {
        vi.useFakeTimers();
        const limiter = new HostRateLimiter({ maxRetries: 1, baseBackoffMs: 100, random: () => 0 });
        const unavailable = (status) => Object.assign(new Error('hub unavailable'), {
            name: 'SDKHubError',
            code: 'HUB_UNAVAILABLE',
            details: { error: `Request failed with status code ${status}` },
        });
        const discover = vi.fn()
            .mockRejectedValueOnce(unavailable(503))
            .mockResolvedValueOnce({ bitcoin: {} });
        const sdk = { hub: { url: 'https://hub.test', getDiscoveryConfig: discover } };
        installExplorerRateLimit(sdk, limiter);

        const pending = sdk.hub.getDiscoveryConfig();
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toEqual({ bitcoin: {} });
        expect(discover).toHaveBeenCalledTimes(2);

        discover.mockRejectedValueOnce(unavailable(404));
        await expect(sdk.hub.getDiscoveryConfig()).rejects.toMatchObject({ code: 'HUB_UNAVAILABLE' });
        expect(discover).toHaveBeenCalledTimes(3);
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

describe('shared host concurrency', () => {
    it('keeps a request wave at the configured concurrency ceiling', async () => {
        const { limiter } = fakeLimiter({ maxConcurrency: 4 });
        const releases = [];
        let active = 0;
        let peak = 0;
        let sent = 0;
        const send = () => {
            sent += 1;
            active += 1;
            peak = Math.max(peak, active);
            return new Promise((resolve) => {
                releases.push(() => {
                    active -= 1;
                    resolve(ok(sent));
                });
            });
        };
        const pending = Promise.all(Array.from(
            { length: 10 },
            () => limiter.request('h', null, send, () => null),
        ));

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(sent).toBe(4);
        expect(peak).toBe(4);

        while (sent < 10 || releases.length > 0) {
            const release = releases.shift();
            if (release) release();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        await pending;
        expect(peak).toBe(4);
        expect(active).toBe(0);
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

    it('surfaces a 429 without replaying the SDK read', async () => {
        const { limiter } = fakeLimiter();
        let calls = 0;
        const ex = realExplorer(async () => {
            calls += 1;
            throw Object.assign(http429({ 'retry-after': '2' }), { isAxiosError: true });
        });
        const sdk = installExplorerRateLimit({ explorer: ex }, limiter);
        await expect(sdk.explorer.get('/lists/bc1qx/address'))
            .rejects.toMatchObject({ code: 'RATE_LIMITED' });
        expect(calls).toBe(1);
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

    it('surfaces a 429 as the plain sentence, with the wait kept for the screens', async () => {
        const { limiter } = fakeLimiter({ maxRetries: 1 });
        let calls = 0;
        const ex = realExplorer(async () => {
            calls += 1;
            throw Object.assign(http429({ 'retry-after': '3' }), { isAxiosError: true });
        });
        const sdk = installExplorerRateLimit({ explorer: ex }, limiter);
        const err = await sdk.explorer.get('/lists/bc1qx/address').catch((e) => e);
        // A 4xx is final for this call even when the general retry budget remains.
        expect(calls).toBe(1);
        expect(err.message).toBe(EXPLORER_BUSY_MESSAGE);
        expect(err.message).not.toMatch(/HTTP|\/api\//);
        expect(err.code).toBe('RATE_LIMITED');
        expect(err.retryAfterSeconds).toBe(3);
        expect(err.retryAfterMs).toBe(3_000);
        expect(err.detail).toMatch(/Explorer returned HTTP 429 for \/BTC\/api\/lists/);
        expect(explorerReadFailure(err, 'load lists').cause).toBe('rate_limited');
    });

    it('does not retry an explorer POST read after a 429', async () => {
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
