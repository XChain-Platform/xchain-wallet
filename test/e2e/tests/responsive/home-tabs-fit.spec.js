// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home's five view tabs (Coins, Tokens, NFTs, DeFi, Activity) all fit their
// row on a phone at 100, 130 and 150 percent text, beside the list filter
// button that shares the row (ruling U72), so Activity is never clipped or
// hidden behind a sideways scroll; and a phone with room keeps the tab font
// size. The font scale reaches the app as its native font-scale event, as
// in large-text-balances.spec.js.

import {
    dismissIntroCarousel,
    expect,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const WIDTHS = [320, 360, 375, 411];
const SCALES = [1, 1.3, 1.5];

test.use({ deviceScaleFactor: 2, hasTouch: true, isMobile: true, viewport: { width: 411, height: 814 } });

async function setFontScale(page, scale) {
    await page.evaluate((fontScale) => {
        window.dispatchEvent(new CustomEvent('xchain:native-font-scale', { detail: { fontScale } }));
    }, scale);
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)))
        .toBeCloseTo(16 * scale, 1);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('Home view tabs fit a phone row at 100, 130 and 150 percent text', async ({ page }) => {
    test.setTimeout(240_000);
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    const tablist = page.getByRole('tablist', { name: 'Wallet view' });
    await expect(tablist).toBeVisible();

    for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 814 });
        for (const scale of SCALES) {
            await setFontScale(page, scale);
            const where = `${width}px at ${Math.round(scale * 100)}%`;
            const fit = await tablist.evaluate((list) => {
                const box = list.getBoundingClientRect();
                const tabs = [...list.querySelectorAll('[role="tab"]')];
                const filter = list.parentElement.querySelector('button[aria-label="Filter and sort"]');
                const last = tabs[tabs.length - 1].getBoundingClientRect();
                return {
                    filter: Boolean(filter),
                    // The last tab ends inside the row and before the filter
                    // button, and the button ends on screen.
                    lastClipped: last.right > box.right + 0.5
                        || (filter ? last.right > filter.getBoundingClientRect().left + 0.5 : false),
                    filterOffscreen: filter
                        ? filter.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5
                        : false,
                    fontSize: parseFloat(getComputedStyle(tabs[0]).fontSize),
                    // The tab font token (--xc-text-sm) at this text scale.
                    tokenSize: (() => {
                        const probe = document.createElement('span');
                        probe.style.fontSize = 'var(--xc-text-sm)';
                        list.append(probe);
                        const size = parseFloat(getComputedStyle(probe).fontSize);
                        probe.remove();
                        return size;
                    })(),
                    overflow: list.scrollWidth - list.clientWidth,
                    hidden: tabs.filter((tab) => tab.getBoundingClientRect().right > box.right + 0.5)
                        .map((tab) => tab.textContent.trim()),
                    padding: parseFloat(getComputedStyle(tabs[0]).paddingLeft),
                    count: tabs.length,
                };
            });
            expect(fit.count, `${where}: tab count`).toBe(5);
            expect(fit.filter, `${where}: the filter button shares the tab row`).toBe(true);
            expect(fit.lastClipped, `${where}: the last tab is clipped`).toBe(false);
            expect(fit.filterOffscreen, `${where}: the filter button runs off screen`).toBe(false);
            expect(fit.hidden, `${where}: tabs past the row's end`).toEqual([]);
            expect(fit.overflow, `${where}: sideways scroll in the tab row`).toBeLessThanOrEqual(0);
            if (scale === 1 && width >= 360) expect(fit.fontSize, `${where}: default tab font size`).toBe(fit.tokenSize);
        }
    }
});
