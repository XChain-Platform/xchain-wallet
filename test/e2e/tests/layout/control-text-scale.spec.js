// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Text inside inputs and selects follows the text-size setting the way labels
// do, and no field, select or amount field clips or scrolls sideways at the
// base size or at 1.5, on a phone and a desktop width. Max stays inside the
// amount field, and the page never scrolls sideways.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import { applyFontScale } from '../../layout/sweep.js';

const WIDTHS = [{ width: 360, height: 800 }, { width: 1440, height: 900 }];
const SCALES = [1, 1.5];
const BASE_CONTROL_PX = 14;

async function openByPalette(page, query) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(query);
    await palette.getByRole('option').first().click();
    await expect(palette).toBeHidden();
    await page.waitForTimeout(800);
}

/** Runs in the page: every visible field's font size and sideways overflow. */
function readFields() {
    const sel = 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=file]), select, textarea';
    const fields = [];
    for (const el of document.querySelectorAll(sel)) {
        const box = el.getBoundingClientRect();
        if (box.width < 8 || box.height < 8) continue;
        const cs = getComputedStyle(el);
        // A read-only address draws its text in an overlay and keeps the
        // input's own text transparent, so the input's inner scroll width
        // is not a visible clip.
        const overlay = cs.color === 'rgba(0, 0, 0, 0)' || cs.color === 'transparent';
        fields.push({
            name: `${el.tagName.toLowerCase()}#${el.id}`,
            fontPx: parseFloat(cs.fontSize),
            sidewaysClip: !overlay && el.scrollWidth > el.clientWidth + 1,
            verticalClip: el.scrollHeight > el.clientHeight + 1,
        });
    }
    const root = document.documentElement;
    return { fields, pageSideways: root.scrollWidth > root.clientWidth };
}

function expectFieldsFit(read, scale, label) {
    expect(read.pageSideways, `${label}: the page scrolls sideways`).toBe(false);
    expect(read.fields.length, `${label}: no fields measured`).toBeGreaterThan(0);
    for (const field of read.fields) {
        expect(field.fontPx, `${label}: ${field.name} text size`).toBeCloseTo(BASE_CONTROL_PX * scale, 0);
        expect(field.sidewaysClip, `${label}: ${field.name} scrolls sideways`).toBe(false);
        expect(field.verticalClip, `${label}: ${field.name} clips vertically`).toBe(false);
    }
}

for (const { width, height } of WIDTHS) {
    for (const scale of SCALES) {
        test(`field text follows the text size at ${width}px and ${scale}`, async ({ page }) => {
            test.slow();
            await page.setViewportSize({ width, height });
            await createWallet(page);
            if (scale !== 1) await applyFontScale(page, scale);

            await openByPalette(page, 'Send');
            const label = `${width}px x${scale} Send`;
            expectFieldsFit(await page.evaluate(readFields), scale, label);

            // Max sits inside the amount field.
            const amount = await page.locator('#send-amount').boundingBox();
            const max = page.getByRole('button', { name: 'Use max available amount' });
            await expect(max, `${label}: Max button`).toHaveCount(1);
            {
                const box = await max.first().boundingBox();
                expect(box.x, `${label}: Max left edge`).toBeGreaterThanOrEqual(amount.x);
                expect(box.x + box.width, `${label}: Max right edge`).toBeLessThanOrEqual(amount.x + amount.width + 1);
                expect(box.y, `${label}: Max top edge`).toBeGreaterThanOrEqual(amount.y - 1);
                expect(box.y + box.height, `${label}: Max bottom edge`).toBeLessThanOrEqual(amount.y + amount.height + 1);
            }

            await openByPalette(page, 'Advanced');
            expectFieldsFit(await page.evaluate(readFields), scale, `${width}px x${scale} Advanced action`);
        });
    }
}
