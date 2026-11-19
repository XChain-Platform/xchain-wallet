// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The address-type filter on Addresses is a select inside the Filter popup.
// Its four options keep every label whole at every text size, and the option
// list scrolls vertically when it does not fit. The spec sends the native
// font-scale event at 100, 130 and 150 percent on two small phones, opens the
// select and checks that each option stays whole and reachable in its list.

import {
    dismissIntroCarousel,
    expect,
    openPaletteCommand,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [{ width: 320, height: 780 }, { width: 360, height: 800 }];
const SCALES = [1, 1.3, 1.5];

test.use({ deviceScaleFactor: 2, hasTouch: true, isMobile: true, viewport: VIEWPORTS[0] });

async function setFontScale(page, scale) {
    await page.evaluate((fontScale) => {
        window.dispatchEvent(new CustomEvent('xchain:native-font-scale', { detail: { fontScale } }));
    }, scale);
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)))
        .toBeCloseTo(16 * scale, 1);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Every option whose label is cut or cannot be scrolled into view inside the open list. */
function cutOptions(page) {
    return page.getByRole('listbox', { name: 'Filter by address type' }).evaluate((list) => {
        const scroller = [list, ...list.querySelectorAll('*')].find((el) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) || list;
        const cut = [];
        for (const option of list.querySelectorAll('[role="option"]')) {
            const name = option.textContent.trim();
            const r = option.getBoundingClientRect();
            const box = list.getBoundingClientRect();
            if (r.left < box.left - 0.5 || r.right > box.right + 0.5) cut.push(`"${name}" leaves the list horizontally`);
            if (option.scrollWidth > option.clientWidth + 1) cut.push(`"${name}" label is cut`);
            for (const el of option.querySelectorAll('*')) {
                if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') cut.push(`"${name}" label is cut`);
            }
            option.scrollIntoView({ block: 'nearest' });
            const reached = option.getBoundingClientRect();
            const view = scroller.getBoundingClientRect();
            if (reached.top < view.top - 0.5 || reached.bottom > view.bottom + 0.5) {
                cut.push(`"${name}" cannot be scrolled fully into view`);
            }
        }
        scroller.scrollTop = 0;
        return cut;
    });
}

test('the address-type filter shows every label whole at every text size', async ({ page }) => {
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await openPaletteCommand(page, 'Addresses');
    await expect(page.getByRole('button', { name: 'Filter addresses' })).toBeVisible();
    const problems = [];
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const scale of SCALES) {
            await setFontScale(page, scale);
            await page.getByRole('button', { name: 'Filter addresses' }).click();
            await page.getByRole('button', { name: /^Filter by address type/ }).click();
            await expect(page.getByRole('listbox', { name: 'Filter by address type' })).toBeVisible();
            const where = `${viewport.width}px at ${Math.round(scale * 100)}%`;
            for (const problem of await cutOptions(page)) problems.push(`${where}: ${problem}`);
            await page.keyboard.press('Escape');
            await page.keyboard.press('Escape');
        }
    }
    expect(problems).toEqual([]);
});
