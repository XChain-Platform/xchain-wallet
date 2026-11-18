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
    createWallet,
    expect,
    gotoSection,
    openFromSection,
    test,
} from '../../fixtures/wallet.js';
import { documentOverflow } from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'wide desktop', width: 1920, height: 1080 },
];
const CONTROL_SELECTOR = [
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])',
    'select',
    'textarea',
    'button[aria-haspopup="listbox"]',
    // The Network field opens the network picker screen (ruling U59).
    'button[aria-haspopup="dialog"][aria-label^="Network"]',
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
    const dialog = page.getByRole('dialog', { name: 'Wallet menu' });
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
    // The Form Standard's From section starts closed; open it only when the form shows fewer than two controls without it.
    if (!(await form.locator(CONTROL_SELECTOR).nth(1).isVisible())
        && await form.getByRole('button', { name: /^(?:From|Signing with)\b/ }).count()) await openFromSection(form);
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
        const groups = new Map();
        const groupOf = (control) => {
            let node = control.parentElement;
            while (node && node !== element && parseFloat(getComputedStyle(node).borderLeftWidth) === 0) node = node.parentElement;
            if (!groups.has(node)) groups.set(node, groups.size);
            return groups.get(node);
        };
        const controls = [...element.querySelectorAll(selector)]
            .filter(visible)
            .map((control) => ({
                name: describe(control),
                left: control.getBoundingClientRect().left,
                // A section or nested group card (a bordered ancestor) insets its own controls.
                group: groupOf(control),
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
    for (const group of new Set(geometry.controls.map(({ group }) => group))) {
        const leftEdges = geometry.controls.filter((control) => control.group === group).map(({ left }) => left);
        const spread = Math.max(...leftEdges) - Math.min(...leftEdges);
        expect(
            spread,
            `${label}: form controls do not share a left edge: ${JSON.stringify(geometry.controls)}`,
        ).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    }

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

/**
 * About's License row is an external link (the full text is not an in-app
 * page): it opens the repository's LICENSE file in a new tab, and it spans
 * the settings content area like every other action row.
 */
async function expectLicenseIsExternalLink(page, label) {
    const row = page.getByRole('main').getByRole('link', { name: /^License\b/ }).first();
    await expect(row, `${label}: About has a License link`).toBeVisible();
    await expect(row, `${label}: the License link opens the LICENSE file`).toHaveAttribute('href', /^https:\/\/.*LICENSE\.md$/);
    await expect(row, `${label}: the License link opens in a new tab`).toHaveAttribute('target', '_blank');
    await expect(page.locator('#full-license-text'), `${label}: no in-app license text`).toHaveCount(0);
    const widths = await row.evaluate((element) => {
        const content = element.closest('[data-settings-layout="responsive"]');
        if (!content) return null;
        return { row: element.getBoundingClientRect().width, content: content.getBoundingClientRect().width };
    });
    expect(widths, `${label}: the License row is outside the settings content area`).not.toBeNull();
    expect(widths.row / widths.content, `${label}: the License row uses ${Math.round((widths.row / widths.content) * 100)}% of the content width`)
        .toBeGreaterThanOrEqual(0.6);
}

test('desktop forms use the available width and keep shared geometry', async ({ page }) => {
    test.slow();
    // Demo wallets hide the create commands, so this walk uses a real dev wallet.
    await createWallet(page);

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
            // Receive's actions are two-line list rows, so they are measured against each other.
            const copyHeight = await buttonHeight(form.getByRole('button', { name: /^Copy QR code\b/ }));
            const shareHeight = await buttonHeight(form.getByRole('button', { name: /^Share QR payment link\b/ }));
            expect(
                Math.abs(copyHeight - shareHeight),
                `${viewport.name}: the Receive action rows have different heights`,
            ).toBeLessThanOrEqual(PIXEL_TOLERANCE);
            expect(primaryHeight, `${viewport.name}: the Send button has no height`).toBeGreaterThan(0);
            await expectNoHorizontalOverflow(page, `${viewport.name} Receive`);
        });

        await test.step(`${viewport.name} / Create token`, async () => {
            await gotoPalette(page, 'Create a token');
            await expect(page.getByRole('heading', { name: 'Issue Token', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            // Create a token opens the full Issue form; its template is a field on it.
            const form = page.getByRole('form', { name: 'Issue Token', exact: true });
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
            await page.getByRole('main').getByRole('button', { name: /^Security\b/ }).click();
            await expect(page.getByRole('heading', { name: 'Security', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            await expectNoHorizontalOverflow(page, `${viewport.name} Settings security`);
        });

        await test.step(`${viewport.name} / license or terms`, async () => {
            await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
            // The top row of Settings, named for the product (2026-11-15).
            await page.getByRole('main').getByRole('button', { name: /^About\b/ }).click();
            await expect(page.getByRole('heading', { name: /^About\b/ }))
                .toBeVisible({ timeout: 30_000 });
            // The license is an external link, not an in-app page.
            await expectLicenseIsExternalLink(page, `${viewport.name} license or terms`);
            await expectNoHorizontalOverflow(page, `${viewport.name} license or terms`);
        });
    }
});
