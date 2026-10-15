// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Answers the wallet's fiat price requests locally, so no spec reaches the live
// price service. Every spec that creates or unlocks a wallet triggers a price
// fetch; when the live service rate-limits a runner it replies without CORS
// headers, the browser logs a console error that says nothing about the flow
// under test, and any "no console errors" check goes red.
//
// The numbers are fixed and arbitrary: specs that assert on fiat amounts
// register their own page-level route, which takes priority over this
// context-level one.

const RATES_USD = {
    bitcoin: 65000,
    litecoin: 80,
    dogecoin: 0.1,
};
const FALLBACK_USD = 1;

const PRICE_URL = 'https://api.coingecko.com/api/v3/**';

/**
 * Builds the JSON body for one price-service URL.
 *
 * @param {string} url
 * @returns {object}
 */
export function priceStubBody(url) {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/market_chart')) {
        const now = Date.now();
        return { prices: [[now - 86_400_000, 64000], [now, 65000]] };
    }
    const ids = (parsed.searchParams.get('ids') || '').split(',').filter(Boolean);
    const vs = (parsed.searchParams.get('vs_currencies') || 'usd').toLowerCase().split(',');
    const body = {};
    for (const id of ids) {
        const row = { [`${vs[0]}_market_cap`]: 1, [`${vs[0]}_24h_change`]: 0 };
        for (const currency of vs) row[currency] = RATES_USD[id] ?? FALLBACK_USD;
        body[id] = row;
    }
    return body;
}

/**
 * Routes every price-service request of a browser context to the local stub.
 *
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function stubPriceFeed(context) {
    await context.route(PRICE_URL, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(priceStubBody(route.request().url())),
        });
    });
}
