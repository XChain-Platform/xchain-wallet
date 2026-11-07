// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home on layouts 834px and wider (ruling U45): no row of action buttons at
// the bottom, and the quick actions are Send, Receive, Exchange and More
// actions, in that order. Swap lives in the actions menu there. Below 834px
// Home keeps its phone layout: Swap in the quick actions and the action row
// under the balances.

import { createWallet, expect, test } from '../../fixtures/wallet.js';

const WIDE_WIDTHS = [834, 1280, 1440];
const BOTTOM_ROW_LABELS = ['Create token', 'Markets', 'Messaging', 'History', 'Addresses', 'Contacts', 'Staking'];

async function quickActionLabels(page) {
    const group = page.getByRole('main').getByRole('group', { name: 'Quick actions' });
    await expect(group).toBeVisible();
    return (await group.getByRole('button').allTextContents()).map((text) => text.trim());
}

async function bottomRowButtons(page) {
    const main = page.getByRole('main');
    const found = [];
    for (const label of BOTTOM_ROW_LABELS) {
        const count = await main.getByRole('button', { name: label, exact: true }).count();
        if (count > 0) found.push(label);
    }
    return found;
}

test('Home has no bottom action row and four quick actions from 834px up', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await createWallet(page);

    for (const width of WIDE_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        const where = `${width}px`;
        await expect.poll(() => quickActionLabels(page), { message: `${where}: quick actions` })
            .toEqual(['Send', 'Receive', 'Exchange', 'More actions']);
        expect(await bottomRowButtons(page), `${where}: bottom action row buttons`).toEqual([]);
        await expect(page.getByRole('main').getByRole('button', { name: 'Swap', exact: true }), `${where}: Swap`)
            .toHaveCount(0);
    }
});

test('Home keeps its phone layout at 360px', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 360, height: 800 });
    await createWallet(page);

    await expect.poll(() => quickActionLabels(page), { message: '360px: quick actions' })
        .toEqual(['Send', 'Receive', 'Exchange', 'Swap']);
});
