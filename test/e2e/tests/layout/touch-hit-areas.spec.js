// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Compact controls keep their painted size but must give a finger a 44x44 tap
// area on a touch screen. The area is a transparent ::before layer, so this
// measures what a tap actually hits: elementFromPoint across a box around the
// control, not the control's own rectangle.

import { dismissIntroCarousel, expect, gotoSection, test, unlockedShell } from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const TAP_MIN = 44;
// Half a pixel of slack: the sampling grid steps in half pixels and the
// controls sit on fractional positions.
const TOLERANCE = 0.5;

test.use({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });

/**
 * Runs in the page (or an iframe): for each selector returns the size of the
 * region around the control's centre that resolves to the control itself,
 * and whether the control's own centre still resolves to it.
 */
function measureHitAreas(selectors) {
    return selectors.map(({ name, selector, index = 0 }) => {
        const list = [...document.querySelectorAll(selector)].filter((el) => el.getBoundingClientRect().width > 0);
        const el = list[index];
        if (!el) return { name, missing: true };
        el.scrollIntoView({ block: 'center' });
        const box = el.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        const reach = 40;
        for (let dy = -reach; dy <= reach; dy += 0.5) {
            for (let dx = -reach; dx <= reach; dx += 0.5) {
                const x = cx + dx;
                const y = cy + dy;
                if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
                const hit = document.elementFromPoint(x, y);
                if (hit && (hit === el || el.contains(hit))) {
                    minX = Math.min(minX, dx);
                    maxX = Math.max(maxX, dx);
                    minY = Math.min(minY, dy);
                    maxY = Math.max(maxY, dy);
                }
            }
        }
        const centre = document.elementFromPoint(cx, cy);
        return {
            name,
            width: maxX - minX,
            height: maxY - minY,
            centreOwned: Boolean(centre && (centre === el || el.contains(centre))),
        };
    });
}

function expectTapAreas(results) {
    for (const r of results) {
        expect(r.missing, `${r.name} is on screen`).toBeFalsy();
        expect(r.width, `${r.name} tap width`).toBeGreaterThanOrEqual(TAP_MIN - TOLERANCE);
        expect(r.height, `${r.name} tap height`).toBeGreaterThanOrEqual(TAP_MIN - TOLERANCE);
        expect(r.centreOwned, `${r.name} centre is not covered by a neighbour's tap area`).toBe(true);
    }
}

test('Home and Send compact controls give a 44px tap area on touch', async ({ page }) => {
    test.slow();
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Try in demo mode' }).click();
    await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });

    const rangePills = page.getByRole('main').locator('[role="tablist"][aria-label*="ange"] [role="tab"]');
    await expect(rangePills.first()).toBeVisible();
    const rangeCount = await rangePills.count();
    expectTapAreas(await page.evaluate(
        measureHitAreas,
        Array.from({ length: rangeCount }, (_, i) => ({
            name: `chart range pill ${i + 1}`,
            selector: 'main [role="tablist"][aria-label*="ange"] [role="tab"]',
            index: i,
        })),
    ));

    await gotoSection(page, 'Send');
    await expect(page.getByRole('button', { name: 'Create a real wallet' })).toBeVisible();
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    expectTapAreas(await page.evaluate(measureHitAreas, [
        { name: 'Create a real wallet', selector: 'button[class*="recovery"]' },
        { name: 'Advanced disclosure', selector: 'summary' },
        { name: 'help dot', selector: 'button[class*="trigger"][aria-describedby]' },
    ]));
});

test('fee selector stops and edit buttons give a 44px tap area on touch', async ({ page }) => {
    test.slow();
    await page.goto('/style-guide/#fee-selector');
    const section = page.locator('#fee-selector');
    await section.scrollIntoViewIfNeeded();
    // The style guide renders each example in an iframe; the first one in the
    // section is the Send variant, with four stops and both edit buttons.
    const iframe = section.locator('iframe').first();
    await expect(iframe).toBeVisible();
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.waitForSelector('[class*="sliderTick"]', { timeout: 60_000 });
    const targets = [0, 1, 2, 3].map((i) => ({ name: `fee tier stop ${i + 1}`, selector: 'button[class*="sliderTick"]', index: i }));
    targets.push(
        { name: 'fee amount edit', selector: 'button[class*="readoutEdit"]', index: 0 },
        { name: 'fee rate edit', selector: 'button[class*="readoutEdit"]', index: 1 },
    );
    expectTapAreas(await frame.evaluate(measureHitAreas, targets));
});
