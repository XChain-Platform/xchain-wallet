// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Keyboard-only use of the Settings sub-pages in demo mode: a sub-page takes
// focus on its heading and hands it back to its row, an inline form takes
// focus on its first field, Escape closes the form before the sub-page, and
// focus returns to the control that opened it.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const SIZES = [
    { name: 'phone', width: 360, height: 800 },
    { name: 'desktop', width: 1440, height: 900 },
];

async function openSubpage(page, title) {
    await gotoSection(page, 'Settings');
    const row = page.getByRole('main').getByRole('button', { name: new RegExp(`^${title}\\b`, 'i') }).first();
    await row.focus();
    await page.keyboard.press('Enter');
    const heading = page.getByRole('heading', { level: 1, name: title, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading, 'focus moves to the sub-page heading').toBeFocused();
    return row;
}

for (const size of SIZES) {
    test.describe(`settings forms by keyboard at ${size.width}x${size.height}`, () => {
        test.beforeEach(async ({ page }) => {
            await page.setViewportSize({ width: size.width, height: size.height });
            await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        });

        test('a sub-page hands focus back to its row on Escape', async ({ page }) => {
            const row = await openSubpage(page, 'Network and Fees');
            await page.keyboard.press('Escape');
            await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
            await expect(row).toBeFocused();
        });

        // These pages open straight on their form (no intro button, no
        // Cancel); the row on the group page opens them and Back leaves.
        for (const [title, rowName, field] of [
            ['Security', 'Wallet password', 'Current wallet password'],
            ['Backup and Recovery', 'Recovery phrase', 'Wallet password'],
            ['Backup and Recovery', 'Test backup', 'Recovery phrase to test'],
        ]) {
            test(`${title} ${rowName} opens on its first field and Escape returns to the group row`, async ({ page }) => {
                await openSubpage(page, title);
                const button = page.getByRole('main').getByRole('button', { name: new RegExp(`^${rowName}\\b`) }).first();
                await button.focus();
                await page.keyboard.press('Enter');
                // Exact or by role: each field's 'About ...' help tip (U57) carries its label too.
                await expect(page.getByLabel(field, { exact: true }), 'focus is in the form').toBeFocused();
                await page.keyboard.press('Escape');
                await expect(page.getByRole('heading', { level: 1, name: title, exact: true }), 'the group page is back').toBeVisible();
                await expect(page.getByRole('main').getByRole('button', { name: new RegExp(`^${rowName}\\b`) }).first()).toBeFocused();
            });
        }

        // The freeze confirmation is its own page: a notice and one Confirm
        // button, no Cancel; Back or Escape leaves it.
        test('panic mode confirmation is one page and Escape returns to its row', async ({ page }) => {
            await openSubpage(page, 'Security');
            const row = page.getByRole('main').getByRole('button', { name: /^Panic mode\b/ }).first();
            await row.focus();
            await page.keyboard.press('Enter');
            await expect(page.getByRole('heading', { level: 1, name: 'Panic Mode', exact: true })).toBeVisible();
            await expect(page.getByRole('main').getByRole('button', { name: 'Confirm 24-Hour Freeze' })).toBeVisible();
            await expect(page.getByRole('main').getByRole('button', { name: 'Cancel' })).toHaveCount(0);
            await page.keyboard.press('Escape');
            await expect(page.getByRole('heading', { level: 1, name: 'Security', exact: true })).toBeVisible();
            await expect(row).toBeFocused();
        });
    });
}

test.describe('Keyboard settings at 1440x900', () => {
    test('Escape cancels a rebind in progress without closing the sub-page', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await openSubpage(page, 'Advanced');
        await page.getByRole('main').getByRole('button', { name: /^Keyboard shortcuts\b/ }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Keyboard', exact: true })).toBeVisible();
        const rebind = page.getByRole('button', { name: 'Rebind' }).first();
        await rebind.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: 'Cancel' }).first()).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('heading', { level: 1, name: 'Keyboard', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Rebind' }).first()).toBeFocused();
    });
});
