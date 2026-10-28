// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One shared host gate in front of SDK indexer, hub and encoder requests.
//
// The public explorer allows a fixed number of requests per minute per IP
// (`ratelimit-policy: 180;w=60`), and that budget is shared by every chain
// (BTC, LTC and DOGE all live on one host) and by every other device behind
// the same address. So the state lives per HOST, not per SDK instance:
//   - network failures and 5xx responses retry with bounded jittered backoff;
//   - a 429 pauses later calls but is never retried as part of the failed call;
//   - after a transient failure one trial request goes first and the rest wait;
//   - identical GETs already in flight share one network request;
//   - when `ratelimit-remaining` runs low, requests are spaced out over what
//     is left of the window instead of spending it in one burst.
//
// The layer wraps SDK service transports and leaves unknown encoder methods
// single-attempt. A browser only sees rate-limit headers when the server lists
// them in Access-Control-Expose-Headers; without them the 429 path falls back
// to exponential backoff and pacing stays off.

/** The sentence a rate-limited explorer read carries to the screens. */
export const EXPLORER_BUSY_MESSAGE = 'The XChain explorer is busy. Try again shortly.';

export const EXPLORER_RATE_LIMIT_DEFAULTS = Object.freeze({
    // Requests allowed on one host at once. SDK instances for every chain share
    // this queue, so a wallet cannot turn one render into an unbounded burst.
    maxConcurrency: 4,
    // Per-call retries for idempotent reads. Callers may lower this, not raise it.
    maxRetries: 3,
    // Longest single wait the layer will sit through; a longer ask fails fast.
    maxWaitMs: 30_000,
    // Longest a request spends in the layer in total, across all its waits.
    maxTotalMs: 60_000,
    // Backoff for transient failures and a 429 that names no wait.
    baseBackoffMs: 2_000,
    // Recovery waves cannot replay every component's read at once.
    maxConcurrentRetries: 2,
    // Pacing starts once the window has this many requests or fewer left.
    lowWater: 20,
    // A GET that finished this recently is served again instead of re-sent.
    reuseMs: 2_000,
});

function abortError() {
    if (typeof DOMException === 'function') return new DOMException('The request was cancelled.', 'AbortError');
    return Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
}

/**
 * Milliseconds a `Retry-After` value asks for: delta seconds or an HTTP date.
 *
 * @param {unknown} value
 * @param {number} nowMs
 * @returns {number|null}  null when absent or unreadable
 */
export function parseRetryAfterMs(value, nowMs) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (text === '') return null;
    if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
    const at = Date.parse(text);
    if (Number.isNaN(at)) return null;
    return Math.max(0, at - nowMs);
}

/**
 * Milliseconds until the window resets, from a `ratelimit-reset` value.
 *
 * The IETF draft sends delta seconds; some servers send an epoch second
 * instead, which is told apart by size (no window is 30 years long).
 *
 * @param {unknown} value
 * @param {number} nowMs
 * @returns {number|null}
 */
export function parseRateLimitResetMs(value, nowMs) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const n = Number(text);
    if (n > 1_000_000_000) return Math.max(0, Math.round(n * 1000 - nowMs));
    return Math.round(n * 1000);
}

/** A header from an axios headers object or a plain record, case-insensitively. */
function readHeader(headers, name) {
    if (!headers) return undefined;
    if (typeof headers.get === 'function') {
        const v = headers.get(name);
        if (v !== undefined && v !== null) return v;
    }
    if (headers[name] !== undefined) return headers[name];
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) return headers[key];
    }
    return undefined;
}

/**
 * The wait a rate-limited response names: Retry-After first, then the reset.
 *
 * @param {any} headers
 * @param {number} nowMs
 * @returns {number|null}
 */
export function rateLimitWaitMs(headers, nowMs) {
    const retryAfter = parseRetryAfterMs(readHeader(headers, 'retry-after'), nowMs);
    if (retryAfter !== null) return retryAfter;
    return parseRateLimitResetMs(readHeader(headers, 'ratelimit-reset'), nowMs);
}

function statusOf(err) {
    return err && err.response ? err.response.status : null;
}

const NETWORK_ERROR_CODES = new Set([
    'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT',
    'ENOTFOUND', 'EAI_AGAIN', 'ERR_NETWORK',
]);

/** Only transport failures and 5xx responses are safe transient failures. */
function isTransientReadError(err) {
    const status = statusOf(err);
    if (Number.isInteger(status)) return status >= 500 && status <= 599;
    return NETWORK_ERROR_CODES.has(err?.code);
}

/** A copy of an axios response for a second caller, so neither can mutate the other's data. */
function cloneResponse(res) {
    if (!res || typeof res !== 'object') return res;
    let data = res.data;
    try {
        if (data && typeof data === 'object' && typeof structuredClone === 'function') data = structuredClone(data);
    } catch {
        // Uncloneable bodies (an ArrayBuffer view in some engines) are shared as-is.
    }
    return { ...res, data };
}

/** Stable request key: method, base, path and sorted query params. */
function requestKey(method, base, url, params) {
    let query = '';
    if (params && typeof params === 'object') {
        const keys = Object.keys(params).filter((k) => params[k] !== undefined).sort();
        query = keys.map((k) => `${k}=${String(params[k])}`).join('&');
    }
    return `${method} ${base}${url}?${query}`;
}

/**
 * Per-host request gate shared by every SDK instance in the process.
 */
export class HostRateLimiter {
    /**
     * @param {Partial<typeof EXPLORER_RATE_LIMIT_DEFAULTS> & {
     *   now?: () => number, sleep?: (ms: number) => Promise<void>, random?: () => number }} [opts]
     */
    constructor(opts = {}) {
        const { now, sleep, random, ...tuning } = opts;
        this.opts = { ...EXPLORER_RATE_LIMIT_DEFAULTS, ...tuning };
        this.now = now || (() => Date.now());
        this.sleep = sleep || ((ms, signal) => new Promise((resolve, reject) => {
            const timer = setTimeout(done, ms);
            function done() {
                signal?.removeEventListener('abort', cancelled);
                resolve();
            }
            function cancelled() {
                clearTimeout(timer);
                signal?.removeEventListener('abort', cancelled);
                reject(abortError());
            }
            signal?.addEventListener('abort', cancelled, { once: true });
        }));
        this.random = random || Math.random;
        /** @type {Map<string, any>} per-host window, pause and backoff state */
        this.hosts = new Map();
        /** @type {Map<string, Promise<any>>} */
        this.inFlight = new Map();
        /** @type {Map<string, { at: number, res: any }>} */
        this.recent = new Map();
    }

    async sleepUntil(ms, signal) {
        if (signal?.aborted) throw abortError();
        if (!signal) return this.sleep(ms);
        let cancel;
        const cancelled = new Promise((_resolve, reject) => {
            cancel = () => reject(abortError());
            signal.addEventListener('abort', cancel, { once: true });
        });
        try {
            return await Promise.race([this.sleep(ms, signal), cancelled]);
        } finally {
            signal.removeEventListener('abort', cancel);
        }
    }

    /** @param {string} host */
    state(host) {
        let st = this.hosts.get(host);
        if (!st) {
            st = {
                blockedUntil: 0, rateBlockedUntil: 0, remaining: null, resetAt: null, nextSlotAt: 0,
                strikes: 0, lastStrikeAt: 0, needsTrial: false, trial: null,
                active: 0, waiters: [],
                retryActive: 0, retryQueue: [],
            };
            this.hosts.set(host, st);
        }
        return st;
    }

    /**
     * Take one FIFO send slot for a host.
     *
     * The slot wraps the rate-limit gate as well as the send. A 429 therefore
     * holds only the small active set while the rest remain queued, and every
     * queued request observes the host pause before it reaches the network.
     *
     * A single-attempt waiter leaves the queue as soon as the host is paused:
     * the slots ahead of it are then held by requests sleeping out that pause,
     * and its caller asked to fail rather than wait.
     *
     * @param {string} host
     * @param {AbortSignal} [signal]
     * @param {(() => Error) | null} [onPause]  single-attempt only: builds the
     *        error a queued waiter rejects with when the host is paused
     * @returns {Promise<() => void>} releases the slot
     */
    acquire(host, signal, onPause = null) {
        if (signal?.aborted) return Promise.reject(abortError());
        const st = this.state(host);
        const limit = Math.max(1, Math.floor(Number(this.opts.maxConcurrency) || 1));
        return new Promise((resolve, reject) => {
            let queued = false;
            let released = false;
            const leave = (err) => {
                if (!queued) return;
                queued = false;
                const index = st.waiters.indexOf(enter);
                if (index >= 0) st.waiters.splice(index, 1);
                signal?.removeEventListener('abort', cancel);
                reject(err);
            };
            const enter = () => {
                queued = false;
                signal?.removeEventListener('abort', cancel);
                if (signal?.aborted) {
                    reject(abortError());
                    this.drain(host);
                    return;
                }
                st.active += 1;
                resolve(() => {
                    if (released) return;
                    released = true;
                    st.active = Math.max(0, st.active - 1);
                    this.drain(host);
                });
            };
            const cancel = () => leave(abortError());
            if (onPause) enter.onPause = () => leave(onPause());
            if (st.active < limit) {
                enter();
                return;
            }
            queued = true;
            st.waiters.push(enter);
            signal?.addEventListener('abort', cancel, { once: true });
        });
    }

    /** Fill free host slots from the FIFO queue. */
    drain(host) {
        const st = this.state(host);
        const limit = Math.max(1, Math.floor(Number(this.opts.maxConcurrency) || 1));
        while (st.active < limit && st.waiters.length > 0) {
            const enter = st.waiters.shift();
            enter();
        }
    }

    /** Record what a response says about the host's window. */
    observe(host, headers) {
        const t = this.now();
        const remainingRaw = readHeader(headers, 'ratelimit-remaining');
        const resetMs = parseRateLimitResetMs(readHeader(headers, 'ratelimit-reset'), t);
        if (remainingRaw === undefined || remainingRaw === null || resetMs === null) return;
        const remaining = Number.parseInt(String(remainingRaw), 10);
        if (!Number.isFinite(remaining)) return;
        const st = this.state(host);
        st.remaining = Math.max(0, remaining);
        st.resetAt = t + resetMs;
        // An empty window is a block until it resets, even before any 429.
        if (st.remaining === 0) {
            st.blockedUntil = Math.max(st.blockedUntil, st.resetAt);
            st.rateBlockedUntil = Math.max(st.rateBlockedUntil, st.resetAt);
            this.releasePausedWaiters(st);
        }
    }

    /** Fail every queued single-attempt request once the host is paused. */
    releasePausedWaiters(st) {
        if (st.blockedUntil <= this.now()) return;
        for (const waiter of st.waiters.filter((w) => w.onPause)) waiter.onPause();
    }

    /**
     * Pause the host until `waitMs` from now (never shortens an existing pause).
     * `rateLimited` is false for a transport failure's backoff: that pause
     * spaces out retries but must never be reported as the service asking the
     * wallet to slow down.
     */
    block(host, waitMs, rateLimited = true) {
        const st = this.state(host);
        const until = this.now() + Math.max(0, waitMs);
        st.blockedUntil = Math.max(st.blockedUntil, until);
        if (rateLimited) st.rateBlockedUntil = Math.max(st.rateBlockedUntil, until);
        this.releasePausedWaiters(st);
    }

    /** Whole seconds the host stays paused for any reason, or 0. */
    blockedSeconds(host) {
        const left = this.state(host).blockedUntil - this.now();
        return left > 0 ? Math.ceil(left / 1000) : 0;
    }

    /** Whole seconds the host stays paused for a rate limit, or 0 (a network backoff is not counted). */
    pausedSeconds(host) {
        const left = this.state(host).rateBlockedUntil - this.now();
        return left > 0 ? Math.ceil(left / 1000) : 0;
    }

    /**
     * Wait until a request to `host` may go out.
     *
     * @param {string} host
     * @param {number} [deadline]  clock time past which the request stops waiting
     * @returns {Promise<number>} 0 when cleared, or the seconds still to wait
     *          when the pause is longer than the layer will sit through
     */
    async gate(host, deadline = Infinity, signal) {
        if (signal?.aborted) throw abortError();
        const st = this.state(host);
        const t = this.now();
        if (st.blockedUntil > t) {
            const left = st.blockedUntil - t;
            if (left > Math.min(this.opts.maxWaitMs, deadline - t)) return Math.ceil(left / 1000);
            // Jitter spreads the wake-up so paused requests do not all land at once.
            await this.sleepUntil(
                left + Math.round(this.random() * Math.min(1000, left * 0.2 + 100)),
                signal,
            );
        }
        const slot = this.pace(host) - this.now();
        if (slot > 0) await this.sleepUntil(Math.min(slot, this.opts.maxWaitMs), signal);
        return 0;
    }

    /**
     * Reserve a send slot, spaced over the window once remaining runs low.
     *
     * @returns {number} the clock time the request may go out at
     */
    pace(host) {
        const st = this.state(host);
        const t = this.now();
        if (st.resetAt !== null && st.resetAt <= t) {
            // The window has rolled over; the old count says nothing about the new one.
            st.remaining = null;
            st.resetAt = null;
        }
        if (st.remaining === null || st.resetAt === null) return t;
        if (st.remaining > this.opts.lowWater) {
            st.remaining -= 1;
            return t;
        }
        // Spread what is left of the window evenly over the time left in it.
        const spacing = (st.resetAt - t) / Math.max(1, st.remaining);
        const slot = Math.max(t, st.nextSlotAt);
        st.nextSlotAt = slot + spacing;
        st.remaining = Math.max(0, st.remaining - 1);
        return slot;
    }

    /** Doubling, jittered backoff capped to the wallet's interactive wait. */
    backoffMs(attempt) {
        const base = this.opts.baseBackoffMs * 2 ** attempt;
        const jittered = base * (0.75 + this.random() * 0.5);
        return Math.min(Math.round(jittered), this.opts.maxWaitMs);
    }

    /** Reserve one of the host's bounded retry slots. */
    retrySlot(st, signal) {
        if (signal?.aborted) return Promise.reject(abortError());
        const cap = Math.max(1, Math.floor(this.opts.maxConcurrentRetries || 1));
        const release = () => {
            st.retryActive = Math.max(0, st.retryActive - 1);
            const next = st.retryQueue.shift();
            if (next) next();
        };
        if (st.retryActive < cap) {
            st.retryActive += 1;
            return Promise.resolve(release);
        }
        return new Promise((resolve, reject) => {
            const grant = () => {
                signal?.removeEventListener('abort', cancel);
                st.retryActive += 1;
                resolve(release);
            };
            const cancel = () => {
                const at = st.retryQueue.indexOf(grant);
                if (at >= 0) st.retryQueue.splice(at, 1);
                reject(abortError());
            };
            st.retryQueue.push(grant);
            signal?.addEventListener('abort', cancel, { once: true });
        });
    }

    /**
     * Send one request through the gate, retrying only classified transient reads.
     *
     * @param {string} host
     * @param {string|null} key   coalescing key for an idempotent read, null otherwise
     * @param {() => Promise<any>} send
     * @param {(seconds: number, rateLimited: boolean) => any} tooLong  builds the error for a pause past the cap
     * @param {number} [maxRetries] retries available to this HTTP method
     * @param {AbortSignal} [signal] cancels rate-limit and pacing waits
     * @param {(err: any) => boolean} [retryable] classifies a failure as transient
     * @param {{ singleAttempt?: boolean }} [policy]  `singleAttempt` sends at
     *        most once and fails at once while the host is paused, instead of
     *        retrying or sleeping out the pause (the caller asked for noRetry)
     */
    async request(
        host, key, send, tooLong, maxRetries = this.opts.maxRetries, signal,
        retryable = isTransientReadError, { singleAttempt = false } = {},
    ) {
        if (signal?.aborted) throw abortError();
        const configuredCap = Number.isFinite(this.opts.maxRetries)
            ? Math.max(0, Math.floor(this.opts.maxRetries))
            : EXPLORER_RATE_LIMIT_DEFAULTS.maxRetries;
        const requested = Number.isFinite(maxRetries)
            ? Math.max(0, Math.floor(maxRetries))
            : configuredCap;
        const retryBudget = singleAttempt ? 0 : Math.min(
            configuredCap,
            requested,
        );
        // A shared request would let one caller's signal cancel every waiter.
        // Signalled reads stay independent so each caller owns its cancellation.
        if (signal) key = null;
        // A single-attempt read joins only other single-attempt reads, so it
        // never inherits the retries of an identical read already in flight.
        if (key && singleAttempt) key = `${key} single-attempt`;
        if (key) {
            const recent = this.recent.get(key);
            if (recent && this.now() - recent.at <= this.opts.reuseMs) return cloneResponse(recent.res);
            const pending = this.inFlight.get(key);
            if (pending) return pending.then(cloneResponse);
        }
        const run = this.attempt(host, send, tooLong, retryBudget, signal, retryable, singleAttempt);
        if (!key) return run;
        this.inFlight.set(key, run);
        try {
            const res = await run;
            this.recent.set(key, { at: this.now(), res });
            this.pruneRecent();
            return res;
        } finally {
            this.inFlight.delete(key);
        }
    }

    /** Drop reuse entries past their window so the map stays small. */
    pruneRecent() {
        if (this.recent.size < 64) return;
        const cutoff = this.now() - this.opts.reuseMs;
        for (const [k, v] of this.recent) if (v.at < cutoff) this.recent.delete(k);
    }

    async attempt(host, send, tooLong, maxRetries, signal, retryable, singleAttempt = false) {
        const st = this.state(host);
        const deadline = this.now() + this.opts.maxTotalMs;
        const paused = () => tooLong(this.blockedSeconds(host), this.pausedSeconds(host) > 0);
        let retries = 0;
        for (;;) {
            // A single-attempt read never queues behind a host pause it would
            // only fail at, so it is refused before it takes a send slot.
            if (singleAttempt && this.blockedSeconds(host) > 0) throw paused();
            // The send slot wraps the gate, the trial wait and the send, so
            // queued requests observe a host pause before reaching the network.
            const release = await this.acquire(host, signal, singleAttempt ? paused : null);
            try {
                // A deadline of now turns any host pause into an immediate refusal.
                const waitSeconds = await this.gate(host, singleAttempt ? this.now() : deadline, signal);
                if (waitSeconds > 0) throw tooLong(waitSeconds, this.pausedSeconds(host) > 0);
                // After a transient failure one request goes first and the rest wait
                // for its answer, so an unhealthy host sees one probe instead of a wave.
                if (st.needsTrial && st.trial) {
                    await st.trial;
                    continue;
                }
                let endTrial = null;
                if (st.needsTrial) st.trial = new Promise((resolve) => { endTrial = resolve; });
                let releaseRetry = null;
                try {
                    releaseRetry = retries > 0 ? await this.retrySlot(st, signal) : null;
                } catch (err) {
                    if (endTrial) {
                        st.trial = null;
                        endTrial();
                    }
                    throw err;
                }
                const sentAt = this.now();
                try {
                    const res = await send();
                    this.observe(host, res && res.headers);
                    st.strikes = 0;
                    st.needsTrial = false;
                    return res;
                } catch (err) {
                    if (err && err.response) this.observe(host, err.response.headers);
                    const status = statusOf(err);
                    const transient = retryable(err);
                    if (status !== 429 && !transient) {
                        if (endTrial) st.needsTrial = false;
                        throw err;
                    }
                    // One strike per wave: requests already in flight share it, so a
                    // burst does not jump straight to the backoff cap.
                    if (sentAt > st.lastStrikeAt) {
                        st.strikes = Math.min(st.strikes + 1, 8);
                        st.lastStrikeAt = this.now();
                    }
                    st.needsTrial = true;
                    const named = status === 429
                        ? rateLimitWaitMs(err.response.headers, this.now())
                        : null;
                    const wait = named !== null
                        ? named
                        : this.backoffMs(Math.max(retries, st.strikes - 1));
                    this.block(host, wait, status === 429);
                    // Every 4xx is final for this call. The pause only protects later calls.
                    if (status === 429 || retries >= maxRetries || wait > this.opts.maxWaitMs) throw err;
                    retries += 1;
                } finally {
                    releaseRetry?.();
                    if (endTrial) {
                        st.trial = null;
                        endTrial();
                    }
                }
            } finally {
                release();
            }
        }
    }
}

/** The one limiter every wallet SDK instance shares, so hosts are tracked process-wide. */
export const sharedExplorerLimiter = new HostRateLimiter();

/** An axios-shaped 429 for a request the layer did not send because the host is paused. */
function pausedError(seconds, config, rateLimited = true) {
    if (!rateLimited) {
        // The host is only backing off after a transport failure: say so as the
        // network failure it is, never as a 429 the service did not send.
        const net = /** @type {any} */ (new Error('Network Error'));
        net.isAxiosError = true;
        net.code = 'ERR_NETWORK';
        net.config = config;
        return net;
    }
    const err = /** @type {any} */ (new Error('Request failed with status code 429'));
    err.isAxiosError = true;
    err.config = config;
    err.response = { status: 429, headers: { 'retry-after': String(seconds) }, data: null, config };
    return err;
}

function hostOf(client) {
    const base = client && client.defaults ? client.defaults.baseURL : '';
    try {
        return new URL(base).host || String(base);
    } catch {
        return String(base || 'unknown');
    }
}

function retryCount(retry, fallback = 0) {
    if (retry === false) return 0;
    const value = retry && retry.maxRetries;
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function networkChangedError() {
    return Object.assign(new Error('The explorer network changed before the request completed.'), {
        name: 'NetworkChangedError',
        code: 'EXPLORER_NETWORK_CHANGED',
    });
}

async function currentResponse(send, isCurrent) {
    try {
        const response = await send();
        if (!isCurrent()) throw networkChangedError();
        return response;
    } catch (err) {
        if (!isCurrent()) throw networkChangedError();
        throw err;
    }
}

// The SDK hands its HTTP client only `{ params: buildParams(opts) }`, so a
// caller's `noRetry` never reaches the client on its own. The explorer wrapper
// tags the opts of a call that asked for it, the wrapped `buildParams` records
// the params object it builds from tagged opts, and the wrapped HTTP methods
// look the params object up here. A WeakSet leaves the params themselves (which
// axios serializes into the URL) untouched.
const SINGLE_ATTEMPT = Symbol('xc.singleAttempt');
const singleAttemptParams = new WeakSet();

function isSingleAttempt(config) {
    const params = config && config.params;
    return Boolean(params && typeof params === 'object' && singleAttemptParams.has(params));
}

// A caller's `fresh` rides the same way: the read guards a signature, so it
// must reflect the indexer as it stands at Approve. A fresh read never joins
// or reuses another read and asks the browser's HTTP cache for nothing, since
// the explorer serves its reads with `max-age=5, stale-while-revalidate=10`.
const FRESH = Symbol('xc.fresh');
const freshParams = new WeakSet();
// Open explorerFreshScope calls on one explorer client.
const FRESH_SCOPE = Symbol('xc.freshScope');

function isFresh(config) {
    const params = config && config.params;
    return Boolean(params && typeof params === 'object' && freshParams.has(params));
}

/**
 * The axios config of a fresh read: `cache: 'no-store'` for the fetch
 * adapter. A page context would pick the XMLHttpRequest adapter, which has no
 * cache mode, so the read goes through fetch there; Node's http adapter has no
 * HTTP cache and keeps its own adapter. The URL and headers stay as they are,
 * so the explorer sees the same request and no CORS preflight is added.
 */
function freshConfig(config) {
    const out = { ...config, fetchOptions: { ...(config && config.fetchOptions), cache: 'no-store' } };
    if (typeof XMLHttpRequest !== 'undefined' && typeof fetch === 'function') out.adapter = 'fetch';
    return out;
}

/** Route one explorer axios instance's read-only calls through the limiter. */
function wrapExplorerAxios(client, limiter, maxRetries, isCurrent = () => true) {
    if (!client || client.__xcRateLimited || typeof client.get !== 'function') return;
    const host = hostOf(client);
    const base = client.defaults ? client.defaults.baseURL || '' : '';
    if (client.defaults) {
        // Axios otherwise returns malformed JSON as a successful string.
        client.defaults.responseType = 'json';
        client.defaults.transitional = {
            ...(client.defaults.transitional || {}),
            silentJSONParsing: false,
        };
    }
    const get = client.get.bind(client);
    const post = typeof client.post === 'function' ? client.post.bind(client) : null;
    client.get = (url, config = {}) => {
        const fresh = isFresh(config);
        // Binary reads keep their own response type, so they are never shared.
        const shareable = !fresh && (!config || !config.responseType || config.responseType === 'json');
        const key = shareable ? requestKey('GET', base, url, config && config.params) : null;
        const sent = fresh ? freshConfig(config) : config;
        return limiter.request(
            host, key, () => currentResponse(() => get(url, sent), isCurrent),
            (s, rateLimited) => pausedError(s, config, rateLimited),
            maxRetries, config?.signal, undefined, { singleAttempt: isSingleAttempt(config) },
        );
    };
    if (post) {
        // POST reads are never shared or HTTP-cached; a fresh one carries
        // no-store all the same, so the tag means one thing on both methods.
        client.post = (url, body, config = {}) => {
            const sent = isFresh(config) ? freshConfig(config) : config;
            return limiter.request(
                host, null, () => currentResponse(() => post(url, body, sent), isCurrent),
                (s, rateLimited) => pausedError(s, config, rateLimited),
                maxRetries, config?.signal, undefined, { singleAttempt: isSingleAttempt(config) },
            );
        };
    }
    client.__xcRateLimited = true;
    client.__xcRateLimiter = limiter;
}

/**
 * Whole seconds an SDK instance's explorer host is paused for a rate limit, or 0.
 *
 * Lets a caller that only wants to know "is it up" skip a request the layer
 * would hold anyway: a host that answered 429 is up.
 *
 * @param {any} sdk
 * @returns {number}
 */
export function explorerPausedSeconds(sdk) {
    const client = sdk && sdk.explorer && sdk.explorer.client;
    const limiter = client && client.__xcRateLimiter;
    return limiter ? limiter.pausedSeconds(hostOf(client)) : 0;
}

/**
 * One single-attempt explorer GET, for reads whose SDK facade method takes no
 * options (`getStatus()`, `getAction(index)`) and so cannot carry `noRetry`.
 *
 * Reads through `sdk.explorer.get(path, { noRetry: true })`; an SDK without an
 * explorer client (a stand-in) gets `fallback()` instead.
 *
 * @param {any} sdk
 * @param {string} path  explorer path below `/<COIN>/api`, already encoded
 * @param {() => Promise<any>} fallback
 * @returns {Promise<any>}
 */
export async function explorerReadOnce(sdk, path, fallback) {
    const explorer = sdk && sdk.explorer;
    if (explorer && typeof explorer.get === 'function') return explorer.get(path, { noRetry: true });
    return fallback();
}

/**
 * One fresh explorer GET, for a read that guards a signature through an SDK
 * facade method that takes no options (`getAction(index)`) and so cannot
 * carry `fresh`.
 *
 * Reads through `sdk.explorer.get(path, { fresh: true })`; an SDK without an
 * explorer client (a stand-in) gets `fallback()` instead.
 *
 * @param {any} sdk
 * @param {string} path  explorer path below `/<COIN>/api`, already encoded
 * @param {() => Promise<any>} fallback
 * @returns {Promise<any>}
 */
export async function explorerReadFresh(sdk, path, fallback) {
    const explorer = sdk && sdk.explorer;
    if (explorer && typeof explorer.get === 'function') return explorer.get(path, { fresh: true });
    return fallback();
}

/**
 * Run `fn` with every read through this SDK's explorer client sent fresh,
 * for a guard read whose SDK method builds its own request and takes no
 * options (`quoteNativeFee`, whose GET /feequote the explorer serves as
 * cacheable). A read by another caller on the same client while `fn` runs
 * goes fresh too; it costs one request and is never less current.
 *
 * @template T
 * @param {any} sdk
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function explorerFreshScope(sdk, fn) {
    const explorer = sdk && sdk.explorer;
    if (!explorer || typeof explorer !== 'object') return fn();
    explorer[FRESH_SCOPE] = (explorer[FRESH_SCOPE] || 0) + 1;
    try {
        return await fn();
    } finally {
        explorer[FRESH_SCOPE] -= 1;
    }
}

/** Rewrite a surfaced explorer 429 into the plain sentence, keeping the wait machine-readable. */
function friendlyRateLimitError(err, pausedSeconds = 0) {
    if (!err || typeof err !== 'object') return err;
    const e = /** @type {any} */ (err);
    const is429 = e.code === 'RATE_LIMITED' || e.name === 'SDKRateLimitedError'
        || /Explorer returned HTTP 429\b/.test(String(e.message || ''));
    if (!is429) return err;
    if (e.message === EXPLORER_BUSY_MESSAGE) return err;
    e.detail = e.message;
    // A browser cannot read Retry-After without CORS exposure; the host pause is the next best number.
    if (!Number.isInteger(e.retryAfterSeconds) && pausedSeconds > 0) e.retryAfterSeconds = pausedSeconds;
    if (Number.isInteger(e.retryAfterSeconds) && e.retryAfterSeconds >= 0) {
        // retryAfterMs is one of the numeric fields the messaging envelope keeps.
        e.retryAfterMs = e.retryAfterSeconds * 1000;
    }
    if (!e.service) e.service = 'explorer';
    try {
        e.message = EXPLORER_BUSY_MESSAGE;
    } catch {
        return err;
    }
    return err;
}

/** Wrap one SDK explorer client: its axios instance, any rebuilt one, and its errors. */
function wrapExplorerClient(explorer, limiter) {
    if (!explorer || typeof explorer !== 'object' || explorer.__xcRateLimited) return false;
    if (!explorer.client || typeof explorer.client.get !== 'function') return false;
    const maxRetries = retryCount(explorer.retry);
    const initialClient = explorer.client;
    wrapExplorerAxios(initialClient, limiter, maxRetries, () => explorer.client === initialClient);
    if (typeof explorer.buildClient === 'function') {
        const build = explorer.buildClient;
        // setBase() rebuilds the axios instance; the new one is wrapped too.
        explorer.buildClient = function buildClientRateLimited(...args) {
            const out = build.apply(this, args);
            const rebuiltClient = this.client;
            wrapExplorerAxios(rebuiltClient, limiter, maxRetries, () => this.client === rebuiltClient);
            return out;
        };
    }
    // The shared layer owns every retry, so the SDK must not add a second loop.
    explorer.retry = false;
    if (typeof explorer.buildParams === 'function') {
        const buildParams = explorer.buildParams;
        explorer.buildParams = function buildParamsWithAttemptPolicy(opts, ...rest) {
            const params = buildParams.call(this, opts, ...rest);
            if (opts && opts[SINGLE_ATTEMPT] && params && typeof params === 'object') {
                singleAttemptParams.add(params);
            }
            if (opts && opts[FRESH] && params && typeof params === 'object') freshParams.add(params);
            return params;
        };
    }
    for (const method of ['get', 'post']) {
        const original = explorer[method];
        if (typeof original !== 'function') continue;
        const optsAt = method === 'post' ? 2 : 1;
        explorer[method] = async function rateLimitAwareCall(...args) {
            try {
                const callerOpts = args[optsAt];
                const callArgs = [...args];
                if (method === 'post') callArgs[2] = { ...(callerOpts || {}), noRetry: true };
                // Only the caller's own noRetry makes the call single-attempt;
                // the noRetry injected for every POST above only stops the
                // SDK's loop, and the shared layer keeps its retries.
                if (callerOpts && typeof callerOpts === 'object' && callerOpts.noRetry) {
                    callArgs[optsAt] = { ...callArgs[optsAt], [SINGLE_ATTEMPT]: true };
                }
                if ((callerOpts && typeof callerOpts === 'object' && callerOpts.fresh) || this[FRESH_SCOPE] > 0) {
                    callArgs[optsAt] = { ...callArgs[optsAt], [FRESH]: true };
                }
                return await original.apply(this, callArgs);
            } catch (err) {
                throw friendlyRateLimitError(err, limiter.pausedSeconds(hostOf(this.client)));
            }
        };
    }
    explorer.__xcRateLimited = true;
    return true;
}

const IDEMPOTENT_ENCODER_METHODS = new Set([
    'estimate_fee', 'get_tx_block', 'get_utxos', 'health', 'ping',
]);

function encoderRequestKey(base, body) {
    try {
        return `ENCODER ${base} ${body.method} ${JSON.stringify(body.params ?? {})}`;
    } catch {
        return null;
    }
}

/** Retry encoder reads while leaving reservations, releases and broadcasts single-attempt. */
function wrapEncoderAxios(client, limiter, maxRetries, isCurrent = () => true) {
    if (!client || client.__xcNetworkPolicy || typeof client.post !== 'function') return;
    const host = hostOf(client);
    const base = client.defaults ? client.defaults.baseURL || '' : '';
    const post = client.post.bind(client);
    client.post = (url, body, config = {}) => {
        const isRead = IDEMPOTENT_ENCODER_METHODS.has(body?.method);
        const key = isRead ? encoderRequestKey(base, body) : null;
        return limiter.request(
            host, key, () => currentResponse(() => post(url, body, config), isCurrent),
            (s, rateLimited) => pausedError(s, config, rateLimited),
            isRead ? maxRetries : 0, config?.signal,
        );
    };
    client.__xcNetworkPolicy = true;
    client.__xcRateLimiter = limiter;
}

function wrapEncoderClient(encoder, limiter) {
    if (!encoder || typeof encoder !== 'object' || encoder.__xcNetworkPolicy) return false;
    if (!encoder.client || typeof encoder.client.post !== 'function') return false;
    const maxRetries = retryCount(encoder.retry);
    const initialClient = encoder.client;
    wrapEncoderAxios(initialClient, limiter, maxRetries, () => encoder.client === initialClient);
    if (typeof encoder.buildClient === 'function') {
        const build = encoder.buildClient;
        encoder.buildClient = function buildClientWithNetworkPolicy(...args) {
            const out = build.apply(this, args);
            const rebuiltClient = this.client;
            wrapEncoderAxios(rebuiltClient, limiter, maxRetries, () => this.client === rebuiltClient);
            return out;
        };
    }
    encoder.retry = false;
    encoder.__xcNetworkPolicy = true;
    return true;
}

function isTransientHubError(err) {
    const detail = String(err?.details?.error || '');
    if (/status code 5\d\d\b/i.test(detail)) return true;
    return /\b(?:ECONNABORTED|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ERR_NETWORK)\b/i.test(detail)
        || /\b(?:network error|socket hang up|timed?\s*out|timeout of \d+ms exceeded)\b/i.test(detail);
}

/** Hub discovery is a read even though keyed deployments use JSON-RPC POST. */
function wrapHubClient(hub, limiter, maxRetries) {
    if (!hub || typeof hub !== 'object' || hub.__xcNetworkPolicy) return false;
    if (typeof hub.getDiscoveryConfig !== 'function') return false;
    const discover = hub.getDiscoveryConfig;
    hub.getDiscoveryConfig = function getDiscoveryConfigWithRetry(...args) {
        let host;
        const activeUrl = Array.isArray(this.urls)
            ? this.urls[this._lastGoodIdx] || this.url
            : this.url;
        try {
            host = new URL(activeUrl).host;
        } catch {
            host = String(activeUrl || 'unknown');
        }
        return limiter.request(
            host, null, () => discover.apply(this, args), () => new Error('Hub is paused.'),
            maxRetries, undefined, isTransientHubError,
        );
    };
    hub.__xcNetworkPolicy = true;
    return true;
}

function wrapAssignableClient(sdk, property, wrap) {
    const desc = Object.getOwnPropertyDescriptor(sdk, property);
    if (!desc || !('value' in desc) || !desc.writable || !desc.configurable) return;
    let current = desc.value;
    if (!wrap(current)) return;
    Object.defineProperty(sdk, property, {
        configurable: true,
        enumerable: desc.enumerable,
        get() { return current; },
        set(next) {
            current = next;
            wrap(next);
        },
    });
}

/**
 * Put an SDK instance's indexer, encoder and hub traffic behind the shared gate.
 *
 * Hub discovery may replace a service client, so assignable clients become
 * accessors that wrap their replacements. Stand-ins without transports stay
 * untouched.
 *
 * @param {any} sdk
 * @param {HostRateLimiter} [limiter]
 * @returns {any} the same sdk
 */
export function installSdkNetworkPolicy(sdk, limiter = sharedExplorerLimiter) {
    if (!sdk || typeof sdk !== 'object' || sdk.__xcExplorerRateLimit) return sdk;
    wrapAssignableClient(sdk, 'explorer', (client) => wrapExplorerClient(client, limiter));
    wrapAssignableClient(sdk, 'encoder', (client) => wrapEncoderClient(client, limiter));
    const hubRetries = retryCount(sdk.options?.retry, limiter.opts.maxRetries);
    wrapAssignableClient(sdk, 'hub', (client) => wrapHubClient(client, limiter, hubRetries));
    Object.defineProperty(sdk, '__xcExplorerRateLimit', { value: true });
    return sdk;
}

export const installExplorerRateLimit = installSdkNetworkPolicy;
