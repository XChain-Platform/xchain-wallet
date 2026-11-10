// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from '../../fixtures/wallet.js';

test.use({ acceptLicense: false });

const VIEWPORTS = [
    { width: 390, height: 844 },
    { width: 834, height: 1194 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
];

const PIXEL_TOLERANCE = 1;
// Layouts this wide put the terms in a two-thirds card (U32).
const TWO_THIRDS_MIN_WIDTH = 834;

async function settleGate(form) {
    await form.evaluate(async (element) => {
        await document.fonts.ready;
        await Promise.allSettled(
            element.getAnimations({ subtree: true }).map((animation) => animation.finished),
        );
    });
}

async function measureGate(form) {
    return form.evaluate((element) => {
        const terms = element.querySelector('[aria-label="License terms"]');
        const checkbox = element.querySelector('input[type="checkbox"]');
        const acknowledgement = checkbox.closest('label');
        const controls = acknowledgement.parentElement;
        // FormPage owns the brand and title in its header; the gate is the
        // terms followed by the shared controls wrapper.
        const gate = terms.parentElement;
        const hero = element.querySelector('header');
        const button = element.querySelector('button');
        const rect = (node) => {
            const box = node.getBoundingClientRect();
            return {
                top: box.top,
                right: box.right,
                bottom: box.bottom,
                left: box.left,
                width: box.width,
                height: box.height,
            };
        };

        return {
            form: rect(element),
            hero: rect(hero),
            terms: rect(terms),
            controls: rect(controls),
            acknowledgement: rect(acknowledgement),
            button: rect(button),
            gap: Number.parseFloat(getComputedStyle(gate).rowGap),
            formGap: Number.parseFloat(getComputedStyle(element).rowGap),
            heroMarginBottom: Number.parseFloat(getComputedStyle(hero).marginBottom),
        };
    });
}

async function expectScrollGate(terms, acknowledgement) {
    const overflow = await terms.evaluate(
        // Same tolerance the gate uses before it treats the terms as fitting.
        (element) => element.scrollHeight > element.clientHeight + 4,
    );
    if (!overflow) return;

    await expect(acknowledgement).toBeDisabled();

    const remaining = await terms.evaluate((element) => {
        const maximum = element.scrollHeight - element.clientHeight;
        if (maximum <= 9) return null;
        element.scrollTop = Math.max(0, maximum - 12);
        element.dispatchEvent(new Event('scroll', { bubbles: true }));
        return element.scrollHeight - element.clientHeight - element.scrollTop;
    });
    if (remaining !== null) {
        expect(remaining).toBeGreaterThan(8);
        await expect(acknowledgement).toBeDisabled();
    }

    await terms.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect(acknowledgement).toBeEnabled();
}

for (const viewport of VIEWPORTS) {
    test(`license gate keeps Accept under the terms at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/');

        const form = page.getByRole('form', { name: 'License agreement' });
        const terms = page.getByLabel('License terms');
        const acknowledgement = page.getByRole('checkbox');
        const accept = page.getByRole('button', { name: /Accept and continue/i });
        await expect(form).toBeVisible();
        await expect(terms).toBeVisible();
        await expect(accept).toBeVisible();
        await settleGate(form);

        const layout = await measureGate(form);
        const bottomGap = viewport.height - layout.button.bottom;
        expect(bottomGap).toBeGreaterThanOrEqual(-PIXEL_TOLERANCE);
        expect(layout.terms.top - layout.hero.bottom)
            .toBeCloseTo(layout.formGap + layout.heroMarginBottom, 0);
        // The shared controls wrapper sits directly under the card.
        expect(layout.controls.top - layout.terms.bottom)
            .toBeCloseTo(layout.gap, 0);
        expect(layout.terms.height).toBeGreaterThan(0);

        if (viewport.width >= TWO_THIRDS_MIN_WIDTH) {
            // The card takes two-thirds of the form. The controls share the
            // next row, aligned to the card edges and vertically overlapping.
            expect(Math.abs(layout.terms.width - (layout.form.width * 2) / 3))
                .toBeLessThanOrEqual(PIXEL_TOLERANCE);
            expect(Math.abs((layout.terms.left - layout.form.left) - (layout.form.right - layout.terms.right)))
                .toBeLessThanOrEqual(PIXEL_TOLERANCE);
            expect(layout.acknowledgement.top).toBeLessThan(layout.button.bottom);
            expect(layout.button.top).toBeLessThan(layout.acknowledgement.bottom);
            expect(Math.abs(layout.acknowledgement.left - layout.terms.left))
                .toBeLessThanOrEqual(PIXEL_TOLERANCE);
            expect(Math.abs(layout.button.right - layout.terms.right))
                .toBeLessThanOrEqual(PIXEL_TOLERANCE);
            expect(layout.controls.top - layout.terms.bottom)
                .toBeLessThanOrEqual(24);
        } else {
            // Below 834px the existing stacked order remains unchanged.
            expect(layout.button.top).toBeGreaterThan(layout.acknowledgement.bottom);
            expect(layout.button.top - layout.acknowledgement.bottom)
                .toBeLessThanOrEqual(layout.formGap + PIXEL_TOLERANCE);
        }

        await expectScrollGate(terms, acknowledgement);
    });
}
