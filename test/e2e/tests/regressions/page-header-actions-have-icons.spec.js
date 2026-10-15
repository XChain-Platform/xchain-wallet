// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'phone', width: 360, height: 800 },
    { name: 'desktop', width: 1280, height: 800 },
];

const ROUTES = [
    { paletteName: 'Addresses', heading: 'Addresses', actionName: 'Add or import address' },
    { paletteName: 'Contacts', heading: 'Contacts', actionName: 'Add contact' },
    { paletteName: 'My lists', heading: 'My lists', actionName: 'Create list' },
    { paletteName: 'Dispensers', heading: 'My dispensers', actionName: 'Create dispenser' },
    { paletteName: 'Staking', heading: 'Staking', actionName: 'New stake' },
    { paletteName: 'Messaging', heading: 'Messaging', actionName: 'New conversation' },
    { paletteName: 'History', heading: 'History', actionName: 'Refresh history' },
    { paletteName: 'My orders', heading: 'My orders', actionName: 'New order' },
    { paletteName: 'My swaps', heading: 'My swaps', actionName: 'New swap' },
    { paletteName: 'My tokens', heading: 'My tokens', actionName: 'Issue new token' },
    { paletteName: 'Payments due', heading: 'Payments due', actionName: 'Refresh payments' },
    { open: 'wallet-rename', heading: 'Rename wallet', actionName: 'Save' },
    { open: 'account-rename', heading: 'Rename account', actionName: 'Save' },
];

async function openPaletteRoute(page, route) {
    // Shortcuts are ignored while a text field has focus (a rename form
    // focuses its name field), so start from the page.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(route.paletteName);
    await palette.getByRole('option', {
        name: new RegExp(`^${route.paletteName}\\b`),
    }).first().click();
    await expect(palette).toBeHidden();
}

async function openRoute(page, route) {
    if (route.open === 'wallet-rename') {
        await openPaletteRoute(page, { paletteName: 'Switch wallet' });
        await expect(page.getByRole('heading', { level: 1, name: 'Wallets' })).toBeVisible();
        await page.getByRole('button', { name: 'Manage wallet', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Wallet details' })).toBeVisible();
        await page.getByRole('main').getByRole('button', { name: 'Rename wallet' }).click();
        return;
    }

    if (route.open === 'account-rename') {
        await openPaletteRoute(page, { paletteName: 'Settings' });
        await page.getByRole('main').getByRole('button', {
            name: /^Accounts & addresses\b/,
        }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
        await page.getByRole('main').getByRole('button', { name: /^Rename\b/ }).first().click();
        return;
    }

    await openPaletteRoute(page, route);
}

async function expectHeaderActionIcon(page, route, viewport) {
    const heading = page.getByRole('heading', {
        level: 1,
        name: route.heading,
        exact: true,
    });
    await expect(heading).toBeVisible();

    const pageHeader = heading.locator('..').locator('..');
    const actions = pageHeader.locator(':scope > span:last-child button');
    await expect(actions).toHaveCount(1);

    const action = actions.first();
    await expect(action).toBeVisible();
    await expect(action).toHaveAccessibleName(route.actionName);

    const iconSizes = await action.locator('svg').evaluateAll((icons) => icons.map((icon) => {
        const box = icon.getBoundingClientRect();
        return { width: box.width, height: box.height };
    }));
    expect(
        iconSizes.some(({ width, height }) => width >= 14 && height >= 14),
        `${viewport.name} / ${route.heading}: header action needs an SVG at least 14px square`,
    ).toBe(true);
}

test('page header actions have visible icons and accessible names', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        for (const route of ROUTES) {
            await test.step(`${viewport.name} / ${route.heading}`, async () => {
                await openRoute(page, route);
                await expectHeaderActionIcon(page, route, viewport);
            });
        }
    }
});
