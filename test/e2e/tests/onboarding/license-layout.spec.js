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
//   U48  at every width, phones included, the terms card wraps its text and
//        the checkbox and Accept and continue sit directly under it, never
//        pinned to the bottom of the screen, with no page scroll; below 834px
//        the terms span the content lane;
//   U32  from 834px the terms card takes two-thirds of the content lane,
//        centred, and the checkbox and Accept and continue sit directly
//        under it;
//   U33  the terms sit in an outlined card drawn with the card tokens, with
//        inner padding, so the text never touches the card's edge.

import { expect, test } from '../../fixtures/wallet.js';

test.use({ acceptLicense: false });

const VIEWPORTS = [
    // twoThirds: the layout is 834px or wider, so U32 applies.
    { width: 360, height: 640, twoThirds: false },
    { width: 844, height: 390, twoThirds: true },
    { width: 1280, height: 800, twoThirds: true },
];

async function measure(page) {
    return page.evaluate(() => {
        const box = (el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
        };
        const terms = document.querySelector('[aria-label="License terms"]');
        const ack = document.querySelector('input[type="checkbox"]').closest('label');
        const controls = ack.parentElement;
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
            controls: box(controls),
            ack: box(ack),
            accept: box(accept),
            gateGap: parseFloat(getComputedStyle(terms.parentElement).rowGap) || 0,
            formGap: parseFloat(getComputedStyle(terms.closest('form')).rowGap) || 0,
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

        // Nothing scrolls the page, Accept stays on screen, and the controls
        // sit directly under the terms card.
        expect(m.pageScrollY, 'the licence page scrolls').toBeLessThanOrEqual(1);
        expect(m.pageScrollX, 'the licence page scrolls sideways').toBeLessThanOrEqual(1);
        expect(m.accept.bottom).toBeLessThanOrEqual(m.vh + 1);
        expect(Math.abs(m.controls.top - m.terms.bottom - m.gateGap), 'the controls sit directly under the terms').toBeLessThanOrEqual(1);
        expect(m.terms.height).toBeGreaterThanOrEqual(96);

        // U33: an outlined card in the card tokens with inner padding.
        expect(m.border).toBe(m.token.border);
        expect(m.radius).toBe(m.token.radius);
        expect(m.padLeft, 'the terms card has inline-start padding').toBeGreaterThan(0);
        expect(m.padRight, 'the terms card has inline-end padding').toBeGreaterThan(0);

        if (!viewport.twoThirds) {
            expect(m.accept.top, 'Accept sits below the checkbox').toBeGreaterThan(m.ack.bottom);
            expect(m.accept.top - m.ack.bottom, 'Accept sits directly under the checkbox').toBeLessThanOrEqual(m.formGap + 1);
            // Below 834px the terms span the content lane.
            expect(Math.abs(m.terms.left - m.lane.left), 'terms left edge on the content lane').toBeLessThanOrEqual(1);
            expect(Math.abs(m.lane.right - m.terms.right), 'terms right edge on the content lane').toBeLessThanOrEqual(1);
            return;
        }
        // U32: two-thirds of the content lane, centred on it.
        const laneWidth = m.lane.right - m.lane.left;
        expect(Math.abs(m.terms.width - (laneWidth * 2) / 3), 'terms card takes two-thirds of the lane').toBeLessThanOrEqual(1);
        expect(Math.abs((m.terms.left - m.lane.left) - (m.lane.right - m.terms.right)), 'terms card centred on the lane').toBeLessThanOrEqual(1);
        expect(m.ack.top, 'checkbox overlaps Accept vertically').toBeLessThan(m.accept.bottom);
        expect(m.accept.top, 'Accept overlaps checkbox vertically').toBeLessThan(m.ack.bottom);
        expect(Math.abs(m.ack.left - m.terms.left), 'checkbox starts on the card edge').toBeLessThanOrEqual(1);
        expect(Math.abs(m.accept.right - m.terms.right), 'Accept ends on the card edge').toBeLessThanOrEqual(1);
    });
}
