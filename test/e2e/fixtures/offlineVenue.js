// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A stand-in network for extension specs that never touch a chain.
//
// A fresh extension profile points at the production hub and explorers. With no
// route to them, Home replaces its balance header with "Couldn't load balances"
// and a spec that waits for the header after creating a wallet times out on a
// screen that has nothing to do with its subject. Worse, an unstubbed run would
// really call those hosts.
//
// So every external request is answered here and nothing leaves the machine:
// the explorer's batch balances route returns an empty, well-formed ledger for
// each requested address, the explorer's /status route reports a current,
// unhalted tip, and the hub and encoder JSON-RPC `ping` methods answer true.
// Those last two are the reachability probe Home runs: with every probed
// service unanswered it paints "You are offline" in place of the balance
// header. Every other external request is refused. Playwright's context-level route also covers the
// extension's service worker, where the balance reads are made.
//
// Loopback and chrome-extension: URLs are not touched, and a page-level route
// (the specs' dApp origin) still takes precedence over this one.

const EXTERNAL_URL = /^https?:\/\//i;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const BALANCES_PATH = /\/api\/balances$/;
const STATUS_PATH = /^\/([A-Za-z]+)\/api\/status$/;
// The hub and the encoder both take JSON-RPC at `/<COIN>`.
const RPC_PATH = /^\/[A-Za-z]+\/?$/;

/** One address's slot in the explorer's batch answer: no tokens, zero native coin. */
export function emptyBatchEntry() {
    return {
        balances: { total: 0, data: [] },
        address: { balances: { confirmed: '0' } },
        error: null,
    };
}

/** The batch answer for a request body: one empty entry per requested address. */
export function emptyBatchBody(requestBody) {
    const addresses = Array.isArray(requestBody?.addresses) ? requestBody.addresses : [];
    return Object.fromEntries(addresses.map((address) => [address, emptyBatchEntry()]));
}

/** A healthy explorer's /status body for one coin: indexed to a recent tip, not stale or halted. */
export function healthyStatusBody(coin) {
    return {
        stale: { [coin]: false },
        last_block: { [coin]: 1 },
        tip_age_seconds: { [coin]: 0 },
        replica_halted: { [coin]: false },
    };
}

/** The JSON-RPC answer to a hub or encoder `ping` call. */
export function pingBody(requestBody) {
    return { jsonrpc: '2.0', id: requestBody?.id ?? 1, result: true };
}

/**
 * What the stand-in does with one request: 'pass', 'balances', 'status',
 * 'ping' or 'refuse'. 'body' is the parsed JSON request body, when there is one.
 */
export function classifyRequest(method, urlString, body = null) {
    if (!EXTERNAL_URL.test(urlString)) return 'pass';
    const url = new URL(urlString);
    if (LOOPBACK_HOSTS.has(url.hostname)) return 'pass';
    if (method === 'POST' && BALANCES_PATH.test(url.pathname)) return 'balances';
    if (method === 'GET' && STATUS_PATH.test(url.pathname)) return 'status';
    if (method === 'POST' && RPC_PATH.test(url.pathname) && body?.method === 'ping') return 'ping';
    return 'refuse';
}

/**
 * Installs the stand-in on a browser context. Call it before the first page
 * loads so the first balance read is already covered.
 */
export async function stubOfflineVenue(context) {
    await context.route(EXTERNAL_URL, async (route) => {
        const request = route.request();
        let body = null;
        try { body = request.postDataJSON(); } catch { /* an unreadable body is answered as an empty one */ }
        const verdict = classifyRequest(request.method(), request.url(), body);
        if (verdict === 'pass') return route.fallback();
        if (verdict === 'refuse') return route.abort('internetdisconnected');
        const answer = {
            balances: () => emptyBatchBody(body),
            status: () => healthyStatusBody(new URL(request.url()).pathname.match(STATUS_PATH)[1]),
            ping: () => pingBody(body),
        }[verdict]();
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(answer),
        });
    });
}
