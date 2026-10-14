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
                blockedUntil: 0, remaining: null, resetAt: null, nextSlotAt: 0,
                strikes: 0, lastStrikeAt: 0, needsTrial: false, trial: null,
                retryActive: 0, retryQueue: [],
            };
            this.hosts.set(host, st);
        }
        return st;
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
        if (st.remaining === 0) st.blockedUntil = Math.max(st.blockedUntil, st.resetAt);
    }

    /** Pause the host until `waitMs` from now (never shortens an existing pause). */
    block(host, waitMs) {
        const st = this.state(host);
        st.blockedUntil = Math.max(st.blockedUntil, this.now() + Math.max(0, waitMs));
    }

    /** Whole seconds the host stays paused, or 0. */
    pausedSeconds(host) {
        const left = this.state(host).blockedUntil - this.now();
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
     * @param {(seconds: number) => any} tooLong  builds the error for a pause past the cap
     * @param {number} [maxRetries] retries available to this HTTP method
     * @param {AbortSignal} [signal] cancels rate-limit and pacing waits
     */
    async request(
        host, key, send, tooLong, maxRetries = this.opts.maxRetries, signal,
        retryable = isTransientReadError,
    ) {
        if (signal?.aborted) throw abortError();
        const configuredCap = Number.isFinite(this.opts.maxRetries)
            ? Math.max(0, Math.floor(this.opts.maxRetries))
            : EXPLORER_RATE_LIMIT_DEFAULTS.maxRetries;
        const requested = Number.isFinite(maxRetries)
            ? Math.max(0, Math.floor(maxRetries))
            : configuredCap;
        const retryBudget = Math.min(
            configuredCap,
            requested,
        );
        // A shared request would let one caller's signal cancel every waiter.
        // Signalled reads stay independent so each caller owns its cancellation.
        if (signal) key = null;
        if (key) {
            const recent = this.recent.get(key);
            if (recent && this.now() - recent.at <= this.opts.reuseMs) return cloneResponse(recent.res);
            const pending = this.inFlight.get(key);
            if (pending) return pending.then(cloneResponse);
        }
        const run = this.attempt(host, send, tooLong, retryBudget, signal, retryable);
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

    async attempt(host, send, tooLong, maxRetries, signal, retryable) {
        const st = this.state(host);
        const deadline = this.now() + this.opts.maxTotalMs;
        let retries = 0;
        for (;;) {
            const waitSeconds = await this.gate(host, deadline, signal);
            if (waitSeconds > 0) throw tooLong(waitSeconds);
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
                this.block(host, wait);
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
        }
    }
}

/** The one limiter every wallet SDK instance shares, so hosts are tracked process-wide. */
export const sharedExplorerLimiter = new HostRateLimiter();

/** An axios-shaped 429 for a request the layer did not send because the host is paused. */
function pausedError(seconds, config) {
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
        // Binary reads keep their own response type, so they are never shared.
        const shareable = !config || !config.responseType || config.responseType === 'json';
        const key = shareable ? requestKey('GET', base, url, config && config.params) : null;
        return limiter.request(
            host, key, () => currentResponse(() => get(url, config), isCurrent),
            (s) => pausedError(s, config),
            maxRetries, config?.signal,
        );
    };
    if (post) {
        client.post = (url, body, config = {}) => limiter.request(
            host, null, () => currentResponse(() => post(url, body, config), isCurrent),
            (s) => pausedError(s, config),
            maxRetries, config?.signal,
        );
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
    for (const method of ['get', 'post']) {
        const original = explorer[method];
        if (typeof original !== 'function') continue;
        explorer[method] = async function rateLimitAwareCall(...args) {
            try {
                const callArgs = method === 'post'
                    ? [args[0], args[1], { ...(args[2] || {}), noRetry: true }]
                    : args;
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
            (s) => pausedError(s, config),
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
