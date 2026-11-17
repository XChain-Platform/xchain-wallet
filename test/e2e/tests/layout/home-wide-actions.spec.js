// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home at every width: no row of action buttons, neither at the bottom nor
// under the balance. Send and Receive are navigation items (bottom bar on
// phones, sidebar on wide sizes), and Exchange and All actions are rows of
// the wallet menu.

import { createWallet, expect, nav, test } from '../../fixtures/wallet.js';

const WIDTHS = [360, 834, 1280, 1440];
const ACTION_ROW_LABELS = [
    'Send', 'Receive', 'Exchange', 'More', 'Swap',
    'Create token', 'Markets', 'Messaging', 'History', 'Addresses', 'Contacts', 'Staking',
];

async function mainActionButtons(page) {
    const main = page.getByRole('main');
    const found = [];
    for (const label of ACTION_ROW_LABELS) {
        const count = await main.getByRole('button', { name: label, exact: true }).count();
        if (count > 0) found.push(label);
    }
    return found;
}

test('Home has no quick action row at any width', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await createWallet(page);

    for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        const where = `${width}px`;
        await expect(page.getByRole('main').getByRole('group', { name: 'Quick actions' }), `${where}: quick actions`)
            .toHaveCount(0);
        expect(await mainActionButtons(page), `${where}: action buttons in Home`).toEqual([]);
        // The navigation holds Send and Receive instead.
        await expect(nav(page).getByRole('button', { name: 'Send', exact: true }), `${where}: Send in navigation`)
            .toBeVisible();
        await expect(nav(page).getByRole('button', { name: 'Receive', exact: true }), `${where}: Receive in navigation`)
            .toBeVisible();
    }
});
