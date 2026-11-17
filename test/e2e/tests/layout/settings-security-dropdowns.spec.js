// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings > Security dropdowns in a real browser (operator ruling
// 2026-11-14): picking an option never resizes the closed dropdown, every
// row title stays on one line, and the open list shows every option in full
// inside the viewport.

import {
    dismissIntroCarousel, expect, openSettings, test, unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const SIZES = [
    { name: '360x800', width: 360, height: 800 },
    { name: '1440x900', width: 1440, height: 900 },
];

const DROPDOWNS = [
    { name: 'Hold sends before broadcast', picks: ['30 s', '5 s', 'Off'] },
    { name: 'New-recipient test send', picks: ['$100,000', '$100', 'Off'] },
    { name: 'Auto-lock', picks: ['4 hours', '1 minute', '15 minutes'] },
];

/** Line count of the title on the row holding `trigger`, or -2 when its end is cut off. */
function titleLines(trigger) {
    return trigger.evaluate((el) => {
        const title = el.closest('[data-settings-inline]')?.querySelector('[data-settings-row-title]');
        if (!title) return -1;
        // The title never wraps, so a cut-off end is the failure to catch.
        if (title.scrollWidth > title.clientWidth + 1) return -2;
        const lineHeight = Number.parseFloat(getComputedStyle(title).lineHeight) || 20;
        return Math.round(title.getBoundingClientRect().height / lineHeight);
    });
}

for (const size of SIZES) {
    test(`Security dropdowns keep their width and show every option at ${size.name}`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await openSettings(page);
        await page.getByRole('button', { name: /^Security/ }).first().click();
        await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();

        for (const dropdown of DROPDOWNS) {
            const trigger = page.getByRole('combobox', { name: dropdown.name });
            await expect(trigger).toBeEnabled();
            const width = Math.round((await trigger.boundingBox()).width);
            expect(await titleLines(trigger), `${dropdown.name} title is one line`).toBe(1);

            for (const pick of dropdown.picks) {
                await trigger.click();
                const list = page.getByRole('listbox');
                await expect(list).toBeVisible();
                // Every option fits: inside the viewport, its text not cut off.
                const box = await list.boundingBox();
                expect(box.x, `${dropdown.name} list starts on screen`).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width, `${dropdown.name} list ends on screen`).toBeLessThanOrEqual(size.width);
                const clipped = await list.evaluate((el) => [...el.querySelectorAll('[role="option"]')]
                    .filter((option) => option.scrollWidth > option.clientWidth + 1)
                    .map((option) => option.textContent));
                expect(clipped, `${dropdown.name} options read in full`).toEqual([]);
                await list.getByRole('option', { name: pick, exact: true }).click();
                await expect(trigger).toContainText(pick);
                expect(Math.round((await trigger.boundingBox()).width), `${dropdown.name} keeps its width after ${pick}`).toBe(width);
                expect(await titleLines(trigger), `${dropdown.name} title stays one line after ${pick}`).toBe(1);
            }
        }
    });
}
