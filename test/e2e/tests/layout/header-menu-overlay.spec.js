// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, expect, test } from '../../fixtures/wallet.js';

// Settings is a footer destination in the wallet menu. Selecting it closes the
// sheet before the Settings page paints.
test.describe('layout: wallet menu Settings destination', () => {
    test('closes the phone sheet before Settings opens', async ({ page }) => {
        await createWallet(page, { name: 'Overlay wallet' });
        await page.setViewportSize({ width: 360, height: 800 });

        const header = page.getByRole('region', { name: 'App header' });
        await header.getByRole('button', { name: 'Open menu' }).click();
        const menu = page.getByRole('dialog', { name: 'Wallet menu' });
        await expect(menu).toBeVisible();

        await menu.locator('[data-wallet-menu-row="settings"]').click();
        await expect(menu).toBeHidden();
        await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
        if (process.env.E2E_SHOT) await page.screenshot({ path: process.env.E2E_SHOT });
    });
});
