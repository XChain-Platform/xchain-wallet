// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The actions inside a field (Send's address book and Paste on To, Paste and
// Max on Amount) never run into each other or out of the field at any text
// size. Paste grows with the text, so a layout that reserved its default
// width let the address book slide under it at 130 and 150 percent. The
// font scale reaches the app as its native font-scale event, as in
// large-text-balances.spec.js.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [{ width: 360, height: 800 }, { width: 411, height: 814 }];
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

/** Actions of one field that overlap, leave the field, or squeeze its text. */
function fieldActionFaults(input, actionNames) {
    return input.evaluate((element, names) => {
        const find = (root, name) => [...root.querySelectorAll('button')]
            .find((button) => button.getAttribute('aria-label') === name);
        let field = element.parentElement;
        while (field && !names.every((name) => find(field, name))) field = field.parentElement;
        if (!field) return [`no field holds ${names.join(', ')}`];
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const faults = [];
        const room = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        if (room < 100) faults.push(`only ${Math.round(room)}px left for text`);
        const rects = names.map((name) => [name, find(field, name).getBoundingClientRect()]);
        for (const [name, r] of rects) {
            if (r.left < box.left - 1 || r.right > box.right + 1) faults.push(`${name} leaves the field`);
        }
        // The input's own text must stop before the first action starts.
        const firstAction = Math.min(...rects.map(([, r]) => r.left));
        if (box.right - parseFloat(style.paddingRight) > firstAction + 1) faults.push('text runs under the actions');
        for (let i = 0; i < rects.length; i += 1) {
            for (let j = i + 1; j < rects.length; j += 1) {
                const [a, ra] = rects[i];
                const [b, rb] = rects[j];
                const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
                const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
                if (w > 0.5 && h > 0.5) faults.push(`${a} overlaps ${b} by ${Math.round(w)}px`);
            }
        }
        return faults;
    }, actionNames);
}

test('Send field actions stay apart and inside their fields at 100, 130 and 150 percent text', async ({ page }) => {
    test.setTimeout(240_000);
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await gotoSection(page, 'Send');
    const main = page.getByRole('main');
    const to = main.getByRole('combobox', { name: 'To' });
    const amount = main.getByRole('textbox', { name: /^Amount/ });
    await expect(to).toBeVisible();

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const scale of SCALES) {
            const where = `${viewport.width}px at ${Math.round(scale * 100)}%`;
            await setFontScale(page, scale);
            expect(await fieldActionFaults(to, ['Open address book', 'Paste from clipboard']), `${where}: To`).toEqual([]);
            expect(await fieldActionFaults(amount, ['Paste from clipboard', 'Use max available amount']), `${where}: Amount`).toEqual([]);
        }
    }
});
