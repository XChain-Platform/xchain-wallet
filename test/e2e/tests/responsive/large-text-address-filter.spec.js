// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The address-type filter on Addresses keeps every label whole at every text
// size. At an iPad Slide Over width with the largest text the four labels are
// wider than the control, which cut the last one at its edge. The spec sends
// the native font-scale event at 100, 130 and 150 percent on the Slide Over
// width and a small phone and checks that each tab sits inside the control
// and shows its whole label.

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

/** Every tab whose label is cut or that leaves the filter control. */
function cutTabs(page) {
    return page.getByRole('tablist', { name: 'Filter by address type' }).evaluate((list) => {
        const box = list.getBoundingClientRect();
        const cut = [];
        for (const tab of list.querySelectorAll('[role="tab"]')) {
            const r = tab.getBoundingClientRect();
            const name = tab.textContent.trim();
            if (r.right > box.right + 0.5 || r.left < box.left - 0.5) cut.push(`"${name}" leaves the control`);
            if (r.bottom > box.bottom + 0.5 || r.top < box.top - 0.5) cut.push(`"${name}" leaves the control vertically`);
            if (tab.scrollWidth > tab.clientWidth + 1) cut.push(`"${name}" label is cut`);
        }
        return cut;
    });
}

test('the address-type filter shows every label whole at every text size', async ({ page }) => {
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await openPaletteCommand(page, 'Addresses');
    await expect(page.getByRole('tablist', { name: 'Filter by address type' })).toBeVisible();
    const problems = [];
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const scale of SCALES) {
            await setFontScale(page, scale);
            const where = `${viewport.width}px at ${Math.round(scale * 100)}%`;
            for (const problem of await cutTabs(page)) problems.push(`${where}: ${problem}`);
        }
    }
    expect(problems).toEqual([]);
});
