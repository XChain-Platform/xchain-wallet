// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The page header keeps one height whether its Back control shows or not.
// Back is hidden on screens the visible nav links to (Send, Settings) and
// shown on nested screens (Settings > Privacy). Holding the hidden case at
// the larger trailing-control size made every header 8px taller than the
// Back control it is meant to match. Trailing actions (Payments due
// refresh) take the Back control size too, so a screen with one is the same
// height as a screen without. History and Contacts hold only the title and
// Back: their actions sit in the content's actions row.
// Settings also opens at its first row however far it was scrolled before.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const SIZES = [
    [360, 800],
    [768, 1024],
    [1290, 850],
];

async function enterDemoWallet(page) {
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Try in demo mode' }).click();
    await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });
}

// Heights of the PageHeader row, the Screen header band that holds it, and
// the row's Back and trailing action controls, read from the visible title.
async function headerBox(page, title) {
    const heading = page.getByRole('heading', { level: 1, name: title, exact: true });
    await expect(heading).toBeVisible();
    return heading.evaluate((h1) => {
        const row = h1.parentElement.parentElement;
        const band = h1.closest('header');
        const buttons = [...row.querySelectorAll('button')]
            .filter((b) => b.getAttribute('role') !== 'menuitem');
        const back = buttons.find((b) => /^Back/.test(b.getAttribute('aria-label') || ''));
        return {
            row: row.getBoundingClientRect().height,
            band: band.getBoundingClientRect().height,
            back: Boolean(back),
            backHeight: back ? back.getBoundingClientRect().height : null,
            actionHeights: buttons.filter((b) => b !== back)
                .map((b) => b.getBoundingClientRect().height),
        };
    });
}

for (const [width, height] of SIZES) {
    test(`page header height is the same with Back shown and hidden at ${width}x${height}`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width, height });
        await enterDemoWallet(page);

        await gotoSection(page, 'Send');
        const send = await headerBox(page, 'Send');
        expect(send.back, 'Send is a nav destination, so Back is hidden').toBe(false);

        await gotoSection(page, 'Settings');
        await page.getByRole('main').getByRole('button', { name: /^Privacy\b/ }).click();
        const privacy = await headerBox(page, 'Privacy');
        expect(privacy.back, 'a Settings section always shows Back').toBe(true);

        // The row is exactly as tall as the Back control, shown or not.
        expect(privacy.row).toBe(privacy.backHeight);
        expect(send.row).toBe(privacy.backHeight);
        expect(send.row).toBe(privacy.row);
        expect(send.band).toBe(privacy.band);

        // A screen with a trailing action: Payments due. The action matches
        // Back, so the band does not grow.
        await gotoSection(page, 'Payments due');
        const payments = await headerBox(page, 'Payments due');
        expect(payments.actionHeights.length, 'Payments due has a header action').toBeGreaterThan(0);
        for (const h of payments.actionHeights) expect(h, 'Payments due action height').toBe(privacy.backHeight);
        expect(payments.row, 'Payments due row height').toBe(privacy.row);
        expect(payments.band, 'Payments due band height').toBe(privacy.band);

        // History (Back hidden, it is a nav destination) and Contacts (Back
        // shown where the tab bar does not link it) hold only the title and
        // Back, at the same height.
        await gotoSection(page, 'History');
        const history = await headerBox(page, 'History');
        await gotoSection(page, 'Contacts');
        const contacts = await headerBox(page, 'Contacts');
        for (const [name, box] of [['History', history], ['Contacts', contacts]]) {
            expect(box.actionHeights, `${name} page header holds only the title and Back`).toEqual([]);
            expect(box.row, `${name} row height`).toBe(privacy.row);
            expect(box.band, `${name} band height`).toBe(privacy.band);
        }
    });
}

test('Settings opens at the top after it was scrolled and left', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1290, height: 850 });
    await enterDemoWallet(page);
    const main = page.locator('#xc-main');

    await gotoSection(page, 'Settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
    await main.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await main.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    await gotoSection(page, 'Home');
    await expect(unlockedShell(page)).toBeVisible();
    await gotoSection(page, 'Settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: /^Privacy\b/ })).toBeVisible();
    await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBe(0);
});
