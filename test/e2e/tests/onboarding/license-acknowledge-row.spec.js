// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from '../../fixtures/wallet.js';

test.use({ acceptLicense: false });

const VIEWPORTS = [
    { name: 'phone portrait', width: 360, height: 800 },
    { name: 'phone landscape', width: 844, height: 390 },
    { name: 'desktop', width: 1280, height: 800 },
];

const ACCEPT = 'Accept and continue';
const PIXEL_TOLERANCE = 1;

async function measureAcknowledgement(checkbox) {
    return checkbox.evaluate((input) => {
        const row = input.closest('label');
        const box = input.nextElementSibling;
        const text = box.nextElementSibling.firstElementChild;
        const rect = (element) => {
            const bounds = element.getBoundingClientRect();
            return {
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom,
                left: bounds.left,
                width: bounds.width,
                height: bounds.height,
            };
        };

        return {
            row: rect(row),
            box: rect(box),
            text: rect(text),
            textClientWidth: text.clientWidth,
            textScrollWidth: text.scrollWidth,
            lineHeight: Number.parseFloat(getComputedStyle(text).lineHeight),
        };
    });
}

async function scrollTermsToEnd(terms) {
    await terms.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
}

for (const viewport of VIEWPORTS) {
    test(`license acknowledgement row fits at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/');

        const form = page.getByRole('form', { name: 'License agreement' });
        const terms = page.getByLabel('License terms');
        const checkbox = page.getByRole('checkbox');
        const accept = page.getByRole('button', { name: ACCEPT });

        await expect(form).toBeVisible();
        await expect(terms).toBeVisible();
        await expect(checkbox).toHaveCount(1);
        await expect(checkbox).not.toBeChecked();
        await expect(accept).toBeVisible();
        await form.evaluate(async (element) => {
            await document.fonts.ready;
            await Promise.allSettled(
                element.getAnimations({ subtree: true }).map((animation) => animation.finished),
            );
        });

        if (viewport.name === 'desktop') {
            const widths = await form.evaluate((element) => {
                const termsPanel = element.querySelector('[aria-label="License terms"]');
                const paragraphs = [...termsPanel.querySelectorAll('p')];
                return {
                    form: element.getBoundingClientRect().width,
                    terms: termsPanel.getBoundingClientRect().width,
                    narrowestParagraph: Math.min(
                        ...paragraphs.map((paragraph) => paragraph.getBoundingClientRect().width),
                    ),
                };
            });
            expect(widths.terms).toBeGreaterThanOrEqual(widths.form * 0.9);
            expect(widths.narrowestParagraph).toBeGreaterThanOrEqual(widths.terms * 0.9);
        }

        const buttonBox = await accept.boundingBox();
        expect(buttonBox).not.toBeNull();
        expect(viewport.height - buttonBox.y - buttonBox.height)
            .toBeGreaterThanOrEqual(-PIXEL_TOLERANCE);
        expect(viewport.height - buttonBox.y - buttonBox.height).toBeLessThanOrEqual(24);

        await expect(accept).toBeDisabled();

        const requiresScroll = await terms.evaluate(
            (element, tolerance) => element.scrollHeight > element.clientHeight + tolerance,
            PIXEL_TOLERANCE,
        );
        if (requiresScroll) {
            await expect(checkbox).toBeDisabled();
            await terms.evaluate((element) => {
                const maximum = element.scrollHeight - element.clientHeight;
                element.scrollTop = Math.max(0, maximum - 12);
                element.dispatchEvent(new Event('scroll', { bubbles: true }));
            });
            await expect(checkbox).toBeDisabled();
            await expect(accept).toBeDisabled();
        }

        await scrollTermsToEnd(terms);
        await expect(checkbox).toBeEnabled();
        await expect(checkbox).toHaveAccessibleName('I have read and agree to these terms.');
        await expect(accept).toBeDisabled();

        const acknowledgement = await measureAcknowledgement(checkbox);
        expect(acknowledgement.text.left)
            .toBeGreaterThanOrEqual(acknowledgement.box.right - PIXEL_TOLERANCE);
        expect(acknowledgement.text.right)
            .toBeLessThanOrEqual(acknowledgement.row.right + PIXEL_TOLERANCE);
        expect(acknowledgement.textScrollWidth)
            .toBeLessThanOrEqual(acknowledgement.textClientWidth + PIXEL_TOLERANCE);
        expect(acknowledgement.text.height)
            .toBeLessThanOrEqual(acknowledgement.lineHeight + PIXEL_TOLERANCE);

        await checkbox.check();
        await expect(accept).toBeEnabled();
    });
}
