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
