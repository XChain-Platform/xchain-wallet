// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §33 Command Palette E2E. Drives the real web shell: the palette opens
// from both the header search button and the Cmd/Ctrl+K shortcut, filters,
// and actually navigates the app when a command is run. The unit tests
// cover the component and matcher in isolation; this proves the shell
// wiring (global shortcut listener, command closures over setUnlockedView,
// overlay mount) end-to-end.

import { test, expect, createWallet, nav } from '../../fixtures/wallet.js';

const dialog = (page) => page.getByRole('dialog', { name: 'Command palette' });
const navItem = (page, name) => nav(page).getByRole('button', { name, exact: true });

test.describe('command palette', () => {
    test('opens from the header button and the shortcut, and navigates', async ({ page }) => {
        await createWallet(page);

        // Header search button opens it; Enter runs the top match.
        await page.getByRole('button', { name: 'Open command palette' }).click();
        await expect(dialog(page)).toBeVisible();
        await dialog(page).getByRole('combobox').fill('history');
        await page.keyboard.press('Enter');
        await expect(dialog(page)).toBeHidden();
        await expect(navItem(page, 'History')).toHaveAttribute('aria-current', 'page');

        // Cmd/Ctrl+K opens it too; clicking a result navigates.
        await page.keyboard.press('ControlOrMeta+k');
        await expect(dialog(page)).toBeVisible();
        await dialog(page).getByRole('combobox').fill('receive');
        await dialog(page).getByRole('option', { name: /Receive/ }).first().click();
        await expect(dialog(page)).toBeHidden();
        await expect(navItem(page, 'Receive')).toHaveAttribute('aria-current', 'page');
    });

    test('a free-form "send N TICK" query opens Send prefilled (§33.3)', async ({ page }) => {
        await createWallet(page);

        await page.keyboard.press('ControlOrMeta+k');
        await expect(dialog(page)).toBeVisible();
        await dialog(page).getByRole('combobox').fill('send 100 XCP');
        // The parsed intent is the pre-selected top result; Enter runs it.
        await expect(dialog(page).getByRole('option').first()).toContainText('Send 100 XCP');
        await page.keyboard.press('Enter');

        await expect(dialog(page)).toBeHidden();
        await expect(navItem(page, 'Send')).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('textbox', { name: /^Amount/ })).toHaveValue('100');
    });

    test('Escape closes the palette without running a command', async ({ page }) => {
        await createWallet(page);
        // Fresh wallet lands on Home; that's our "did not navigate" anchor.
        await expect(navItem(page, 'Home')).toHaveAttribute('aria-current', 'page');

        // Open, type a query that WOULD navigate on Enter, then Escape instead.
        await page.keyboard.press('ControlOrMeta+k');
        await expect(dialog(page)).toBeVisible();
        await dialog(page).getByRole('combobox').fill('history');
        await page.keyboard.press('Escape');

        // Palette closed and the view is unchanged (Escape ran nothing).
        await expect(dialog(page)).toBeHidden();
        await expect(navItem(page, 'Home')).toHaveAttribute('aria-current', 'page');
    });

    test('token entity search opens TokenDetail with the full ref ', async ({ page }) => {
        await createWallet(page);

        // Balance rows join the palette's searchable surface on open. The
        // fresh wallet carries the preview balance set, so a held token's
        // tick resolves to a Tokens command that lands on its detail page.
        await page.keyboard.press('ControlOrMeta+k');
        await expect(dialog(page)).toBeVisible();
        const input = dialog(page).getByRole('combobox');
        await input.fill('pepecash');
        const tokenOption = dialog(page).getByRole('option', { name: /Pepe Cash/ }).first();
        await expect(tokenOption).toBeVisible();
        await tokenOption.click();
        await expect(dialog(page)).toBeHidden();
        await expect(page.getByRole('main')).toContainText('PEPECASH');
    });
});
