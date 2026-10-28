// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Rendered gate for the Automatic Donation System notice. The notice informs
// and does not ask: one Continue button, no decline or skip control, no
// field or switch, no per-chain amount, and Continue leaves the ads setting
// untouched so the default (on) still holds on Home.
//
// The static smoke reads source; this spec reads the rendered screen after a
// fresh create and after a mnemonic import, at each shell's viewport:
// web narrow and wide, popup size, desktop and phone.

import {
    DEFAULT_PASSWORD,
    completeRecoveryPhraseChallenge,
    readRecoveryPhrase,
    dismissIntroCarousel,
    expect,
    nav,
    openSettings,
    test,
    unlockedAnyScreen,
} from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

// The recovery phrase shows during create: no screenshot, trace or video.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

const KNOWN_BIP39 =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const SHELLS = [
    { shell: 'W', width: 360, height: 800 },
    { shell: 'W', width: 1440, height: 900 },
    { shell: 'X', width: 360, height: 600 },
    { shell: 'D', width: 1280, height: 800 },
    { shell: 'M', width: 412, height: 869 },
];

const DECLINE_COPY = /decline|skip|not now|no thanks|maybe later|turn off|disable|opt out|cancel/i;
const AMOUNT_COPY = /\b(sats?|satoshis?|LTC|DOGE|BTC|XCP|USD)\b|[$€£]\s?\d|\d[\d,.]*\s?%?\s?(sats?|LTC|DOGE|BTC)\b|\d,\d{3}/i;

const noticeHeading = (page) =>
    page.getByRole('heading', { name: 'Automatic Donation System', exact: true });

async function assertNotice(page) {
    await expect(noticeHeading(page)).toBeVisible({ timeout: kdfStepTimeout() });
    const form = page.getByRole('form', { name: 'Automatic Donation System' });
    await expect(form, 'the notice is a form-page surface').toBeVisible();

    // The header Back is disabled on the notice after create and after import.
    const back = page.getByRole('button', { name: /^Back to (previous step|wallet setup)$/ });
    await expect(back, 'the notice header carries Back').toHaveCount(1);
    await expect(back, 'the notice header Back is disabled').toBeDisabled();

    // Exactly one visible button on the whole screen, named Continue.
    const buttons = page.getByRole('button');
    const visible = [];
    for (let i = 0; i < await buttons.count(); i += 1) {
        const button = buttons.nth(i);
        // The header Back is inert on this screen; an enabled one is a second way out.
        if (await button.isVisible() && await button.isEnabled()) visible.push((await button.innerText()).trim() || await button.getAttribute('aria-label'));
    }
    expect(visible, 'enabled visible buttons on the notice').toEqual(['Continue']);
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();

    // No decline or skip control of any kind, and no field, checkbox or switch.
    await expect(page.getByRole('button', { name: DECLINE_COPY })).toHaveCount(0);
    await expect(page.getByRole('link', { name: DECLINE_COPY })).toHaveCount(0);
    const controls = page.locator(
        'input, select, textarea, [role="checkbox"], [role="switch"], [role="radio"], '
        + '[role="textbox"], [role="combobox"], [role="slider"]',
    );
    expect(await controls.count(), 'form controls on the notice').toBe(0);

    // No per-chain amount or currency figure.
    const text = await form.innerText();
    expect(text, 'notice text carries an amount').not.toMatch(AMOUNT_COPY);

    // A notice: the title, a subtitle, a bullet list of statements, one action.
    expect(await form.locator('ul > li').count(), 'statement bullets').toBe(3);
    expect(await form.getByRole('button').count(), 'actions inside the notice').toBe(1);
}

// The create walk up to the notice; the shared createWallet helper answers it.
async function createToNotice(page) {
    await page.getByRole('button', { name: 'Create new wallet' }).click();
    await page.getByLabel('Password', { exact: true }).fill(DEFAULT_PASSWORD);
    await page.getByLabel(/^Confirm( password)?$/).fill(DEFAULT_PASSWORD);
    const next = page.getByRole('button', { name: 'Next' });
    await expect(next).toBeEnabled({ timeout: 30_000 });
    await next.click();
    const words = await readRecoveryPhrase(page);
    await page.getByLabel(/written down|saved my recovery phrase/i).check();
    await page.getByRole('button', { name: 'Verify recovery phrase' }).click();
    await completeRecoveryPhraseChallenge(page, words);
    await page.getByRole('button', { name: 'Create wallet' }).click();
}

async function continueToHome(page) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(unlockedAnyScreen(page)).toBeVisible({ timeout: kdfStepTimeout() });
    // The ads setting is not written: the default (on) still holds in Settings.
    await openSettings(page);
    await page.getByRole('button', { name: /^Automatic donation system/ }).click();
    const toggle = page.getByRole('switch', { name: 'Turn on Automatic Donation System', exact: true });
    await expect(toggle).toBeVisible();
    await expect(toggle, 'Continue leaves the default on').toBeChecked();
    await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
    if (await nav(page).count() === 0) {
        await page.getByRole('button', { name: 'Back', exact: true }).click();
    }
    await expect(unlockedAnyScreen(page)).toBeVisible();
}

for (const { shell, width, height } of SHELLS) {
    test.describe(`${shell} ${width}x${height}`, () => {
        test.use({ viewport: { width, height } });

        test(`${shell} ${width}x${height}: notice after a fresh create`, async ({ page }) => {
            await page.goto('/');
            await dismissIntroCarousel(page);
            // Walk create up to the notice without answering it.
            await createToNotice(page);
            await assertNotice(page);
            await continueToHome(page);
        });

        test(`${shell} ${width}x${height}: notice after a mnemonic import`, async ({ page }) => {
            await page.goto('/');
            await dismissIntroCarousel(page);
            await page.getByRole('button', { name: 'Import wallet' }).click();
            await page.getByLabel('Recovery phrase', { exact: true }).fill(KNOWN_BIP39);
            await page.getByLabel('Wallet name').fill('Notice Import');
            await page.getByLabel('Password', { exact: true }).fill(DEFAULT_PASSWORD);
            await page.getByLabel(/^Confirm( password)?$/).fill(DEFAULT_PASSWORD);
            await page.getByRole('button', { name: 'Import' }).click();
            await assertNotice(page);
            await continueToHome(page);
        });
    });
}
