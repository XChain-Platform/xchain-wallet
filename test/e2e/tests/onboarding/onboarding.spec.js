// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Onboarding golden path (§39 Phase 1 delivery contract).
//
//   1. Fresh browser -> landing is the Welcome / Onboarding screen.
//   2. Create path: password -> mnemonic -> verify -> ADS consent -> Home.
//   3. Lock -> Locked -> unlock with same password -> Home.
//   4. Import path: a known-good BIP39 vector lands on Home.
//
// The create walk itself lives in the shared fixture (see
// fixtures/wallet.js): it is the single most-changed surface in the app
// and every spec needs it.
//
// Sign + broadcast are blocked by the dev-SDK stub; those specs land
// alongside real SDK wiring.

import {
    createWallet,
    expect,
    dismissIntroCarousel,
    lockButton,
    lockWallet,
    nav,
    test,
    unlockWallet,
} from '../../fixtures/wallet.js';

// BIP39 test vector (known-good 12-word phrase).
const KNOWN_BIP39 =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test.describe('onboarding', () => {
    test('welcome screen offers the entry paths', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);

        await expect(page.getByRole('heading', { name: 'XChain Wallet' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Import wallet' })).toBeVisible();
    });

    test('create → lock → unlock round-trip', async ({ page }) => {
        await createWallet(page, { name: 'E2E', password: 'password1234' });

        await expect(nav(page).getByRole('button', { name: 'Send', exact: true })).toBeEnabled();

        await lockWallet(page);
        await unlockWallet(page, 'password1234');

        await expect(lockButton(page)).toBeVisible();
    });

    test('the recovery-phrase challenge rejects a wrong word', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Create new wallet' }).click();
        await page.getByLabel('Password', { exact: true }).fill('password1234');
        await page.getByLabel('Confirm password').fill('password1234');
        await page.getByRole('button', { name: 'Next' }).click();

        await expect(page.getByRole('list', { name: 'Recovery phrase' })).toBeVisible();
        await page.getByLabel(/i have written down/i).check();
        await page.getByRole('button', { name: 'Verify recovery phrase' }).click();

        // Deliberately wrong words: the wallet must not be created.
        const boxes = page.getByRole('textbox', { name: /^Word \d+$/ });
        const count = await boxes.count();
        for (let i = 0; i < count; i += 1) {
            await boxes.nth(i).fill('wrongword');
        }
        await page.getByRole('button', { name: 'Create wallet' }).click();

        // Still on the verification stage; no wallet, no Home.
        await expect(
            page.getByRole('heading', { name: 'Verify your recovery phrase' }),
        ).toBeVisible();
        await expect(lockButton(page)).toHaveCount(0);
    });

    test('wrong password surfaces inline', async ({ page }) => {
        await createWallet(page, { password: 'rightpassword' });
        await lockWallet(page);

        await page.getByLabel('Password').fill('WRONG');
        await page.getByRole('button', { name: 'Unlock' }).click();

        await expect(page.getByRole('alert')).toHaveText(/incorrect password/i);
    });

    test('import an existing BIP39 mnemonic', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Import wallet' }).click();

        await page.getByLabel('Recovery phrase').fill(KNOWN_BIP39);
        await page.getByLabel('Wallet name').fill('Imported E2E');
        await page.getByLabel('Password', { exact: true }).fill('importpassword1');
        await page.getByLabel('Confirm password').fill('importpassword1');
        await page.getByRole('button', { name: 'Import' }).click();

        await expect(lockButton(page)).toBeVisible({ timeout: 90_000 });
    });

    test('import rejects wrong word count', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Import wallet' }).click();

        await page.getByLabel('Recovery phrase').fill('word '.repeat(13).trim());
        await page.getByLabel('Password', { exact: true }).fill('xxxxxxxxxx');
        await page.getByLabel('Confirm password').fill('xxxxxxxxxx');
        await page.getByRole('button', { name: 'Import' }).click();

        await expect(page.getByRole('alert')).toContainText(
            /expected 12, 15, 18, 21, 24 words/i,
        );
    });
});
