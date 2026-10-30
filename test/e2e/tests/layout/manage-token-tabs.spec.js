// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// At 360px every Manage token panel tab fits the strip, so none sits cut
// off past the edge of a phone screen.

import { createWallet, expect, test } from '../../fixtures/wallet.js';

const TABS = ['Dispensers', 'Orders', 'Swaps', 'Holders', 'Activity'];

async function openManagedToken(page) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('My tokens');
    await palette.getByRole('option', { name: /^My tokens\b/ }).first().click();
    await expect(palette).toBeHidden();
    await page.getByLabel('Search your tokens by ticker or description').fill('XCP');
    await page.getByRole('button', { name: 'Open XCP token details' }).first().click();
    await expect(page.getByRole('heading', { name: 'Manage token' })).toBeVisible();
}

for (const width of [320, 360, 412]) {
    test(`every Manage token tab fits at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await createWallet(page);
        await openManagedToken(page);

        const strip = page.getByRole('tablist', { name: 'Token management panels' });
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

        await strip.getByRole('tab', { name: 'Activity', exact: true }).click();
        await expect(strip.getByRole('tab', { name: 'Activity', exact: true }))
            .toHaveAttribute('aria-selected', 'true');
    });
}
