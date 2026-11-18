// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// On phone widths every tab of My Tokens' token page fits the strip, so none
// sits cut off past the edge of the screen. The page is the one asset page
// (operator ruling 2026-11-15): Actions, Details and History, headed by the
// token's name.

import { createWallet, expect, test } from '../../fixtures/wallet.js';

const TABS = ['Actions', 'Details', 'History'];

async function openManagedToken(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Wallet menu' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('My tokens');
    await palette.getByRole('option', { name: /^My tokens\b/ }).first().click();
    await expect(palette).toBeHidden();
    await page.getByRole('button', { name: 'Open XCP token details' }).first().click();
    await expect(page.getByRole('heading', { name: 'XCP', exact: true })).toBeVisible();
}

for (const width of [320, 360, 412]) {
    test(`every Manage token tab fits at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await createWallet(page);
        await openManagedToken(page);

        const strip = page.getByRole('tablist', { name: 'Coin or token view' });
        await strip.scrollIntoViewIfNeeded();
        const fit = await strip.evaluate((el) => ({
            client: el.clientWidth,
            scroll: el.scrollWidth,
            right: el.getBoundingClientRect().right,
        }));
        expect(fit.scroll, 'the tab strip scrolls sideways').toBeLessThanOrEqual(fit.client);

        for (const name of TABS) {
            const tab = strip.getByRole('tab', { name, exact: true });
            const box = await tab.boundingBox();
            expect(box, `${name} tab has no box`).not.toBeNull();
            expect(box.x + box.width, `${name} tab runs past the strip`).toBeLessThanOrEqual(fit.right + 0.5);
        }

        await strip.getByRole('tab', { name: 'Details', exact: true }).click();
        await expect(strip.getByRole('tab', { name: 'Details', exact: true }))
            .toHaveAttribute('aria-selected', 'true');
    });
}
