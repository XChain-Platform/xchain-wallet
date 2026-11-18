// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    openSettings,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { width: 360, height: 800 },
    { width: 1280, height: 800 },
];

async function openAccounts(page) {
    await openSettings(page);
    // Accounts live under Settings, Wallets group, My Accounts.
    const main = page.getByRole('main');
    const group = main.getByRole('button', { name: /^Wallets\b/ });
    await expect(group, 'Settings has no Wallets row').toBeVisible();
    await group.click();
    const accounts = main.getByRole('button', { name: /^My Accounts\b/ });
    await expect(accounts, 'the Wallets group has no My Accounts row').toBeVisible();
    await accounts.click();
    await expect(page.getByRole('heading', { name: 'My Accounts', exact: true, level: 1 })).toBeVisible();
}

// Each account row is one button with a name and an icon; rename and the other
// actions live on Account Details.
async function expectRowControls(main, viewport) {
    const rows = main.getByRole('list', { name: 'My Accounts' }).getByRole('button');

    const count = await rows.count();
    expect(count, `${viewport}: demo mode rendered no account rows`).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
        const control = rows.nth(index);
        await expect(control, `${viewport}: account row ${index + 1} has no accessible name`)
            .toHaveAccessibleName(/\S/);

        const icon = control.locator('svg, img').first();
        await expect(icon, `${viewport}: account row ${index + 1} has no visible icon`).toBeVisible();
        const box = await icon.boundingBox();
        expect(box, `${viewport}: account row ${index + 1} icon has no layout box`).not.toBeNull();
        expect(box.width, `${viewport}: account row ${index + 1} icon has zero width`).toBeGreaterThan(0);
        expect(box.height, `${viewport}: account row ${index + 1} icon has zero height`).toBeGreaterThan(0);
    }
}

// Add Account is the title bar's plus (G95): once, never in a pinned footer.
async function expectCompactActions(page, viewport) {
    await expect(page.getByRole('button', { name: 'Add Account', exact: true }),
        `${viewport}: Add account renders more than once or not at all`).toHaveCount(1);
    await expect(page.locator('footer').getByRole('button', { name: 'Add Account', exact: true }),
        `${viewport}: Accounts actions are pinned in a footer`).toHaveCount(0);
    const add = page.getByRole('banner').getByRole('button', { name: 'Add Account', exact: true });
    await expect(add, `${viewport}: Add account is not in the title bar`).toBeVisible();
    const box = await add.boundingBox();
    expect(box, `${viewport}: Add account has no layout box`).toBeTruthy();
    expect(box.x + box.width, `${viewport}: Add account crosses the viewport`)
        .toBeLessThanOrEqual(page.viewportSize().width + 1);
}

test('account row controls and actions fit at phone and desktop widths', async ({ page }) => {
    test.slow();
    await page.setViewportSize(VIEWPORTS[0]);
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        const label = `${viewport.width}x${viewport.height}`;
        await test.step(label, async () => {
            await page.setViewportSize(viewport);
            await openAccounts(page);
            const main = page.getByRole('main');
            await expectRowControls(main, label);
            await expectCompactActions(page, label);
        });
    }
});
