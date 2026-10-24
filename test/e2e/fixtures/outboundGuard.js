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

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);
const LOCAL_SCHEMES = new Set(['data:', 'blob:', 'about:', 'file:', 'chrome:', 'devtools:']);

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
 * Starts recording non-local requests and WebSockets of a page.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {{ attempts: string[] }}
 */
export async function guardOutbound(page) {
    const attempts = [];
    await page.context().route('**/*', async (route) => {
        const url = route.request().url();
        if (isLocalUrl(url)) {
            await route.fallback();
            return;
        }
        attempts.push(`${route.request().method()} ${url}`);
        await route.abort('blockedbyclient');
    });
    page.on('websocket', (ws) => {
        if (!isLocalUrl(ws.url())) attempts.push(`WS ${ws.url()}`);
    });
    return { attempts };
}
