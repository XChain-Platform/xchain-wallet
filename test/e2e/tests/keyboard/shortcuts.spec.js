// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §34 keyboard shortcuts E2E. Drives the real web shell: the `?` help modal,
// the `g`-leader navigation, and a modifier combo (Cmd/Ctrl+L locks). The unit
// tests cover the dispatcher in isolation; this proves the shell wiring
// (handlers -> setUnlockedView / lock, the ShortcutHelp mount, and the
// enabled-gating).

import { test, expect, createWallet, nav, unlockButton } from '../../fixtures/wallet.js';

const helpDialog = (page) => page.getByRole('dialog', { name: 'Keyboard shortcuts' });
const navItem = (page, name) => nav(page).getByRole('button', { name, exact: true });

test.describe('keyboard shortcuts', () => {
    test('? opens the help modal, and g-then-h navigates to History', async ({ page }) => {
        await createWallet(page);

        // `?` (Shift+/) opens the shortcut cheatsheet; Escape closes it.
        await page.keyboard.press('Shift+Slash');
        await expect(helpDialog(page)).toBeVisible();
        await expect(helpDialog(page)).toContainText('Go to History');
        await page.keyboard.press('Escape');
        await expect(helpDialog(page)).toBeHidden();

        // g-leader navigation.
        await page.keyboard.press('g');
        await page.keyboard.press('h');
        await expect(navItem(page, 'History')).toHaveAttribute('aria-current', 'page');
    });

    test('Cmd/Ctrl+L locks the wallet', async ({ page }) => {
        await createWallet(page);
        await page.keyboard.press('ControlOrMeta+l');
        await expect(unlockButton(page)).toBeVisible();
    });
});

// §34.1 rebinding + §34.2 context shortcuts (residuals).
test.describe('keyboard shortcut residuals', () => {
    test('rebinding Lock wallet in Settings takes effect immediately', async ({ page }) => {
        await createWallet(page);

        // Palette deep-link into Settings -> Keyboard (also proves that
        // settings-section commands end-to-end).
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('dialog', { name: 'Command palette' })
            .getByRole('combobox').fill('settings keyboard');
        await page.keyboard.press('Enter');
        await expect(page.getByText('Click Rebind, then press the new key combination.', { exact: false })).toBeVisible();

        // Rebind Lock wallet to Cmd/Ctrl+J.
        const lockRow = page.locator('div').filter({ hasText: /^Lock wallet/ }).last();
        await lockRow.getByRole('button', { name: 'Rebind' }).click();
        await page.keyboard.press('ControlOrMeta+j');
        await expect(page.getByText(/Lock wallet is now/)).toBeVisible();

        // The old combo is dead; the new one locks.
        await page.keyboard.press('ControlOrMeta+l');
        await expect(unlockButton(page)).toBeHidden();
        await page.keyboard.press('ControlOrMeta+j');
        await expect(unlockButton(page)).toBeVisible();
    });

    test('History: e opens the export modal, / focuses search (§34.2)', async ({ page }) => {
        await createWallet(page);
        await page.keyboard.press('g');
        await page.keyboard.press('h');
        await expect(nav(page).getByRole('button', { name: 'History', exact: true }))
            .toHaveAttribute('aria-current', 'page');

        await page.keyboard.press('/');
        await expect(page.getByRole('searchbox', { name: 'Search history' })).toBeFocused();
        // '/' inside the (now focused) input must NOT re-trigger; blur first.
        await page.keyboard.press('Escape');
        await page.getByRole('searchbox', { name: 'Search history' }).blur();

        await page.keyboard.press('e');
        await expect(page.getByRole('dialog', { name: 'Export history' })).toBeVisible();
    });
});
