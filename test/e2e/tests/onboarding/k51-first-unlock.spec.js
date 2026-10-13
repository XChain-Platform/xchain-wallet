// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    acknowledgeDonationNotice,
    completeRecoveryPhraseChallenge,
    dismissIntroCarousel,
    expect,
    readRecoveryPhrase,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { measureInPage } from '../../layout/sweep.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const PASSWORD = 'k51-first-unlock-1234';
const WALLET_NAME = 'K51 Wallet';
const KDF_STEP_MS = kdfStepTimeout();

async function expectActionReachable(page, label, action) {
    await action.scrollIntoViewIfNeeded();
    await expect(action, `${label}: primary action is not visible`).toBeVisible();

    const box = await action.boundingBox();
    const viewport = page.viewportSize();
    expect(box, `${label}: primary action has no rendered box`).not.toBeNull();
    expect(box.x, `${label}: primary action starts outside the viewport`)
        .toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${label}: primary action ends outside the viewport`)
        .toBeLessThanOrEqual(viewport.width + 1);

    const report = await page.evaluate(measureInPage);
    expect(report.pageScrollX, `${label}: the document scrolls horizontally`).toBe(0);
    expect(report.xScrollers, `${label}: nested content scrolls horizontally`).toEqual([]);
    expect(report.offscreen, `${label}: content paints outside the viewport`).toEqual([]);
    await expect.poll(() => page.evaluate(() => window.scrollX), {
        message: `${label}: reaching the primary action scrolls sideways`,
    }).toBe(0);
}

test.describe('LG K51 first wallet unlock', { tag: '@lg-k51' }, () => {
    test('creates, checks the recovery phrase, and unlocks the wallet', async ({ page }) => {
        const consoleErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push(String(error)));

        expect(test.info().project.name).toBe('lg-k51');
        expect(page.viewportSize()).toEqual({ width: 412, height: 869 });
        const device = await page.evaluate(() => ({
            userAgent: navigator.userAgent,
            maxTouchPoints: navigator.maxTouchPoints,
        }));
        expect(device.userAgent).toContain('Chrome/102.');
        expect(device.maxTouchPoints).toBeGreaterThan(0);

        await page.goto('/');
        await dismissIntroCarousel(page);
        const create = page.getByRole('button', { name: 'Create new wallet' });
        await expectActionReachable(page, 'welcome', create);
        await create.click();

        await page.getByLabel('Wallet name').fill(WALLET_NAME);
        await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
        await page.getByLabel('Confirm password').fill(PASSWORD);
        await expect(page.getByLabel('Wallet name')).toHaveValue(WALLET_NAME);
        await expect(page.getByRole('radio', { name: /^12 words/ })).toBeChecked();
        const next = page.getByRole('button', { name: 'Next' });
        await expectActionReachable(page, 'wallet details', next);
        await next.click();

        const words = await readRecoveryPhrase(page);
        expect(words).toHaveLength(12);
        const backupCheck = page.getByLabel(/saved my recovery phrase/i);
        await expect(backupCheck).not.toBeChecked();
        await backupCheck.check();
        await expect(backupCheck).toBeChecked();
        const verify = page.getByRole('button', { name: 'Verify recovery phrase' });
        await expectActionReachable(page, 'recovery phrase backup', verify);
        await verify.click();

        await completeRecoveryPhraseChallenge(page, words);
        const review = page.getByRole('textbox', { name: /^Word \d+$/ });
        await expect(review).toHaveCount(3);
        for (let position = 1; position <= words.length; position += 1) {
            const input = page.getByRole('textbox', { name: `Word ${position}`, exact: true });
            if (await input.count() === 0) continue;
            await expect(input, `review word ${position} does not match the recovery phrase`)
                .toHaveValue(words[position - 1]);
        }
        const finish = page.getByRole('button', { name: 'Create wallet' });
        await expectActionReachable(page, 'recovery phrase review', finish);
        await finish.click();

        const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
        await expect(continueButton).toBeVisible({ timeout: KDF_STEP_MS });
        await expectActionReachable(page, 'donation notice', continueButton);
        await acknowledgeDonationNotice(page, 'on');
        await expect(unlockedShell(page)).toBeVisible({ timeout: KDF_STEP_MS });

        const bottomNav = page.getByRole('navigation', { name: 'Bottom navigation' });
        await bottomNav.getByRole('button', { name: 'More', exact: true }).click();
        const lock = page.getByRole('dialog', { name: 'More' })
            .getByRole('button', { name: 'Lock wallet' });
        await expectActionReachable(page, 'mobile navigation', lock);
        await lock.click();

        await expect(page.getByRole('heading', { name: WALLET_NAME })).toBeVisible();
        await page.getByLabel('Password').fill(PASSWORD);
        const unlock = page.getByRole('button', { name: 'Unlock Wallet' });
        await expectActionReachable(page, 'first unlock', unlock);
        await unlock.click();
        await expect(unlockedShell(page)).toBeVisible({ timeout: KDF_STEP_MS });
        expect(consoleErrors).toEqual([]);
    });
});
