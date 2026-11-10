// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// U32 and U33: from 834px the licence terms sit in a padded outline card two
// thirds as wide as the content lane, centred on it, with the checkbox and
// Accept and continue directly under the card, a short landscape phone
// 844px wide included. Below 834px the terms still fill the full lane width.

import { expect, test } from '../../fixtures/wallet.js';

test.use({ acceptLicense: false });

const WIDE = [
    { width: 834, height: 1194 },
    { width: 844, height: 390 },
    { width: 900, height: 900 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
];

const NARROW = [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 600, height: 960 },
];

async function measure(page) {
    const form = page.getByRole('form', { name: 'License agreement' });
    await expect(form).toBeVisible();
    await form.evaluate(() => document.fonts.ready);
    return form.evaluate((element) => {
        const terms = element.querySelector('[aria-label="License terms"]');
        const acknowledgement = element.querySelector('input[type="checkbox"]').closest('label');
        const accept = [...element.querySelectorAll('button')].find((b) => /Accept and continue/i.test(b.textContent));
        const paragraphs = terms.querySelectorAll('p');
        const box = (node) => node.getBoundingClientRect();
        const style = getComputedStyle(terms);
        const main = document.getElementById('xc-main');
        const mainStyle = getComputedStyle(main);
        const mainBox = main.getBoundingClientRect();
        const laneLeft = mainBox.left + main.clientLeft + Number.parseFloat(mainStyle.paddingLeft);
        const laneRight = mainBox.left + main.clientLeft + main.clientWidth - Number.parseFloat(mainStyle.paddingRight);
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;border:var(--xc-card-border);border-radius:var(--xc-card-radius)';
        document.body.appendChild(probe);
        const probeStyle = getComputedStyle(probe);
        const token = {
            border: `${probeStyle.borderTopWidth} ${probeStyle.borderTopStyle} ${probeStyle.borderTopColor}`,
            radius: probeStyle.borderTopLeftRadius,
        };
        probe.remove();
        return {
            formWidth: box(element).width,
            laneLeft,
            laneRight,
            termsLeft: box(terms).left,
            termsRight: box(terms).right,
            termsWidth: box(terms).width,
            termsBottom: box(terms).bottom,
            lastTextBottom: box(paragraphs[paragraphs.length - 1]).bottom,
            acknowledgementTop: box(acknowledgement).top,
            acknowledgementLeft: box(acknowledgement).left,
            acknowledgementRight: box(acknowledgement).right,
            acknowledgementBottom: box(acknowledgement).bottom,
            acceptTop: box(accept).top,
            acceptBottom: box(accept).bottom,
            acceptLeft: box(accept).left,
            acceptRight: box(accept).right,
            acceptWidth: box(accept).width,
            paddingLeft: Number.parseFloat(style.paddingLeft),
            paddingRight: Number.parseFloat(style.paddingRight),
            paddingTop: Number.parseFloat(style.paddingTop),
            border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
            radius: style.borderTopLeftRadius,
            token,
            fits: terms.scrollHeight <= terms.clientHeight + 4,
        };
    });
}

for (const viewport of WIDE) {
    test(`license card is two-thirds of the lane and wraps its text at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/');
        const layout = await measure(page);
        const laneWidth = layout.laneRight - layout.laneLeft;

        expect(Math.abs(layout.termsWidth - (laneWidth * 2) / 3), 'terms card takes two-thirds of the lane').toBeLessThanOrEqual(1);
        expect(Math.abs((layout.termsLeft - layout.laneLeft) - (layout.laneRight - layout.termsRight)), 'terms card centred on the lane')
            .toBeLessThanOrEqual(1);
        expect(layout.paddingLeft).toBeGreaterThan(0);
        expect(layout.paddingRight).toBeGreaterThan(0);
        expect(layout.paddingTop).toBeGreaterThan(0);
        expect(layout.border).toBe(layout.token.border);
        expect(layout.radius).toBe(layout.token.radius);
        if (layout.fits) {
            expect(layout.termsBottom - layout.lastTextBottom).toBeLessThanOrEqual(layout.paddingTop + 2);
        }
        expect(layout.acknowledgementTop - layout.termsBottom).toBeLessThanOrEqual(24);
        expect(layout.acceptTop - layout.termsBottom).toBeLessThanOrEqual(24);
        expect(layout.acknowledgementTop).toBeLessThan(layout.acceptBottom);
        expect(layout.acceptTop).toBeLessThan(layout.acknowledgementBottom);
    });
}

for (const viewport of NARROW) {
    test(`license terms fill the full lane width at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/');
        const layout = await measure(page);
        expect(Math.abs(layout.termsLeft - layout.laneLeft), 'terms left edge on the content lane').toBeLessThanOrEqual(1);
        expect(Math.abs(layout.laneRight - layout.termsRight), 'terms right edge on the content lane').toBeLessThanOrEqual(1);
    });
}

for (const viewport of WIDE) {
    test(`license checkbox and Accept sit inside the terms card column at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/');
        const layout = await measure(page);

        // The acknowledgement and the action share the card column, so the
        // button never drifts to the far edge of the full-width form.
        expect(layout.acknowledgementLeft, 'checkbox starts inside the card column').toBeGreaterThanOrEqual(layout.termsLeft - 2);
        expect(layout.acknowledgementRight, 'checkbox ends inside the card column').toBeLessThanOrEqual(layout.termsRight + 2);
        expect(layout.acceptLeft, 'Accept starts inside the card column').toBeGreaterThanOrEqual(layout.termsLeft - 2);
        expect(Math.abs(layout.acceptRight - layout.termsRight), 'Accept ends on the card end edge').toBeLessThanOrEqual(2);
    });
}

test('license Accept spans the full phone width at 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const layout = await measure(page);
    const laneWidth = layout.laneRight - layout.laneLeft;
    expect(Math.abs(layout.acceptWidth - laneWidth), 'Accept spans the content lane').toBeLessThanOrEqual(1);
    expect(Math.abs(layout.acceptLeft - layout.laneLeft), 'Accept starts on the lane edge').toBeLessThanOrEqual(1);
});
