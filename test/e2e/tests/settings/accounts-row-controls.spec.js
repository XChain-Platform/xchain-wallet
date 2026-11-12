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
    // Switching account lives on the This wallet page, under Settings.
    const thisWallet = page.getByRole('main').getByRole('button', { name: /^This wallet\b/ });
    await expect(thisWallet, 'Settings has no This wallet row').toBeVisible();
    await thisWallet.click();
    const row = page.getByRole('main').getByRole('button', { name: 'Switch account…' });
    await expect(row, 'This wallet has no Switch account row').toBeVisible();
    await row.click();
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
}

async function expectRowControls(main, viewport) {
    // Each account row wraps its select button and its rename control.
    const rows = main.getByRole('button', { name: /^Rename\b/ }).locator('..');

    const count = await rows.count();
    expect(count, `${viewport}: demo mode rendered no account rows`).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
        const buttons = rows.nth(index).locator(':scope > button');
        expect(await buttons.count(), `${viewport}: account row ${index + 1} has no end control`)
            .toBe(2);
        const control = buttons.nth(1);
        await expect(control, `${viewport}: account row ${index + 1} has no accessible name`)
            .toHaveAccessibleName(/\S/);

        const icon = control.locator('svg').first();
        await expect(icon, `${viewport}: account row ${index + 1} has no visible icon`).toBeVisible();
        const box = await icon.boundingBox();
        expect(box, `${viewport}: account row ${index + 1} icon has no layout box`).not.toBeNull();
        expect(box.width, `${viewport}: account row ${index + 1} icon has zero width`).toBeGreaterThan(0);
        expect(box.height, `${viewport}: account row ${index + 1} icon has zero height`).toBeGreaterThan(0);
    }
}

async function expectCompactActions(page, viewport) {
    // Add account and Manage sit directly under the account list (U48), as
    // Add wallet and Manage wallet do on the Wallets screen: in the screen
    // body, never in a pinned footer.
    const main = page.getByRole('main');
    await expect(page.getByRole('button', { name: 'Add account', exact: true }),
        `${viewport}: Add account renders more than once or not at all`).toHaveCount(1);
    await expect(page.locator('footer').getByRole('button', { name: 'Add account', exact: true }),
        `${viewport}: Accounts actions are pinned in a footer`).toHaveCount(0);
    const add = main.getByRole('button', { name: 'Add account', exact: true });
    const manage = main.getByRole('button', { name: 'Manage', exact: true });
    await expect(add, `${viewport}: Add account is not in the screen body`).toBeVisible();
    await expect(manage, `${viewport}: Manage is not in the screen body`).toBeVisible();

    const metrics = await Promise.all([add, manage].map((button) => button.evaluate((element) => {
        const label = element.querySelector('span:last-child');
        const rect = element.getBoundingClientRect();
        if (!label) return { top: rect.top, lineCount: 0, overflows: true };
        const range = document.createRange();
        range.selectNodeContents(label);
        const lineRects = [...range.getClientRects()].filter((line) => line.width > 0 && line.height > 0);
        return {
            top: rect.top,
            lineCount: lineRects.length,
            overflows: element.scrollWidth > element.clientWidth + 1,
        };
    })));

    expect(
        Math.abs(metrics[0].top - metrics[1].top),
        `${viewport}: Add account and Manage do not share one action row`,
    ).toBeLessThanOrEqual(1);
    expect(metrics.map(({ lineCount }) => lineCount), `${viewport}: an action label wraps`)
        .toEqual([1, 1]);
    expect(metrics.some(({ overflows }) => overflows), `${viewport}: an action overflows its button`)
        .toBe(false);

    // Directly under: the action row follows the last account row with only
    // the list gap between them, not a gap down to the bottom of the screen.
    const lastRow = await main.getByRole('button', { name: /^Rename\b/ }).last().locator('..').boundingBox();
    const addBox = await add.boundingBox();
    expect(lastRow && addBox, `${viewport}: no account row or action to measure`).toBeTruthy();
    expect(addBox.y, `${viewport}: the actions sit above the last account row`)
        .toBeGreaterThanOrEqual(lastRow.y + lastRow.height - 1);
    expect(addBox.y - (lastRow.y + lastRow.height), `${viewport}: the actions are not directly under the list`)
        .toBeLessThanOrEqual(32);
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
