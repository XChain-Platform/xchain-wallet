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

import { createWallet, expect, gotoSection, test } from '../../fixtures/wallet.js';

test('a search typed in the Send picker does not filter the Home Tokens tab', async ({ page }) => {
    await createWallet(page);
    await gotoSection(page, 'Send');
    await page.getByRole('button', { name: /Change asset/ }).click();
    await page.getByLabel('Search coins or tokens').fill('LTC');
    await page.getByLabel(/^Open .* details/i).first().click();

    await gotoSection(page, 'Home');
    const main = page.getByRole('main');
    await main.getByRole('tab', { name: 'Tokens' }).click();
    await expect(main.getByText('No matching tokens')).toHaveCount(0);
    await expect(main.getByLabel(/^Open .* details/i).first()).toBeVisible();
});

test('a Home token filter that matches nothing clears from the empty state', async ({ page }) => {
    await createWallet(page);
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Show filters' }).click();
    await main.getByRole('searchbox', { name: 'Search tokens by name' }).fill('ZZNOSUCHTICK');
    await main.getByRole('tab', { name: 'Tokens' }).click();
    await expect(main.getByText('No matching tokens')).toBeVisible();
    await expect(main.getByText(/top toolbar/)).toHaveCount(0);

    await main.getByRole('button', { name: 'Clear filter' }).click();
    await expect(main.getByText('No matching tokens')).toHaveCount(0);
    await expect(main.getByRole('searchbox', { name: 'Search tokens by name' })).toHaveValue('');
});
