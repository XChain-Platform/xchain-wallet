// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// User report 2026-10-06: searching "LTC" in the Send asset picker left Home's
// Tokens tab reading `Nothing matches "LTC"`, with copy pointing at a top
// toolbar that is not on the page and no way to drop the filter.

import { createWallet, expect, gotoSection, openFromSection, test } from '../../fixtures/wallet.js';
import { showHomeBalances } from '../../fixtures/homeBalances.js';
import { searchTokenPicker } from '../../fixtures/fields.js';

test('a search typed in the Send picker does not filter the Home Tokens tab', async ({ page }) => {
    await createWallet(page);
    await gotoSection(page, 'Send');
    // The Send picker lists only the From network's assets, so the send
    // moves to Litecoin before LTC can be searched.
    await openFromSection(page.getByRole('main'));
    await page.locator('button[aria-label^="Network:"]').click();
    await page.getByRole('dialog', { name: 'Network' })
        .getByRole('button', { name: /^Select Litecoin\b/ }).click();
    // The asset control is the Asset field, `Asset: <tick> on <chain>`.
    await page.getByRole('button', { name: /^Asset: / }).first().click();
    await searchTokenPicker(page, 'LTC');
    // Picker rows select the asset ("Select <name> on <chain>"); only Home's
    // balance rows open token details.
    await page.getByRole('button', { name: /^Select .*Litecoin/ }).first().click();

    await gotoSection(page, 'Home');
    const main = page.getByRole('main');
    await showHomeBalances(main, 'tokens');
    await expect(main.getByText('No matching tokens')).toHaveCount(0);
    await expect(main.getByLabel(/^Open .* details/i).first()).toBeVisible();
});

test('a Home token filter that matches nothing clears from the empty state', async ({ page }) => {
    await createWallet(page);
    const main = page.getByRole('main');
    // Token search lives in the list header's Filter and sort menu (U72).
    const filterButton = main.getByRole('button', { name: 'Filter and sort' });
    const search = main.getByRole('dialog', { name: 'Filter and sort' })
        .getByRole('searchbox', { name: 'Search tokens by name' });
    await showHomeBalances(main, 'tokens');
    await filterButton.click();
    await search.fill('ZZNOSUCHTICK');
    await page.keyboard.press('Escape');
    await expect(main.getByText('No matching tokens')).toBeVisible();
    await expect(main.getByText(/top toolbar/)).toHaveCount(0);

    await main.getByRole('button', { name: 'Clear filter' }).click();
    await expect(main.getByText('No matching tokens')).toHaveCount(0);
    await filterButton.click();
    await expect(search).toHaveValue('');
});
