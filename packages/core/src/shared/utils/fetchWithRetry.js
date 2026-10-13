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

/**
 * Fetch with a per-attempt timeout and bounded exponential backoff.
 * Only GET requests retry because replaying a write can duplicate it.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string | URL | Request} url
 * @param {RequestInit} [init]
 * @param {{ timeoutMs?: number, maxRetries?: number, baseDelayMs?: number,
 *           maxDelayMs?: number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void> }} [policy]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(fetchImpl, url, init = {}, policy = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Network request is unavailable.');
    const isRequest = typeof Request === 'function' && url instanceof Request;
    const requestMethod = isRequest ? url.method : null;
    const method = String(init.method || requestMethod || 'GET').toUpperCase();
    const signal = init.signal ?? (isRequest ? url.signal : undefined);
    const timeoutMs = policy.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const maxRetries = method === 'GET'
        ? Math.max(0, Math.floor(policy.maxRetries ?? DEFAULT_FETCH_RETRIES))
        : 0;
    const baseDelayMs = Math.max(0, policy.baseDelayMs ?? DEFAULT_FETCH_BACKOFF_MS);
    const maxDelayMs = Math.max(baseDelayMs, policy.maxDelayMs ?? 2_000);
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            const response = await fetchAttempt(fetchImpl, url, init, timeoutMs, signal);
            if (!RETRYABLE_STATUSES.has(response.status)) return response;
            if (attempt === maxRetries) {
                throw Object.assign(new Error('The network service is temporarily unavailable. Please try again.'), {
                    name: 'NetworkResponseError',
                    status: response.status,
                });
            }
        } catch (err) {
            if (signal?.aborted || err?.name === 'AbortError') throw err;
            lastError = err;
            if (attempt === maxRetries) {
                if (err?.name === 'NetworkResponseError' || err?.name === 'NetworkTimeoutError') throw err;
                throw Object.assign(new Error('The network request failed. Please try again.'), {
                    name: 'NetworkRequestError',
                    cause: err,
                });
            }
        }
        const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
        await wait(delay, signal, policy.sleep);
    }
    throw lastError;
}
