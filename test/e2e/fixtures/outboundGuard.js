// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Fails a test that tries to leave the machine. The dev-mock suite is meant to
// reach loopback only; the host-resolver rule refuses other hosts but only
// shows up as a stray console error, and a run without it would reach live
// services unnoticed. This names the host the moment a new outbound call
// appears.
//
// Install it BEFORE the stubs: Playwright runs the most recently registered
// route first, so a stub fulfils its own host and only an unstubbed request
// falls through to this catch-all. WebSockets bypass routes, so they are
// watched through the page event.

import {
    classifyRequest,
    emptyBatchBody,
    healthyStatusBody,
    pingBody,
} from './offlineVenue.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);
const LOCAL_SCHEMES = new Set(['data:', 'blob:', 'about:', 'file:', 'chrome:', 'devtools:']);
const STATUS_PATH = /^\/([A-Za-z]+)\/api\/status$/;

export const XCHAIN_SERVICE_HOSTS = Object.freeze([
    'explorer.xchain.io',
    'hub.xchain.io',
    'encoder.xchain.io',
]);

function hostSet(hosts = []) {
    return hosts instanceof Set ? hosts : new Set(hosts);
}

/**
 * True when a URL stays on this machine.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isLocalUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return true;
    }
    if (LOCAL_SCHEMES.has(parsed.protocol)) return true;
    return LOCAL_HOSTS.has(parsed.hostname);
}

/**
 * True when a URL belongs to one of the explicitly stubbed hosts.
 *
 * @param {string} url
 * @param {Iterable<string>} hosts
 * @returns {boolean}
 */
export function isStubbedUrl(url, hosts = []) {
    try {
        return hostSet(hosts).has(new URL(url).hostname);
    } catch {
        return false;
    }
}

/**
 * Answers the production service probes needed to reach Home and refuses every
 * other request to those hosts.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {Iterable<string>} hosts
 */
export async function stubOutboundHosts(context, hosts = []) {
    const stubbedHosts = hostSet(hosts);
    if (stubbedHosts.size === 0) return;

    await context.route('**/*', async (route) => {
        const request = route.request();
        if (!isStubbedUrl(request.url(), stubbedHosts)) {
            await route.fallback();
            return;
        }

        let body = null;
        try { body = request.postDataJSON(); } catch { /* malformed JSON is refused below */ }
        const verdict = classifyRequest(request.method(), request.url(), body);
        if (verdict === 'refuse' || verdict === 'pass') {
            await route.abort('internetdisconnected');
            return;
        }

        const responseBody = {
            balances: () => emptyBatchBody(body),
            status: () => healthyStatusBody(new URL(request.url()).pathname.match(STATUS_PATH)[1]),
            ping: () => pingBody(body),
        }[verdict]();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(responseBody),
        });
    });
}

/**
 * Starts recording non-local requests and WebSockets of a page.
 *
 * `liveHosts` are let through to the network untouched: the testnet suite
 * exists to drive the live testnet services, so blocking them leaves the
 * wallet offline and every network action greyed out.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ stubbedHosts?: Iterable<string>, liveHosts?: Iterable<string> }} [options]
 * @returns {{ attempts: string[] }}
 */
export async function guardOutbound(page, { stubbedHosts = [], liveHosts = [] } = {}) {
    const attempts = [];
    const stubbed = hostSet(stubbedHosts);
    const live = hostSet(liveHosts);
    await page.context().route('**/*', async (route) => {
        const url = route.request().url();
        if (isLocalUrl(url) || isStubbedUrl(url, live)) {
            await route.fallback();
            return;
        }
        if (isStubbedUrl(url, stubbed)) {
            await route.abort('internetdisconnected');
            return;
        }
        attempts.push(`${route.request().method()} ${url}`);
        await route.abort('blockedbyclient');
    });
    page.on('websocket', (ws) => {
        const url = ws.url();
        if (!isLocalUrl(url) && !isStubbedUrl(url, stubbed) && !isStubbedUrl(url, live)) attempts.push(`WS ${url}`);
    });
    return { attempts };
}
