// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    createWallet,
    expect,
    gotoSection,
    nav,
    openSettings,
    test,
    unlockedShell,
    unlockButton,
} from '../../fixtures/wallet.js';

const OLD_PASSWORD = 'original-password-1234';
const NEW_PASSWORD = 'replacement-password-5678';

async function openSettingsSubpage(page, name, ready) {
    await openSettings(page);
    const row = page.getByRole('main').getByRole('button', {
        name: new RegExp(`^${name}\\b`, 'i'),
    }).first();
    await expect(row, `Settings has no ${name} row`).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(ready, `${name} did not open`).toBeVisible({ timeout: 30_000 });
}

async function lockFromPhoneNavigation(page) {
    await gotoSection(page, 'Home');
    await expect(unlockedShell(page)).toBeVisible();
    const bottomNavigation = nav(page);
    await bottomNavigation.getByRole('button', { name: 'More', exact: true }).click();
    const more = page.getByRole('dialog', { name: 'More', exact: true });
    await more.getByRole('button', { name: 'Lock wallet', exact: true }).click();
    await expect(unlockButton(page)).toBeVisible();
}

async function expectBiometricUnlockOffIfOffered(page) {
    const main = page.getByRole('main');
    const label = main.getByText('Biometric unlock', { exact: true }).first();
    await openSettingsSubpage(page, 'Safety', label);
    await expect(main.getByText('Checking this device…', { exact: true }))
        .toHaveCount(0, { timeout: 30_000 });

    const toggle = main.getByRole('switch', { name: /biometric unlock/i });
    if (await toggle.count() > 0) {
        await expect(toggle, 'password change left biometric unlock on').not.toBeChecked();
        return;
    }

    const enable = main.getByRole('button', { name: 'Enable', exact: true });
    const unavailable = main.getByText(/^Not available\./);
    await expect(
        enable.or(unavailable).first(),
        'biometric unlock is neither off nor reported unavailable',
    ).toBeVisible();
    await expect(
        main.getByRole('button', { name: 'Disable', exact: true }),
        'password change left biometric unlock enabled',
    ).toHaveCount(0);
}

test.describe('Settings: change wallet password', () => {
    test.use({
        viewport: { width: 412, height: 869 },
        actionTimeout: 30_000,
    });
    test.setTimeout(600_000);

    test('the old password is refused and the new password unlocks', async ({ page }) => {
        await createWallet(page, {
            name: 'Password Change Wallet',
            password: OLD_PASSWORD,
        });

        await test.step('change the password in Settings', async () => {
            const change = page.getByRole('main')
                .getByRole('button', { name: 'Change…', exact: true });
            await openSettingsSubpage(page, 'This wallet', change);
            await change.click();

            await page.getByLabel('Current wallet password').fill(OLD_PASSWORD);
            await page.getByLabel('New wallet password').fill(NEW_PASSWORD);
            await page.getByLabel('Confirm new wallet password').fill(NEW_PASSWORD);
            await page.getByRole('main')
                .getByRole('button', { name: 'Change password', exact: true })
                .click();

            await expect(page.getByText('Wallet password changed.', { exact: true }))
                .toBeVisible({ timeout: 120_000 });
        });

        await test.step('the old password is refused with a plain message', async () => {
            await lockFromPhoneNavigation(page);
            await page.getByLabel('Password', { exact: true }).fill(OLD_PASSWORD);
            await unlockButton(page).click();

            await expect(page.getByRole('alert')).toHaveText('Incorrect password.', {
                timeout: 120_000,
            });
            await expect(unlockButton(page)).toBeVisible();
        });

        await test.step('the new password unlocks the same vault', async () => {
            await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
            await unlockButton(page).click();
            await expect(unlockedShell(page)).toBeVisible({ timeout: 120_000 });
        });

        await test.step('biometric unlock is off when the device offers it', async () => {
            await expectBiometricUnlockOffIfOffered(page);
        });
    });
});
