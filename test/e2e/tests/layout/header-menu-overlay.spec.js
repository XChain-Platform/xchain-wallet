// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, expect, gotoSection, test, unlockedShell } from '../../fixtures/wallet.js';

// On a phone the Settings popover opened from the header menu left the menu
// panel painted underneath it. The popover and the menu may not both show.
test.describe('layout: header menu with the Settings popover', () => {
    test('hides the menu panel while the Settings popover is open on a phone', async ({ page }) => {
        await createWallet(page, { name: 'Overlay wallet' });
        await page.setViewportSize({ width: 360, height: 800 });
        await gotoSection(page, 'Home');
        await expect(unlockedShell(page)).toBeVisible();

        const header = page.getByRole('region', { name: 'App header' });
        await header.getByRole('button', { name: 'Open menu' }).click();
        const menu = page.getByRole('menu', { name: 'Header actions' });
        await expect(menu).toBeVisible();

        await menu.getByRole('menuitem', { name: /^Settings\b/ }).click();
        const popover = page.getByRole('dialog', { name: 'Wallet settings' });
        await expect(popover).toBeVisible();
        if (process.env.E2E_SHOT) await page.screenshot({ path: process.env.E2E_SHOT });

        await expect(menu).toHaveCSS('opacity', '0');
        const covered = await popover.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const probe = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            return node.contains(probe);
        });
        expect(covered, 'the popover is the topmost surface').toBe(true);

        // Escape closes the popover and the page returns to a usable state.
        await page.keyboard.press('Escape');
        await expect(popover).toBeHidden();
    });
});
