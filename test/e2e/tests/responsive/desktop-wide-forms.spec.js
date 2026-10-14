// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { documentOverflow, enterDemoWallet } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'wide desktop', width: 1920, height: 1080 },
];
const CONTROL_SELECTOR = [
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])',
    'select',
    'textarea',
    'button[aria-haspopup="listbox"]',
].join(', ');
const PIXEL_TOLERANCE = 1;

async function settle(page) {
    await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('combobox').first().fill(title);
    const option = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(option, `no palette command matching "${title}"`).toBeVisible();
    await option.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function expectNoHorizontalOverflow(page, label) {
    await settle(page);
    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: the document is ${scrollWidth}px wide in a ${clientWidth}px viewport`,
    ).toBeLessThanOrEqual(clientWidth + PIXEL_TOLERANCE);
}

async function expectAlignedForm(form, label) {
    await expect(form).toBeVisible({ timeout: 30_000 });
    await expect(
        form.locator(CONTROL_SELECTOR).nth(1),
        `${label}: the form did not finish rendering two controls`,
    ).toBeVisible({ timeout: 30_000 });
    await form.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const geometry = await form.evaluate((element, selector) => {
        const visible = (node) => {
            const style = getComputedStyle(node);
            const box = node.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && box.width > 0
                && box.height > 0;
        };
        const describe = (node) => node.getAttribute('aria-label')
            || node.getAttribute('name')
            || node.id
            || node.tagName.toLowerCase();
        const controls = [...element.querySelectorAll(selector)]
            .filter(visible)
            .map((control) => ({
                name: describe(control),
                left: control.getBoundingClientRect().left,
            }));
        const labelPairs = [...element.querySelectorAll('label[for]')]
            .flatMap((fieldLabel) => {
                const control = document.getElementById(fieldLabel.htmlFor);
                if (!control || !element.contains(control) || !control.matches(selector)
                    || !visible(fieldLabel) || !visible(control)) return [];
                return [{
                    name: fieldLabel.textContent.trim(),
                    labelLeft: fieldLabel.getBoundingClientRect().left,
                    controlLeft: control.getBoundingClientRect().left,
                }];
            });
        return { controls, labelPairs };
    }, CONTROL_SELECTOR);

    expect(geometry.controls.length, `${label}: fewer than two form controls were measurable`)
        .toBeGreaterThanOrEqual(2);
    const leftEdges = geometry.controls.map(({ left }) => left);
    const spread = Math.max(...leftEdges) - Math.min(...leftEdges);
    expect(
        spread,
        `${label}: form controls do not share a left edge: ${JSON.stringify(geometry.controls)}`,
    ).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    expect(geometry.labelPairs.length, `${label}: no visible label and input pair was measurable`)
        .toBeGreaterThan(0);
    for (const pair of geometry.labelPairs) {
        expect(
            Math.abs(pair.labelLeft - pair.controlLeft),
            `${label}: label and control do not align for "${pair.name}"`,
        ).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    }
}

async function buttonHeight(button) {
    await expect(button).toBeVisible({ timeout: 30_000 });
    return button.evaluate((element) => element.getBoundingClientRect().height);
}

async function expectTermsUseContentWidth(terms, label) {
    const widths = await terms.evaluate((element) => {
        const content = element.closest('[data-settings-layout="responsive"]');
        if (!content) return null;
        return {
            terms: element.getBoundingClientRect().width,
            content: content.getBoundingClientRect().width,
        };
    });
    expect(widths, `${label}: the license text is outside the settings content area`).not.toBeNull();
    expect(widths.content, `${label}: the settings content area has no width`).toBeGreaterThan(0);
    expect(
        widths.terms / widths.content,
        `${label}: license text uses ${Math.round((widths.terms / widths.content) * 100)}% of the content width`,
    ).toBeGreaterThanOrEqual(0.6);
}

test('desktop forms use the available width and keep shared geometry', async ({ page }) => {
    test.slow();
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        let primaryHeight;
        await test.step(`${viewport.name} / Send`, async () => {
            await gotoSection(page, 'Send');
            const form = page.getByRole('form', { name: 'Send', exact: true });
            await expectAlignedForm(form, `${viewport.name} Send`);
            primaryHeight = await buttonHeight(form.getByRole('button', { name: 'Send', exact: true }));
            await expectNoHorizontalOverflow(page, `${viewport.name} Send`);
        });

        await test.step(`${viewport.name} / Receive`, async () => {
            await gotoSection(page, 'Receive');
            const form = page.getByRole('form', { name: 'Receive payment', exact: true });
            await expectAlignedForm(form, `${viewport.name} Receive`);
            const secondary = form.getByRole('button', {
                name: /^Copy (QR code|payment link)$/,
            }).first();
            const secondaryHeight = await buttonHeight(secondary);
            expect(
                Math.abs(primaryHeight - secondaryHeight),
                `${viewport.name}: primary and secondary buttons have different heights`,
            ).toBeLessThanOrEqual(PIXEL_TOLERANCE);
            await expectNoHorizontalOverflow(page, `${viewport.name} Receive`);
        });

        await test.step(`${viewport.name} / Create token`, async () => {
            await gotoPalette(page, 'Create a token');
            await expect(page.getByRole('heading', { name: 'Issue a token', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            await page.getByRole('button', { name: /^Custom\b/ }).click();
            const form = page.getByRole('form', { name: 'Choose token chain', exact: true });
            await expectAlignedForm(form, `${viewport.name} Create token`);
            await expectNoHorizontalOverflow(page, `${viewport.name} Create token`);
        });

        await test.step(`${viewport.name} / Create dispenser`, async () => {
            await gotoPalette(page, 'Create dispenser');
            const form = page.getByRole('form', { name: 'Create dispenser', exact: true });
            await expectAlignedForm(form, `${viewport.name} Create dispenser`);
            await expectNoHorizontalOverflow(page, `${viewport.name} Create dispenser`);
        });

        await test.step(`${viewport.name} / Settings security`, async () => {
            await gotoSection(page, 'Settings');
            await page.getByRole('main').getByRole('button', { name: /^Safety\b/ }).click();
            await expect(page.getByRole('heading', { name: 'Safety', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            await expectNoHorizontalOverflow(page, `${viewport.name} Settings security`);
        });

        await test.step(`${viewport.name} / license or terms`, async () => {
            await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
            await page.getByRole('main').getByRole('button', { name: /^About\b/ }).click();
            await expect(page.getByRole('heading', { name: 'About', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            await page.getByRole('button', { name: 'Show full text', exact: true }).click();
            const terms = page.locator('#full-license-text');
            await expect(terms).toBeVisible();
            await expectTermsUseContentWidth(terms, `${viewport.name} license or terms`);
            await expectNoHorizontalOverflow(page, `${viewport.name} license or terms`);
        });
    }
});
