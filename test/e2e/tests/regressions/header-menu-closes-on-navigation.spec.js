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
            const menu = page.getByRole('dialog', { name: 'Wallet menu' });

            await activate(menuButton, scenario.hasTouch);
            await expect(menu).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(menu).toBeHidden();
            await expect(menuButton).toBeFocused();
            await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

            await activate(menuButton, scenario.hasTouch);
            await activate(menu.locator('[data-wallet-menu-row="settings"]'), scenario.hasTouch);
            await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

            if (scenario.destination === 'wallets') {
                const main = page.getByRole('main');
                await activate(main.getByRole('button', { name: /^This wallet\b/ }), scenario.hasTouch);
                await activate(main.getByRole('button', { name: /^Open wallets/ }), scenario.hasTouch);
                await expect(page.getByRole('heading', { name: 'Wallets', level: 1 })).toBeVisible();
            }

            await expect(menu).toBeHidden();
            await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
        });
    });
}
