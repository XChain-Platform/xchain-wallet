// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Runtime chain-registry refresh from hub — §9.7 / G007.
//
// Wallet-side scaffolding only — the hub-side endpoint is not yet
// implemented (today's hub serves JSON-RPC + `/hub-db/snapshot/*`
// REST; a `/api/v1/chain-registry` endpoint that returns the
// canonical descriptor set is pending). Until that ships, this flow
// always falls back to the bundled descriptors compiled into the
// wallet, with a `lastRefreshError` hint surfaced in Settings →
// Network so a user can see why the refresh isn't actually
// happening yet.
//
// Wire format the wallet expects (when the hub ships it):
//
//   GET ${hubUrl}/api/v1/chain-registry
//
//   Response:
//     {
//       generatedAt: '2026-04-28T12:34:56.789Z',
//       descriptors: [
//         { id, coin, networkKind, displayName, ... },
//         ...
//       ]
//     }
//
// Each descriptor must round-trip `validateChainDescriptor` from the
// registry validator before the wallet replaces a bundled entry; an
// invalid descriptor is logged + skipped (never throws — a malformed
// hub response should not wedge the wallet).
//
// Hot-swap into the running ChainRegistry instance is intentionally
// NOT yet wired — that mutates state shared across active flows
// (Send / Sign / History). The safe model is "validate + cache,
// surface in diagnostics, apply on next service-worker restart" —
// design discussion lives in Cluster U FOLLOWUP.

const DEFAULT_HUB_PATH = '/api/v1/chain-registry';
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * @typedef {Object} ChainRegistryRefreshResult
 * @property {boolean} ok
 * @property {string} hubUrl                    URL queried
 * @property {string | null} lastRefreshedAt    ISO date string when the response was received (null on failure)
 * @property {number} descriptorCount           number of descriptors the hub returned (0 on failure)
 * @property {string | null} error              human-readable error if !ok
 */

/**
 * Attempt one chain-registry refresh against a hub URL. Always
 * resolves; never throws. Caller decides whether / when to merge.
 *
 * @param {object} args
 * @param {string} args.hubUrl
 * @param {typeof fetch} [args.fetcher]   inject for tests
 * @param {number} [args.timeoutMs]
 * @returns {Promise<ChainRegistryRefreshResult>}
 */
export async function refreshChainRegistry({ hubUrl, fetcher, timeoutMs }) {
    const url = buildRefreshUrl(hubUrl);
    if (!url) {
        return errorResult(hubUrl ?? '', 'invalid hubUrl');
    }
    const fn = fetcher
        || (typeof fetch === 'function' ? fetch : null);
    if (!fn) {
        return errorResult(url, 'no fetch implementation available');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response;
    try {
        response = await fn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (err) {
        clearTimeout(timer);
        return errorResult(url, err?.name === 'AbortError' ? 'request timed out' : (err?.message ?? String(err)));
    }
    clearTimeout(timer);
    if (!response || !response.ok) {
        return errorResult(url, `hub returned HTTP ${response?.status ?? '?'}`);
    }
    let body;
    try {
        body = await response.json();
    } catch (err) {
        return errorResult(url, `malformed JSON: ${err?.message ?? err}`);
    }
    if (!body || typeof body !== 'object') {
        return errorResult(url, 'malformed response: not an object');
    }
    const descriptors = Array.isArray(body.descriptors) ? body.descriptors : null;
    if (!descriptors) {
        return errorResult(url, 'malformed response: missing descriptors[]');
    }
    return {
        ok: true,
        hubUrl: url,
        lastRefreshedAt: typeof body.generatedAt === 'string' && body.generatedAt
            ? body.generatedAt
            : new Date().toISOString(),
        descriptorCount: descriptors.length,
        error: null,
    };
}

/**
 * In-memory status holder — populated by the background's boot-time
 * refresh + manual Settings refreshes. Settings UI reads this via
 * the `chainRegistry.status` host handler.
 */
export function createChainRegistryStatus() {
    /** @type {ChainRegistryRefreshResult | null} */
    let last = null;
    return {
        get() { return last; },
        update(result) { last = result; return last; },
        clear() { last = null; },
    };
}

function buildRefreshUrl(hubUrl) {
    if (typeof hubUrl !== 'string' || !hubUrl) return null;
    try {
        const u = new URL(hubUrl);
        // Strip any trailing slash and append the canonical path.
        const base = u.origin + u.pathname.replace(/\/+$/, '');
        return base + DEFAULT_HUB_PATH;
    } catch {
        return null;
    }
}

function errorResult(hubUrl, error) {
    return {
        ok: false,
        hubUrl,
        lastRefreshedAt: null,
        descriptorCount: 0,
        error,
    };
}
