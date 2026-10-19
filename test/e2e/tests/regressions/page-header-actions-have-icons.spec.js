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

// The page header holds only the title and Back on these screens: their
// create or refresh action sits in the content, in the ListPage actions row,
// or in the EmptyState when the list is empty (the demo wallet has no lists).
const CONTENT_ACTION_ROUTES = [
    { paletteName: 'Contacts', heading: 'Contacts', actionName: 'Add contact' },
    { paletteName: 'My lists', heading: 'My lists', actionName: 'Create list' },
    { paletteName: 'Dispensers', heading: 'My dispensers', actionName: 'Create dispenser' },
    { paletteName: 'Messaging', heading: 'Messaging', actionName: 'New conversation' },
    { paletteName: 'History', heading: 'History', actionName: 'Refresh history' },
    { paletteName: 'Addresses', heading: 'Addresses', actionName: 'Add or import address' },
    { paletteName: 'Staking', heading: 'Staking', actionName: 'New stake' },
    // An empty list offers Create from its empty state and a list with rows offers New from the actions row.
    { paletteName: 'My orders', heading: 'My orders', actionName: /^(Create an order|New order)$/ },
    { paletteName: 'My swaps', heading: 'My swaps', actionName: /^(Create a swap|New swap)$/ },
    // The demo wallet owns no tokens, so the empty state offers Issue token; a list with rows offers Issue new token.
    { paletteName: 'My tokens', heading: 'My tokens', actionName: /^(Issue token|Issue new token)$/ },
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

async function expectContentActionIcon(page, route, viewport) {
    const heading = page.getByRole('heading', {
        level: 1,
        name: route.heading,
        exact: true,
    });
    await expect(heading).toBeVisible();

    const pageHeader = heading.locator('..').locator('..');
    await expect(pageHeader.locator(':scope > span:last-child button')).toHaveCount(0);

    const action = page.getByRole('main').getByRole('button', { name: route.actionName, exact: true });
    await expect(action).toHaveCount(1);
    await expect(action).toBeVisible();

    const iconSizes = await action.locator('svg').evaluateAll((icons) => icons.map((icon) => {
        const box = icon.getBoundingClientRect();
        return { width: box.width, height: box.height };
    }));
    expect(
        iconSizes.some(({ width, height }) => width >= 14 && height >= 14),
        `${viewport.name} / ${route.heading}: content action needs an SVG at least 14px square`,
    ).toBe(true);
}

test('content actions have visible icons and accessible names and the page header holds none', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        for (const route of CONTENT_ACTION_ROUTES) {
            await test.step(`${viewport.name} / ${route.heading} (content action)`, async () => {
                await openRoute(page, route);
                await expectContentActionIcon(page, route, viewport);
            });
        }
    }
});
