// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A balance never hides digits at any text size. iOS Dynamic Type and the
// Android font scale reach the app as its native font-scale event, so the
// spec sends that event at 100, 130 and 150 percent on two phone widths and
// checks every balance figure on Home and the Send available-balance line.
// The demo wallet's balances are short, so the spec also writes longer
// figures into the rendered rows to hold the layout to balances a real wallet
// can show.

import {
    dismissIntroCarousel,
    expect,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [{ width: 360, height: 800 }, { width: 390, height: 844 }];
const SCALES = [1, 1.3, 1.5];
const LONG_FIGURES = ['10,000,000,000.00000000', '100,000,000.00000000', '10,000.00000000'];

test.use({ deviceScaleFactor: 2, hasTouch: true, isMobile: true, viewport: VIEWPORTS[0] });

async function setFontScale(page, scale) {
    await page.evaluate((fontScale) => {
        window.dispatchEvent(new CustomEvent('xchain:native-font-scale', { detail: { fontScale } }));
    }, scale);
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)))
        .toBeCloseTo(16 * scale, 1);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Every balance figure that is cut, overflows its row, or pushes the page sideways. */
function cutFigures(page, longFigures = null) {
    return page.evaluate((figures) => {
        const rows = [...document.querySelectorAll('[data-balance-key]')];
        if (figures) {
            rows.forEach((row, i) => {
                const text = row.querySelector('span[aria-label] > [title]')?.firstChild;
                if (text && figures[i]) text.textContent = figures[i];
            });
        }
        const cut = [];
        for (const row of rows) {
            const box = row.getBoundingClientRect();
            const name = row.getAttribute('data-balance-key');
            for (const el of row.querySelectorAll('span[aria-label], span[aria-label] [title]')) {
                const text = el.textContent.trim();
                if (!/\d/.test(text)) continue;
                const r = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                if (el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible') cut.push(`${name}: "${text}" is cut`);
                if (style.textOverflow === 'ellipsis') cut.push(`${name}: "${text}" can end in an ellipsis`);
                if (r.right > box.right + 0.5 || r.left < box.left - 0.5) cut.push(`${name}: "${text}" leaves its row`);
            }
        }
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth) cut.push('the page scrolls sideways');
        return { rows: rows.length, cut };
    }, longFigures);
}

test('balances keep every digit at 100, 130 and 150 percent text', async ({ page }) => {
    test.setTimeout(240_000);
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    const coins = page.getByRole('list', { name: 'Balances' }).first();
    await expect(coins).toBeVisible();

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const scale of SCALES) {
            const where = `${viewport.width}px at ${Math.round(scale * 100)}%`;
            await setFontScale(page, scale);
            const demo = await cutFigures(page);
            expect(demo.rows, `${where}: Home shows balance rows`).toBeGreaterThan(0);
            expect(demo.cut, `${where}: demo balances`).toEqual([]);
            // Home redraws on a timer, so the long figures are written and
            // measured in one step and replaced by the next redraw.
            const long = await cutFigures(page, LONG_FIGURES);
            expect(long.cut, `${where}: long balances`).toEqual([]);
        }
    }

    // Send: the available-balance line under the amount field.
    await page.getByRole('navigation').getByRole('button', { name: 'Send', exact: true }).first().click();
    const amount = page.locator('#send-amount');
    await expect(amount).toBeVisible();
    const available = page.getByRole('status').filter({ hasText: /available/ }).first();
    await expect(available).toBeVisible();
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const scale of SCALES) {
            const where = `${viewport.width}px at ${Math.round(scale * 100)}%`;
            await setFontScale(page, scale);
            const line = await available.evaluate((el) => {
                const r = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                const lines = [el, ...el.querySelectorAll('*')];
                return {
                    text: el.textContent.trim(),
                    cut: el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible',
                    ellipsis: lines.some((node) => getComputedStyle(node).textOverflow === 'ellipsis'),
                    inside: r.left >= 0 && r.right <= document.documentElement.clientWidth + 0.5,
                    sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                };
            });
            expect(line.text, `${where}: Send shows the available balance`).toMatch(/\d/);
            expect(line, `${where}: Send available-balance line`).toMatchObject({
                cut: false, ellipsis: false, inside: true, sideways: false,
            });
        }
    }
});
