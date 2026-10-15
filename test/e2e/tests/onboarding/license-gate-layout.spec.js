// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from '../../fixtures/wallet.js';

test.use({ acceptLicense: false });

const VIEWPORTS = [
    { width: 390, height: 844 },
    { width: 412, height: 869 },
    { width: 360, height: 600 },
    { width: 1280, height: 800 },
];

const PIXEL_TOLERANCE = 1;

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
        // FormPage owns the brand and title in its header; the gate (terms plus
        // acknowledgement) is the page body below it.
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
    test(`license gate fills ${viewport.width}x${viewport.height}`, async ({ page }) => {
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
        expect(bottomGap).toBeLessThanOrEqual(24);

        expect(layout.terms.top - layout.hero.bottom)
            .toBeCloseTo(layout.formGap + layout.heroMarginBottom, 0);
        expect(layout.acknowledgement.top - layout.terms.bottom)
            .toBeCloseTo(layout.gap, 0);
        expect(layout.terms.height).toBeGreaterThan(0);

        if (viewport.width === 1280) {
            expect(layout.terms.width).toBeGreaterThan(560);
            expect(Math.abs(layout.terms.left - layout.form.left))
                .toBeLessThanOrEqual(PIXEL_TOLERANCE);
            expect(Math.abs(layout.form.right - layout.terms.right))
                .toBeLessThanOrEqual(PIXEL_TOLERANCE);
        }

        await expectScrollGate(terms, acknowledgement);
    });
}
