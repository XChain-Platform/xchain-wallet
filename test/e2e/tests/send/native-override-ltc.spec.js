// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A network-invalid action on Litecoin gets the same "Sign anyway"
// override Bitcoin gets: the pre-flight verdict is the network's opinion, not
// a local proof, so the user keeps the final say on every chain.

import { createWallet, expect, gotoSection, test } from '../../fixtures/wallet.js';

const VALID_LTC = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

// The price feed is a third-party service the dev server reaches live. When it
// rate-limits a CI runner it answers without CORS headers, and the browser logs
// that as an error that says nothing about this flow.
const PRICE_FEED = /api\.coingecko\.com/;

test('an unaffordable Litecoin token send offers Sign anyway behind the same warning', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (PRICE_FEED.test(msg.text()) || PRICE_FEED.test(msg.location()?.url || '')) return;
        consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await createWallet(page);
    await gotoSection(page, 'Send');
    await page.getByRole('button', { name: /Change asset/ }).click();
    await page.getByLabel('Search coins or tokens').fill('LITEGEM');
    await page.getByLabel(/Open Lite Gem details/i).first().click();
    const main = page.getByRole('main');
    await expect(main.getByRole('textbox', { name: /^Amount \(LITEGEM\)/ })).toBeVisible();

    await page.getByLabel('To', { exact: true }).fill(VALID_LTC);
    await page.getByRole('textbox', { name: /^Amount/ }).fill('999999');
    await main.getByRole('button', { name: 'Send', exact: true }).click();

    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText('Sign anyway')).toBeVisible();
    await expect(page.getByTestId('confirm-approve')).toBeDisabled();
    await confirm.getByTestId('ack-BALANCE_INSUFFICIENT').check();
    await expect(page.getByTestId('confirm-approve')).toBeEnabled();
    expect(consoleErrors).toEqual([]);
});
