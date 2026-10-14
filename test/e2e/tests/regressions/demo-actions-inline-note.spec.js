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
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(title);
    await palette.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

async function expectDemoGuard(page, submitName) {
    const main = page.getByRole('main');
    const note = main.getByRole('status').filter({ hasText: DEMO_NOTE });

    await expect(page.getByRole('status', { name: 'Demo wallet', exact: true })).toHaveCount(0);
    await expect(note).toHaveCount(1);
    await expect(note).toContainText(DEMO_NOTE);
    await expect(note.getByRole('button', { name: /Create (?:a )?real wallet/i })).toBeVisible();
    await expect(main.getByRole('button', { name: submitName, exact: true })).toBeDisabled();
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

test('demo Send uses an inline guard without contacting an encoder', async ({ page }) => {
    test.slow();
    const encoderRequests = await trackEncoderRequests(page);

    await gotoSection(page, 'Send');
    await expect(page.getByRole('form', { name: 'Send', exact: true })).toBeVisible();
    await expectDemoGuard(page, 'Send');

    expect(encoderRequests, 'demo actions must not request an encoder').toEqual([]);
});

test('demo Swap and Create token use an inline guard without contacting an encoder', async ({ page }) => {
    test.slow();
    const encoderRequests = await trackEncoderRequests(page);

    await test.step('Swap', async () => {
        await openPaletteRoute(page, 'Swap');
        await expect(page.getByRole('form', { name: 'Swap tokens', exact: true })).toBeVisible();
        await expectDemoGuard(page, 'Review');
    });

    await test.step('Create token', async () => {
        await openPaletteRoute(page, 'Create a token');
        const main = page.getByRole('main');
        await main.getByRole('button', { name: /^Custom/ }).click();
        await expect(main.getByRole('form', { name: 'Choose token chain' })).toBeVisible();
        await expect(main.getByLabel('Fee paid by', { exact: true }))
            .not.toHaveValue('', { timeout: 15_000 });
        await expectDemoGuard(page, 'Next');
    });

    expect(encoderRequests, 'demo actions must not request an encoder').toEqual([]);
});
