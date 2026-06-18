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
// Exercises every state the in-page App.jsx can reach without the
// real xchain-sdk bundled:
//
//   1. Fresh browser → landing is the Welcome / Onboarding screen.
//   2. Create path: password + mnemonic + acknowledge → Home.
//   3. Lock → Locked → unlock with same password → Home.
//   4. Import path: second browser context starts clean, import a
//      known-good BIP39 vector, land on Home.
//
// Sign + broadcast are blocked by the dev-SDK stub (see CHANGELOG
// v0.43.0). Those specs land alongside real SDK wiring.

import { expect, test } from '@playwright/test';

// BIP39 test vector from SLIP-0039 spec (known-good 12-word phrase).
const KNOWN_BIP39 =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test.describe('onboarding', () => {
    test('create → lock → unlock round-trip', async ({ page }) => {
        await page.goto('/');

        // Welcome / Onboarding
        await expect(
            page.getByRole('heading', { name: 'XChain Wallet' }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Create new wallet' }).click();

        // Password stage
        await expect(
            page.getByRole('heading', { name: 'Create a new wallet' }),
        ).toBeVisible();
        await page.getByLabel('Wallet name').fill('E2E');
        await page.getByLabel('Password', { exact: true }).fill('password1234');
        await page.getByLabel('Confirm password').fill('password1234');
        await page.getByRole('button', { name: 'Next' }).click();

        // Mnemonic display stage
        await expect(
            page.getByRole('heading', { name: /write down your recovery phrase/i }),
        ).toBeVisible();
        await expect(page.getByRole('list', { name: 'Recovery phrase' })).toBeVisible();
        await page.getByLabel(/i have written down my recovery phrase/i).check();
        await page.getByRole('button', { name: 'Create wallet' }).click();

        // Home: reached after KDF + vault save
        await expect(
            page.getByRole('button', { name: 'Lock' }),
        ).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();

        // Lock
        await page.getByRole('button', { name: 'Lock' }).click();
        await expect(page.getByText(/wallet locked/i)).toBeVisible();

        // Unlock round-trip: proves kdfParams persisted correctly
        await page.getByLabel('Password').fill('password1234');
        await page.getByRole('button', { name: 'Unlock' }).click();
        await expect(
            page.getByRole('button', { name: 'Lock' }),
        ).toBeVisible({ timeout: 60_000 });
    });

    test('wrong password surfaces inline', async ({ page }) => {
        // Seed a wallet first.
        await page.goto('/');
        await page.getByRole('button', { name: 'Create new wallet' }).click();
        await page.getByLabel('Password', { exact: true }).fill('rightpassword');
        await page.getByLabel('Confirm password').fill('rightpassword');
        await page.getByRole('button', { name: 'Next' }).click();
        await page.getByLabel(/i have written down/i).check();
        await page.getByRole('button', { name: 'Create wallet' }).click();
        await expect(
            page.getByRole('button', { name: 'Lock' }),
        ).toBeVisible({ timeout: 60_000 });
        await page.getByRole('button', { name: 'Lock' }).click();

        // Wrong password
        await page.getByLabel('Password').fill('WRONG');
        await page.getByRole('button', { name: 'Unlock' }).click();
        await expect(page.getByRole('alert')).toHaveText(/incorrect password/i);
    });

    test('import an existing BIP39 mnemonic', async ({ page }) => {
        await page.goto('/');
        await page
            .getByRole('button', { name: 'Import wallet' })
            .click();

        await page.getByLabel('Recovery phrase').fill(KNOWN_BIP39);
        await page.getByLabel('Wallet name').fill('Imported E2E');
        await page.getByLabel('Password', { exact: true }).fill('importpassword1');
        await page.getByLabel('Confirm password').fill('importpassword1');
        await page.getByRole('button', { name: 'Import' }).click();

        await expect(
            page.getByRole('button', { name: 'Lock' }),
        ).toBeVisible({ timeout: 60_000 });
    });

    test('import rejects wrong word count', async ({ page }) => {
        await page.goto('/');
        await page
            .getByRole('button', { name: 'Import wallet' })
            .click();

        // 13 words: not a valid BIP39 count.
        await page.getByLabel('Recovery phrase').fill(
            'word '.repeat(13).trim(),
        );
        await page.getByLabel('Password', { exact: true }).fill('xxxxxxxxxx');
        await page.getByLabel('Confirm password').fill('xxxxxxxxxx');
        await page.getByRole('button', { name: 'Import' }).click();

        await expect(page.getByRole('alert')).toHaveText(
            /expected 12, 15, 18, 21, or 24 words/i,
        );
    });
});
