// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    createWallet,
    expect,
    gotoSection,
    test,
} from '../../fixtures/wallet.js';

const VIEWPORTS = [360, 1280];

async function openPaletteRoute(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(title);
    await palette.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

// The palette titles: Airdrop, Mint supply, Sign a message. Link cross-chain
// actions has no palette command, so it opens from All actions.
const FORM_ROUTES = [
    { name: 'send', open: (page) => gotoSection(page, 'Send') },
    { name: 'airdrop', open: (page) => openPaletteRoute(page, 'Airdrop') },
    { name: 'mint', open: (page) => openPaletteRoute(page, 'Mint') },
    {
        name: 'link',
        open: async (page) => {
            await openPaletteRoute(page, 'All actions');
            await page.getByRole('main').getByRole('button', { name: /^Link cross-chain actions/ }).first().click();
        },
    },
    { name: 'sign-message', open: (page) => openPaletteRoute(page, 'Sign a message') },
    { name: 'publish-file', open: (page) => openPaletteRoute(page, 'Publish file') },
    { name: 'multisig-create', open: (page) => openPaletteRoute(page, 'Multisig') },
];

async function visibleShellBounds(page) {
    return page.evaluate(() => {
        const headerControl = document.querySelector('[data-header-control]');
        const appHeader = headerControl?.closest('[role="region"]')
            || document.querySelector('[role="region"][aria-label="App header"]');
        const bottomTab = document.querySelector('[data-bottom-tab]');
        const bottomNav = bottomTab?.closest('nav')
            || document.querySelector('nav[aria-label="Bottom navigation"]');
        return {
            headerBottom: appHeader?.getBoundingClientRect().bottom || 0,
            bottomNavTop: bottomNav?.getBoundingClientRect().top || window.innerHeight,
            viewportWidth: document.documentElement.clientWidth || window.innerWidth,
        };
    });
}

async function expectEveryHelpPopupOnScreen(page, routeName, width) {
    const main = page.getByRole('main');
    // Tips inside a collapsed section (Send's Change address) are not on screen to open.
    const triggers = main.locator('button[aria-describedby][aria-expanded]').filter({ visible: true });
    // count() does not wait, so let the form render its first help tip before counting.
    await expect(triggers.first(), `${routeName} at ${width}px shows no label help trigger`).toBeVisible();
    const count = await triggers.count();
    expect(count, `${routeName} at ${width}px has no label help triggers`).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
        const trigger = triggers.nth(index);
        await trigger.scrollIntoViewIfNeeded();
        const name = await trigger.getAttribute('aria-label') || `help trigger ${index + 1}`;
        const tooltipId = await trigger.getAttribute('aria-describedby');
        expect(tooltipId, `${routeName} at ${width}px: ${name} has no tooltip reference`).toBeTruthy();
        const tooltip = page.locator(`[id="${tooltipId}"]`);

        await trigger.click();
        await expect(tooltip, `${routeName} at ${width}px: ${name} did not open`).toBeVisible();

        const [box, bounds] = await Promise.all([
            tooltip.boundingBox(),
            visibleShellBounds(page),
        ]);
        expect(box, `${routeName} at ${width}px: ${name} has no layout box`).not.toBeNull();
        expect(box.x, `${routeName} at ${width}px: ${name} is clipped on the left`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${routeName} at ${width}px: ${name} is clipped on the right`)
            .toBeLessThanOrEqual(bounds.viewportWidth);
        expect(box.y, `${routeName} at ${width}px: ${name} overlaps the app header`)
            .toBeGreaterThanOrEqual(bounds.headerBottom);
        expect(box.y + box.height, `${routeName} at ${width}px: ${name} overlaps the bottom navigation`)
            .toBeLessThanOrEqual(bounds.bottomNavTop);

        await page.keyboard.press('Escape');
        await expect(tooltip).toBeHidden();
    }
}

for (const width of VIEWPORTS) {
    test(`every form help popup stays inside shell chrome at ${width}px`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width, height: 900 });
        // A demo wallet hides the authoring commands (Airdrop, Mint, Create multisig), so this walk uses a real dev wallet.
        await createWallet(page);

        for (const route of FORM_ROUTES) {
            await test.step(route.name, async () => {
                await route.open(page);
                await expectEveryHelpPopupOnScreen(page, route.name, width);
            });
        }
    });
}
