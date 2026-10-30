// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// My swaps on an address with more swaps than one explorer page holds. The
// explorer answers 100 rows a page with the total it found; the list shows
// every swap, and a cancel that sits on a later page of the cancels feed
// still closes its swap, so the screen offers no second cancel for it.

import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
import { documentOverflow } from '../../fixtures/responsive.js';

const TOTAL = 250;
const PAGE = 100;
const NEWEST = 90_000;
const OLDEST = NEWEST - TOTAL + 1;

/** Serves a paged address-scoped swaps feed from the dev-mock explorer. */
async function installPagedSwaps(page) {
    await page.addInitScript(({ total, pageSize, newest }) => {
        globalThis.__xchainPagedSwaps = { total, pageSize, newest, owner: null };
    }, { total: TOTAL, pageSize: PAGE, newest: NEWEST });

    await page.route('**/src/hostBridge.js*', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const original = `            if (prop === 'getSwaps') {
                return async (query, type /* , opts */) => {`;
        const replacement = `            if (prop === 'getSwapCancels') {
                return async (query, type, opts = {}) => {
                    const fixture = globalThis.__xchainPagedSwaps;
                    if (!fixture || type !== 'address' || !String(chainId).startsWith('bitcoin')) return [];
                    if (!fixture.owner) fixture.owner = query;
                    if (fixture.owner !== query) return { data: [], total: 0 };
                    const pageNo = opts.page || 1;
                    const rows = [];
                    for (let i = 0; i < 150; i += 1) {
                        rows.push({ source: query, status: i === 149 ? 'valid' : 'invalid', swap_action_index: String(fixture.newest - fixture.total + 1) });
                    }
                    return { data: rows.slice((pageNo - 1) * fixture.pageSize, pageNo * fixture.pageSize), total: rows.length };
                };
            }
            if (prop === 'getSwaps' && globalThis.__xchainPagedSwaps) {
                return async (query, type, opts = {}) => {
                    const fixture = globalThis.__xchainPagedSwaps;
                    if (type !== 'address' || !String(chainId).startsWith('bitcoin')) return [];
                    if (!fixture.owner) fixture.owner = query;
                    if (fixture.owner !== query) return { data: [], total: 0 };
                    const pageNo = opts.page || 1;
                    const data = [];
                    const start = (pageNo - 1) * fixture.pageSize;
                    for (let i = start; i < Math.min(start + fixture.pageSize, fixture.total); i += 1) {
                        data.push({
                            action_index: String(fixture.newest - i),
                            source: query,
                            status: 'valid',
                            give_tick: 'ALPHA',
                            give_amount: '1',
                            get_tick: 'BETA',
                            get_amount: String(i + 1),
                        });
                    }
                    return { data, total: fixture.total };
                };
            }
            if (prop === 'getSwaps') {
                return async (query, type /* , opts */) => {`;
        if (!source.includes(original)) {
            throw new Error('The dev-mock explorer seam changed; update the paged swaps fixture.');
        }
        await route.fulfill({
            response,
            body: source.replace(original, replacement),
            headers: { ...response.headers(), 'content-type': 'text/javascript' },
        });
    });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 360, height: 780 }]) {
    test(`lists every swap past the first explorer page at ${viewport.width} px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await installPagedSwaps(page);
        await createWallet(page);

        await openPaletteCommand(page, 'My swaps');
        const open = page.getByRole('list', { name: 'Open swaps' });
        await expect(open.getByRole('listitem')).toHaveCount(TOTAL - 1, { timeout: 60_000 });
        await expect(open.getByText(`#${OLDEST + 1}`, { exact: true })).toBeVisible();

        const closed = page.getByRole('list', { name: 'Closed swaps' });
        const cancelledRow = closed.getByRole('listitem').filter({ hasText: `#${OLDEST}` });
        await expect(cancelledRow.getByLabel('Status: Cancelled')).toBeVisible();
        await expect(cancelledRow.getByRole('button', { name: 'Cancel' })).toHaveCount(0);

        const overflow = await documentOverflow(page);
        expect(overflow.scrollWidth, 'My swaps scrolls sideways').toBeLessThanOrEqual(overflow.clientWidth);
    });
}
