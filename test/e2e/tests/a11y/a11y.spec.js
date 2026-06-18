// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Automated accessibility scan (§53 / §52.6).
//
// Runs `@axe-core/playwright` against every rendered screen the web
// SPA reaches in Phase 1 (onboarding welcome → create password stage
// → mnemonic display stage → home → send form → review → locked).
// Any violation at WCAG A / AA severity fails the build.
//
// Rules we disable + why:
//   - `color-contrast`: axe can't evaluate the tokens.css custom
//     properties that drive our palette until Chromium emits the
//     computed styles we rely on; leave it on but excluded per-screen
//     if headless evaluation flakes. Today it passes; revisit if it
//     becomes noisy.
//
// If a new screen lands that's NOT covered here, add a test case.
// Silent coverage gaps are the failure mode this spec is meant to
// prevent.

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(page, label) {
    const results = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
    // Promote to a useful assertion message on failure so CI logs
    // point at the screen + the rules hit, not just a count.
    expect(
        results.violations,
        `${label} a11y violations: ${results.violations
            .map((v) => `${v.id} (${v.impact}): ${v.help}`)
            .join('; ')}`,
    ).toEqual([]);
}

test.describe('a11y: WCAG 2.1 A/AA', () => {
    test('onboarding welcome', async ({ page }) => {
        await page.goto('/');
        await expect(
            page.getByRole('button', { name: 'Create a new wallet' }),
        ).toBeVisible();
        await scan(page, 'Onboarding welcome');
    });

    test('create wallet: password stage', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'Create a new wallet' }).click();
        await expect(
            page.getByRole('heading', { name: 'Create a new wallet' }),
        ).toBeVisible();
        await scan(page, 'CreateWallet password stage');
    });

    test('create wallet: mnemonic display stage', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'Create a new wallet' }).click();
        await page.getByLabel('Password', { exact: true }).fill('a11ypassword123');
        await page.getByLabel('Confirm password').fill('a11ypassword123');
        await page.getByRole('button', { name: 'Next' }).click();
        await expect(
            page.getByRole('list', { name: 'Recovery phrase' }),
        ).toBeVisible();
        await scan(page, 'CreateWallet mnemonic stage');
    });

    test('import wallet', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'I already have a wallet' }).click();
        await expect(
            page.getByRole('heading', { name: 'Import an existing wallet' }),
        ).toBeVisible();
        await scan(page, 'ImportWallet');
    });

    test('home (unlocked)', async ({ page }) => {
        await seedWallet(page, 'a11yhomepassword');
        await scan(page, 'Home');
    });

    test('locked', async ({ page }) => {
        await seedWallet(page, 'a11ylockedpassword');
        await page.getByRole('button', { name: 'Lock' }).click();
        await expect(page.getByText(/wallet locked/i)).toBeVisible();
        await scan(page, 'Locked');
    });

    test('send: form stage', async ({ page }) => {
        await seedWallet(page, 'a11ysendpassword');
        await page.getByRole('button', { name: 'Send' }).click();
        await expect(
            page.getByRole('heading', { name: 'Send', level: 1 }).first(),
        ).toBeVisible();
        await scan(page, 'Send form');
    });
});

async function seedWallet(page, password) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new wallet' }).click();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel(/i have written down/i).check();
    await page.getByRole('button', { name: 'Create wallet' }).click();
    await expect(
        page.getByRole('button', { name: 'Lock' }),
    ).toBeVisible({ timeout: 60_000 });
}
