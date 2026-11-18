// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    openWalletPicker,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'phone', width: 360, height: 800 },
    { name: 'desktop', width: 1280, height: 800 },
];

const CONTENT_ACTION_ROUTES = [
    // The edit forms, opened from each details page, submit with Save Changes.
    { open: 'wallet-rename', heading: 'Edit Wallet', actionName: 'Save Changes' },
    { open: 'account-rename', heading: 'Edit Account', actionName: 'Save Changes' },
];

// List pages (G95): the filter icon, then the create plus at the far right.
const HEADER_ACTION_ROUTES = [
    { paletteName: 'Dispensers', heading: 'Dispensers', actionName: 'New dispenser' },
    { paletteName: 'My tokens', heading: 'My tokens', actionName: 'Create token' },
    { paletteName: 'Contacts', heading: 'Contacts', actionName: 'Add contact' },
    // On wide layouts a thread is open and New message sits in its More menu.
    { paletteName: 'Messaging', heading: 'Messaging', actionName: /^(New message|More)$/i },
    { paletteName: 'Addresses', heading: 'Addresses', actionName: 'Add or import address' },
    { paletteName: 'Staking', heading: 'Staking', actionName: 'New Stake' },
    // The empty state is text only; the title bar's plus creates (MyOrdersView, MySwapsView).
    { paletteName: 'My orders', heading: 'My orders', actionName: 'New order' },
    { paletteName: 'My swaps', heading: 'My swaps', actionName: 'New swap' },
    { paletteName: 'Lists', heading: 'My Lists', actionName: 'Create list' },
    // History: the filter, then the ⋯ menu (Export and Refresh) at the far right.
    { paletteName: 'History', heading: 'History', actionName: 'More actions' },
];

// Titles and labels are Title Case (G50); match the whole name in any case.
function whole(name) {
    if (typeof name !== 'string') return name;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, (ch) => '\\' + ch);
    return new RegExp('^' + escaped + '$', 'i');
}

async function openPaletteRoute(page, route) {
    // Shortcuts are ignored while a text field has focus (a rename form
    // focuses its name field), so start from the page.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(route.paletteName);
    await palette.getByRole('option', {
        name: new RegExp(`^${route.paletteName}\\b`),
    }).first().click();
    await expect(palette).toBeHidden();
}

async function openRoute(page, route) {
    if (route.open === 'wallet-rename') {
        await openWalletPicker(page);
        await expect(page.getByRole('heading', { level: 1, name: /^(My )?Wallets$/ })).toBeVisible();
        // A wallet row opens that wallet's details page.
        await page.getByRole('main').getByRole('list', { name: /Wallets$/ }).getByRole('button').first().click();
        await expect(page.getByRole('heading', { level: 1, name: /^Wallet details$/i })).toBeVisible();
        await page.getByRole('main').getByRole('button', { name: /^Edit wallet\b/ }).click();
        return;
    }

    if (route.open === 'account-rename') {
        await openPaletteRoute(page, { paletteName: 'Settings' });
        // Settings reopens on the sub-page the wallet rename left open.
        const landing = page.getByRole('heading', { level: 1, name: 'Settings', exact: true });
        for (let i = 0; i < 4 && !(await landing.isVisible().catch(() => false)); i += 1) {
            await page.getByRole('banner').getByRole('button', { name: /^Back\b/ }).first().click();
        }
        await expect(landing).toBeVisible();
        // Accounts live on the Wallets group page, as My Accounts; an account
        // row opens its details, which offer Edit account.
        await page.getByRole('main').getByRole('button', { name: /^Wallets\b/ }).click();
        await page.getByRole('main').getByRole('button', { name: /^My Accounts\b/ }).click();
        await expect(page.getByRole('heading', { level: 1, name: /^(My )?Accounts$/ })).toBeVisible();
        await page.getByRole('main').getByRole('list').getByRole('button').first().click();
        await page.getByRole('main').getByRole('button', { name: /^Edit account\b/ }).click();
        return;
    }

    await openPaletteRoute(page, route);
}

async function expectContentActionIcon(page, route, viewport) {
    const heading = page.getByRole('heading', {
        level: 1,
        name: whole(route.heading),
    });
    await expect(heading).toBeVisible();

    const pageHeader = heading.locator('..').locator('..');
    await expect(pageHeader.locator(':scope > span:last-child button')).toHaveCount(0);

    const action = page.getByRole('main').getByRole('button', { name: whole(route.actionName) });
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

async function expectHeaderActionIcon(page, route, viewport) {
    const heading = page.getByRole('heading', {
        level: 1,
        name: whole(route.heading),
    });
    await expect(heading).toBeVisible();

    const pageHeader = heading.locator('..').locator('..');
    // The plus sits at the far right; a filter icon may come before it.
    const trailingAction = pageHeader.locator(':scope > span:last-child button');
    await expect(trailingAction.last()).toHaveAccessibleName(whole(route.actionName));

    const action = pageHeader.getByRole('button', { name: whole(route.actionName) });
    await expect(action).toHaveCount(1);
    await expect(action).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', {
        name: 'Issue new token',
        exact: true,
    })).toHaveCount(0);

    const iconSizes = await action.locator('svg').evaluateAll((icons) => icons.map((icon) => {
        const box = icon.getBoundingClientRect();
        return { width: box.width, height: box.height };
    }));
    expect(
        iconSizes.some(({ width, height }) => width >= 14 && height >= 14),
        `${viewport.name} / ${route.heading}: header action needs an SVG at least 14px square`,
    ).toBe(true);
}

test('page actions have visible icons and accessible names in their ruled locations', async ({ page }) => {
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

        for (const route of HEADER_ACTION_ROUTES) {
            await test.step(`${viewport.name} / ${route.heading} (header action)`, async () => {
                await openRoute(page, route);
                await expectHeaderActionIcon(page, route, viewport);
            });
        }
    }
});
