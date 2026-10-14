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

const VIEWPORTS = [
    { name: 'bottom nav', width: 360, height: 800 },
    { name: 'sidebar', width: 1280, height: 800 },
];

async function openPaletteRoute(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(title);
    await palette.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

const ROUTES = [
    { name: 'Home', section: 'Home', visit: (page) => gotoSection(page, 'Home') },
    { name: 'History', section: 'History', visit: (page) => gotoSection(page, 'History') },
    { name: 'Send', section: 'Send', visit: (page) => gotoSection(page, 'Send') },
    { name: 'Receive', section: 'Receive', visit: (page) => gotoSection(page, 'Receive') },
    { name: 'Swap', section: 'DEX', visit: (page) => openPaletteRoute(page, 'Swap') },
    { name: 'Contacts', section: 'Contacts', visit: (page) => gotoSection(page, 'Contacts') },
    { name: 'Addresses', section: 'Addresses', visit: (page) => openPaletteRoute(page, 'Addresses') },
    { name: 'Create token', section: 'Create token', visit: (page) => openPaletteRoute(page, 'Create a token') },
    { name: 'Markets', section: 'DEX', visit: (page) => openPaletteRoute(page, 'Open DEX') },
    { name: 'Settings', section: 'Settings', visit: (page) => gotoSection(page, 'Settings') },
    {
        name: 'Settings Accounts',
        section: 'Accounts',
        visit: async (page) => {
            await gotoSection(page, 'Settings');
            await page.getByRole('main')
                .getByRole('button', { name: /^Accounts & addresses\b/ })
                .click();
        },
    },
];

async function expectCurrentSection(page, section) {
    const bottomNav = page.getByRole('navigation', { name: 'Bottom navigation' });
    if (await bottomNav.count() > 0) {
        await bottomNav.getByRole('button', { name: 'More', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'More', exact: true })).toBeVisible();
    }

    const current = page.locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAccessibleName(section);

    if (await bottomNav.count() > 0) {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: 'More', exact: true })).toBeHidden();
    }
}

test('every route highlights exactly its mapped navigation section', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await expect(page.getByRole('navigation', {
            name: viewport.width < 640 ? 'Bottom navigation' : 'Primary navigation',
        })).toBeVisible();

        for (const route of ROUTES) {
            await test.step(`${viewport.name} / ${route.name}`, async () => {
                await route.visit(page);
                await expectCurrentSection(page, route.section);
            });
        }
    }
});
