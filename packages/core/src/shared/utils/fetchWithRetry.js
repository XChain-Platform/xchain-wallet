// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export const DEFAULT_FETCH_TIMEOUT_MS = 8_000;
export const DEFAULT_FETCH_RETRIES = 1;
export const DEFAULT_FETCH_BACKOFF_MS = 250;
export const MAX_FETCH_RETRIES = 3;

const DEFAULT_RETRY_AFTER_MAX_MS = 60_000;
const inFlightGets = new WeakMap();

function abortError() {
    if (typeof DOMException === 'function') return new DOMException('The request was cancelled.', 'AbortError');
    return Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
}

function wait(ms, signal, sleep) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (typeof sleep === 'function') return sleep(ms, signal);
    return new Promise((resolve, reject) => {
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
    });
}

async function fetchAttempt(fetchImpl, url, init, timeoutMs, signal) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs)
        : null;
    try {
        return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
        if (signal?.aborted) throw abortError();
        if (timedOut) throw Object.assign(new Error('The network request timed out. Please try again.'), {
            name: 'NetworkTimeoutError',
        });
        throw err;
    } finally {
        if (timer !== null) clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    }
}

function headerValue(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === wanted) return value;
    }
    return null;
}

function retryAfterMs(response, nowMs) {
    if (response?.status !== 429) return 0;
    const value = headerValue(response.headers, 'retry-after');
    if (value == null) return 0;
    const seconds = Number(String(value).trim());
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(String(value));
    return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : 0;
}

function cloneResponse(response) {
    return typeof response?.clone === 'function' ? response.clone() : response;
}

function joinInFlight(entry, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    entry.waiters += 1;
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', cancel);
            entry.waiters -= 1;
            if (entry.pending && entry.waiters === 0) entry.controller.abort();
            fn(value);
        };
        const cancel = () => finish(reject, abortError());
        signal?.addEventListener('abort', cancel, { once: true });
        entry.promise.then(
            (response) => finish(resolve, cloneResponse(response)),
            (err) => finish(reject, err),
        );
    });
}

async function runFetchWithRetry(fetchImpl, url, init, policy) {
    const signal = init.signal;
    const timeoutMs = policy.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const maxRetries = Math.min(
        MAX_FETCH_RETRIES,
        Math.max(0, Math.floor(policy.maxRetries ?? DEFAULT_FETCH_RETRIES)),
    );
    const baseDelayMs = Math.max(0, policy.baseDelayMs ?? DEFAULT_FETCH_BACKOFF_MS);
    const maxDelayMs = Math.max(baseDelayMs, policy.maxDelayMs ?? 2_000);
    const retryAfterMaxMs = Math.max(0, policy.retryAfterMaxMs ?? DEFAULT_RETRY_AFTER_MAX_MS);
    const random = typeof policy.random === 'function' ? policy.random : Math.random;
    const now = typeof policy.now === 'function' ? policy.now : Date.now;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        let response;
        try {
            response = await fetchAttempt(fetchImpl, url, init, timeoutMs, signal);
        } catch (err) {
            if (signal?.aborted || err?.name === 'AbortError') throw err;
            // Browsers expose CORS refusals as TypeError, indistinguishable from
            // several other fetch failures. Repeating one cannot repair policy.
            if (err?.name !== 'NetworkTimeoutError' || attempt === maxRetries) {
                if (err?.name === 'NetworkTimeoutError') throw err;
                throw Object.assign(new Error('The network request failed. Please try again.'), {
                    name: 'NetworkRequestError',
                    cause: err,
                });
            }
        }

        if (response && !RETRYABLE_STATUSES.has(response.status)) return response;
        if (attempt === maxRetries) {
            throw Object.assign(new Error('The network service is temporarily unavailable. Please try again.'), {
                name: 'NetworkResponseError',
                status: response?.status,
            });
        }

        const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
        const jittered = Math.min(maxDelayMs, exponential * (0.5 + random()));
        const requested = Math.min(retryAfterMaxMs, retryAfterMs(response, now()));
        await wait(Math.max(jittered, requested), signal, policy.sleep);
    }
    throw new Error('Network request failed.');
}

/**
 * Fetch with a per-attempt timeout and bounded exponential backoff.
 * Only GET requests retry because replaying a write can duplicate it.
 * Concurrent GETs for one URL and fetch implementation share the same request.
 * Each caller receives a cloned response when the implementation supports it.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string | URL | Request} url
 * @param {RequestInit} [init]
 * @param {{ timeoutMs?: number, maxRetries?: number, baseDelayMs?: number,
 *           maxDelayMs?: number, retryAfterMaxMs?: number, random?: () => number,
 *           now?: () => number,
 *           sleep?: (ms: number, signal?: AbortSignal) => Promise<void> }} [policy]
 * @returns {Promise<Response>}
 */
export function fetchWithRetry(fetchImpl, url, init = {}, policy = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Network request is unavailable.');
    const isRequest = typeof Request === 'function' && url instanceof Request;
    const requestMethod = isRequest ? url.method : null;
    const method = String(init.method || requestMethod || 'GET').toUpperCase();
    const signal = init.signal ?? (isRequest ? url.signal : undefined);
    if (method !== 'GET') {
        return runFetchWithRetry(fetchImpl, url, { ...init, signal }, { ...policy, maxRetries: 0 });
    }

    let requests = inFlightGets.get(fetchImpl);
    if (!requests) {
        requests = new Map();
        inFlightGets.set(fetchImpl, requests);
    }
    const key = isRequest ? url.url : String(url);
    const active = requests.get(key);
    if (active) return joinInFlight(active, signal);

    const controller = new AbortController();
    const entry = { controller, pending: true, waiters: 0, promise: null };
    entry.promise = runFetchWithRetry(fetchImpl, url, { ...init, signal: controller.signal }, policy)
        .finally(() => {
            entry.pending = false;
            if (requests.get(key) === entry) requests.delete(key);
        });
    requests.set(key, entry);
    return joinInFlight(entry, signal);
}
