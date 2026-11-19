// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const DEMO_NOTE = /Demo wallets (?:cannot|can't|can’t) move funds/i;

function isEncoderRequest(url) {
    const endpoint = new URL(url);
    return /(^|\.)encoder(?:\.|$)/i.test(endpoint.hostname)
        || ['3023', '3123', '3223'].includes(endpoint.port);
}

async function openPaletteRoute(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(title);
    await palette.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

// No demo notice shows before the user acts (operator ruling 2026-11-13);
// submitting the form is refused, and the refusal is the only demo message.
async function expectDemoGuard(page, formName) {
    const main = page.getByRole('main');

    await expect(page.getByRole('status', { name: 'Demo wallet', exact: true })).toHaveCount(0);
    await expect(main.getByText(DEMO_NOTE)).toHaveCount(0);
    await expect(main.getByRole('button', { name: /Create (?:a )?real wallet/i })).toHaveCount(0);

    // requestSubmit stands in for the press (or Enter) whether or not the
    // empty form's own validation has its action enabled yet.
    await main.getByRole('form', { name: formName, exact: true }).evaluate((form) => form.requestSubmit());
    const refusal = main.getByTestId('demo-guard-refusal');
    await expect(refusal).toContainText(DEMO_NOTE);
    await expect(refusal.getByRole('button', { name: /Create (?:a )?real wallet/i })).toBeVisible();
}

async function trackEncoderRequests(page) {
    const encoderRequests = [];
    page.on('request', (request) => {
        if (isEncoderRequest(request.url())) encoderRequests.push(request.url());
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    return encoderRequests;
}

test('demo Send shows no notice and refuses without contacting an encoder', async ({ page }) => {
    test.slow();
    const encoderRequests = await trackEncoderRequests(page);

    await gotoSection(page, 'Send');
    await expect(page.getByRole('form', { name: 'Send', exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await expectDemoGuard(page, 'Send');

    expect(encoderRequests, 'demo actions must not request an encoder').toEqual([]);
});

test('demo Swap and Create token show no notice and refuse without contacting an encoder', async ({ page }) => {
    test.slow();
    const encoderRequests = await trackEncoderRequests(page);

    await test.step('Swap', async () => {
        await openPaletteRoute(page, 'Swap');
        await expect(page.getByRole('form', { name: 'Swap tokens', exact: true })).toBeVisible();
        await expectDemoGuard(page, 'Swap tokens');
    });

    await test.step('Create token', async () => {
        await openPaletteRoute(page, 'Create a token');
        const main = page.getByRole('main');
        // Create a token opens the one Issue Token form, whose submit always
        // reads Issue Token (walk ruling: no Reserve ticker label).
        await expect(main.getByRole('form', { name: 'Issue Token', exact: true })).toBeVisible();
        await expectDemoGuard(page, 'Issue Token');
    });

    expect(encoderRequests, 'demo actions must not request an encoder').toEqual([]);
});
