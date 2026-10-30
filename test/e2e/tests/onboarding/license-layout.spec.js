// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The licence page as the operator's rulings set it, at a phone, a short
// landscape phone and a desktop window:
//   U08  Accept and continue sits at the bottom of the screen and the terms
//        take all the height left, with no page scroll;
//   U09  on desktop the terms span the full width of the content lane;
//   U10  on desktop the terms sit in an outlined card drawn with the card
//        tokens, and their text still reaches the card's inner edges.

import { expect, test } from '../../fixtures/wallet.js';

test.use({ acceptLicense: false });

const VIEWPORTS = [
    { width: 360, height: 640, desktop: false },
    { width: 844, height: 390, desktop: false },
    { width: 1280, height: 800, desktop: true },
];

async function measure(page) {
    return page.evaluate(() => {
        const box = (el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
        };
        const terms = document.querySelector('[aria-label="License terms"]');
        const ack = document.querySelector('input[type="checkbox"]').closest('label');
        const accept = [...document.querySelectorAll('button')].find((b) => /accept and continue/i.test(b.innerText));
        const main = document.getElementById('xc-main');
        const mcs = getComputedStyle(main);
        const mr = main.getBoundingClientRect();
        const lane = {
            left: mr.left + main.clientLeft + parseFloat(mcs.paddingLeft),
            right: mr.left + main.clientLeft + main.clientWidth - parseFloat(mcs.paddingRight),
        };
        const tcs = getComputedStyle(terms);
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;border:var(--xc-card-border);border-radius:var(--xc-card-radius);padding:var(--xc-card-pad)';
        document.body.appendChild(probe);
        const pcs = getComputedStyle(probe);
        const token = { border: `${pcs.borderTopWidth} ${pcs.borderTopStyle} ${pcs.borderTopColor}`, radius: pcs.borderTopLeftRadius, pad: parseFloat(pcs.paddingLeft) };
        probe.remove();
        const firstParagraph = terms.querySelector('p');
        const se = document.scrollingElement || document.documentElement;
        return {
            vh: document.documentElement.clientHeight,
            pageScrollY: se.scrollHeight - se.clientHeight,
            pageScrollX: se.scrollWidth - se.clientWidth,
            terms: box(terms),
            ack: box(ack),
            accept: box(accept),
            gateGap: parseFloat(getComputedStyle(terms.parentElement).rowGap) || 0,
            lane,
            border: `${tcs.borderTopWidth} ${tcs.borderTopStyle} ${tcs.borderTopColor}`,
            radius: tcs.borderTopLeftRadius,
            padLeft: parseFloat(tcs.paddingLeft),
            padRight: parseFloat(tcs.paddingRight),
            innerWidth: terms.clientWidth - parseFloat(tcs.paddingLeft) - parseFloat(tcs.paddingRight),
            paragraphWidth: firstParagraph ? firstParagraph.getBoundingClientRect().width : 0,
            token,
        };
    });
}

for (const viewport of VIEWPORTS) {
    test(`licence page layout at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/');
        await expect(page.getByRole('form', { name: 'License agreement' })).toBeVisible();
        await expect(page.getByLabel('License terms')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const m = await measure(page);

        // U08: nothing scrolls the page, Accept sits at the bottom, and the
        // terms run down to the acknowledgement with no slack between.
        expect(m.pageScrollY, 'the licence page scrolls').toBeLessThanOrEqual(1);
        expect(m.pageScrollX, 'the licence page scrolls sideways').toBeLessThanOrEqual(1);
        expect(m.accept.bottom).toBeLessThanOrEqual(m.vh + 1);
        expect(m.vh - m.accept.bottom, 'Accept and continue sits at the bottom').toBeLessThanOrEqual(24);
        expect(Math.abs(m.ack.top - m.terms.bottom - m.gateGap), 'the terms take the height left').toBeLessThanOrEqual(1);
        expect(m.terms.height).toBeGreaterThanOrEqual(96);

        if (!viewport.desktop) return;
        // U09: the terms span the content lane.
        expect(Math.abs(m.terms.left - m.lane.left), 'terms left edge on the content lane').toBeLessThanOrEqual(1);
        expect(Math.abs(m.lane.right - m.terms.right), 'terms right edge on the content lane').toBeLessThanOrEqual(1);
        // U10: an outlined card in the card tokens, text out to its padding.
        expect(m.border).toBe(m.token.border);
        expect(m.radius).toBe(m.token.radius);
        expect(m.padLeft).toBeLessThanOrEqual(m.token.pad);
        expect(m.padRight).toBeLessThanOrEqual(m.token.pad);
        expect(m.innerWidth - m.paragraphWidth, 'terms text reaches the card edges').toBeLessThanOrEqual(1);
    });
}
