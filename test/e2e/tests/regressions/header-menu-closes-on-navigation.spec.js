// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const CASES = [
    {
        name: '402 by 874 touch',
        viewport: { width: 402, height: 874 },
        hasTouch: true,
        destination: 'wallets',
    },
    {
        name: '1280 by 800 desktop',
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
        destination: 'settings',
    },
];

async function enterDemoWallet(page) {
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Try in demo mode' }).click();
    await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });
}

async function activate(locator, hasTouch) {
    if (hasTouch) await locator.tap();
    else await locator.click();
}

for (const scenario of CASES) {
    test.describe(scenario.name, () => {
        test.use({ viewport: scenario.viewport, hasTouch: scenario.hasTouch });

        test('closes header overlays when dismissed or navigating', async ({ page }) => {
            await enterDemoWallet(page);

            const header = page.getByRole('region', { name: 'App header' });
            const menuButton = header.getByRole('button', { name: 'Open menu' });
            const menu = page.getByRole('menu', { name: 'Header actions' });
            const settingsPanel = page.getByRole('dialog', { name: 'Wallet settings' });

            await activate(menuButton, scenario.hasTouch);
            await expect(menu).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(menu).toBeHidden();
            await expect(menuButton).toBeFocused();
            await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

            await activate(menuButton, scenario.hasTouch);
            await activate(menu.getByRole('menuitem', { name: 'Settings', exact: true }), scenario.hasTouch);
            await expect(settingsPanel).toBeVisible();

            if (scenario.destination === 'wallets') {
                await activate(settingsPanel.getByRole('button', { name: /Demo Wallet/ }), scenario.hasTouch);
                await expect(page.getByRole('main').getByRole('heading', { name: 'Wallets' })).toBeVisible();
            } else {
                await activate(settingsPanel.getByRole('button', { name: 'All settings' }), scenario.hasTouch);
                await expect(page.getByRole('main').getByRole('heading', { name: 'Settings' })).toBeVisible();
            }

            await expect(menu).toBeHidden();
            await expect(settingsPanel).toBeHidden();
            await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
        });
    });
}
