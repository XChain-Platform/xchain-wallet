// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    createWallet,
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { switchToRegtest } from '../../fixtures/regtest.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const PASSWORD = 'demo-prices-password';
const FIAT_VALUE = /\p{Sc}\s?\d/u;
const VIEWPORTS = [
    { width: 360, height: 800 },
    { width: 1280, height: 800 },
];

function coinRows(page) {
    return page.getByRole('tabpanel').locator('[data-balance-key]');
}

test('demo Home prices its hero and coin rows and renders its chart', async ({ page }) => {
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        await test.step(`${viewport.width}x${viewport.height}`, async () => {
            await page.setViewportSize(viewport);

            await expect(unlockedShell(page)).toContainText(FIAT_VALUE);

            const rows = coinRows(page);
            await expect.poll(() => rows.count()).toBeGreaterThan(1);
            for (let index = 0; index < await rows.count(); index += 1) {
                await expect(rows.nth(index)).toContainText(FIAT_VALUE);
            }

            await expect(page.getByRole('img', { name: /^Portfolio performance chart\./ }))
                .toBeVisible();
        });
    }
});

test('ordinary regtest Home does not assign fiat value to test coins', async ({ page }) => {
    await createWallet(page, { password: PASSWORD, name: 'Unpriced regtest wallet' });
    await switchToRegtest(page, PASSWORD);
    await gotoSection(page, 'Home');

    for (const viewport of VIEWPORTS) {
        await test.step(`${viewport.width}x${viewport.height}`, async () => {
            await page.setViewportSize(viewport);

            await expect(unlockedShell(page)).toContainText('Test coins have no value');
            await expect(page.getByRole('main')).not.toContainText(FIAT_VALUE);
            await expect(page.getByRole('region', { name: 'Portfolio performance' }))
                .toHaveCount(0);
        });
    }
});
