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
// Runs `@axe-core/playwright` against every rendered screen the web SPA
// reaches in Phase 1. Any violation at WCAG A / AA severity fails the
// build. Color contrast is scanned here (not in the jsdom suites)
// because only a real browser computes the styles our tokens.css
// custom properties resolve to.
//
// If a new screen lands that's NOT covered here, add a test case.
// Silent coverage gaps are the failure mode this spec is meant to
// prevent -- and it did happen: the license gate, the recovery-phrase
// verification stage and the ADS consent screen all shipped unscanned
// while this suite sat un-run. They are covered below.

import {
    acknowledgeDonationConsent,
    createWallet,
    expect,
    dismissIntroCarousel,
    gotoSection,
    lockWallet,
    readRecoveryPhrase,
    test,
} from '../../fixtures/wallet.js';
import { scan } from '../../fixtures/a11y.js';

// The license gate renders ahead of everything else, so it needs the
// fixture's bypass turned off to be scanned at all.
test.describe('a11y: WCAG 2.1 A/AA (license gate)', () => {
    test.use({ acceptLicense: false });

    test('license gate', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: /Accept and continue/i })).toBeVisible();
        await scan(page, 'License gate');
    });
});

test.describe('a11y: WCAG 2.1 A/AA', () => {
    test('onboarding welcome', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await expect(page.getByRole('button', { name: 'Create new wallet' })).toBeVisible();
        await scan(page, 'Onboarding welcome');
    });

    test('create wallet: password stage', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Create new wallet' }).click();
        await expect(
            page.getByRole('heading', { name: 'Create a new wallet' }),
        ).toBeVisible();
        await scan(page, 'CreateWallet password stage');
    });

    test('create wallet: mnemonic display stage', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Create new wallet' }).click();
        await page.getByLabel('Password', { exact: true }).fill('a11ypassword123');
        await page.getByLabel('Confirm password').fill('a11ypassword123');
        await page.getByRole('button', { name: 'Next' }).click();
        await expect(page.getByRole('list', { name: 'Recovery phrase' })).toBeVisible();
        await scan(page, 'CreateWallet mnemonic stage');
    });

    test('create wallet: recovery-phrase verification stage', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Create new wallet' }).click();
        await page.getByLabel('Password', { exact: true }).fill('a11ypassword123');
        await page.getByLabel('Confirm password').fill('a11ypassword123');
        await page.getByRole('button', { name: 'Next' }).click();
        await readRecoveryPhrase(page);
        await page.getByLabel(/i have written down/i).check();
        await page.getByRole('button', { name: 'Verify recovery phrase' }).click();
        await expect(
            page.getByRole('heading', { name: 'Verify your recovery phrase' }),
        ).toBeVisible();
        await scan(page, 'CreateWallet verification stage');
    });

    test('donation consent', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Create new wallet' }).click();
        await page.getByLabel('Password', { exact: true }).fill('a11ypassword123');
        await page.getByLabel('Confirm password').fill('a11ypassword123');
        await page.getByRole('button', { name: 'Next' }).click();

        const words = await readRecoveryPhrase(page);
        await page.getByLabel(/i have written down/i).check();
        await page.getByRole('button', { name: 'Verify recovery phrase' }).click();
        for (let position = 1; position <= words.length; position += 1) {
            const box = page.getByRole('textbox', { name: `Word ${position}`, exact: true });
            if (await box.count()) await box.fill(words[position - 1]);
        }
        await page.getByRole('button', { name: 'Create wallet' }).click();

        await expect(
            page.getByRole('heading', { name: /Support XChain development/i }),
        ).toBeVisible({ timeout: 90_000 });
        await scan(page, 'Donation consent');

        await acknowledgeDonationConsent(page);
    });

    test('import wallet', async ({ page }) => {
        await page.goto('/');
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Import wallet' }).click();
        await expect(
            page.getByRole('heading', { name: 'Import an existing wallet' }),
        ).toBeVisible();
        await scan(page, 'ImportWallet');
    });

    test('home (unlocked)', async ({ page }) => {
        await createWallet(page, { password: 'a11yhomepassword' });
        await scan(page, 'Home');
    });

    test('locked', async ({ page }) => {
        await createWallet(page, { password: 'a11ylockedpassword' });
        await lockWallet(page);
        await scan(page, 'Locked');
    });

    test('send: form stage', async ({ page }) => {
        await createWallet(page, { password: 'a11ysendpassword' });
        await gotoSection(page, 'Send');
        await expect(page.getByLabel('To', { exact: true })).toBeVisible();
        await scan(page, 'Send form');
    });
});
