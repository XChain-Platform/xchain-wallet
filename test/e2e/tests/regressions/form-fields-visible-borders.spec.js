// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    createWallet,
    expect,
    gotoSection,
    openSettings,
    test,
} from '../../fixtures/wallet.js';

const THEMES = ['light', 'dark'];
const VIEWPORTS = [
    { width: 360, height: 800 },
    { width: 1280, height: 800 },
];
const VISIBLE_FIELD_SELECTOR = [
    'input:not([type])',
    'input[type="text"]',
    'input[type="search"]',
    'input[type="email"]',
    'input[type="url"]',
    'input[type="tel"]',
    'input[type="password"]',
    'input[type="number"]',
    'input[type="date"]',
    'input[type="time"]',
    'input[type="month"]',
    'input[type="week"]',
    'input[type="datetime-local"]',
    'select',
    'textarea',
].map((selector) => `${selector}:visible`).join(', ');

async function gotoPaletteRoute(page, name) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(name);
    await palette.getByRole('option', { name: new RegExp(`^${name}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

async function expectVisibleFieldsHaveBorders(page, label) {
    const fields = page.locator(VISIBLE_FIELD_SELECTOR);
    await expect(fields.first(), `${label}: no visible text field, select, or textarea`).toBeVisible();

    const measurements = await fields.evaluateAll((elements) => {
        const shadowIsVisible = (value) => value !== 'none'
            && value.split(/,(?![^()]*\))/).some((layer) => {
                if (/\btransparent\b/i.test(layer)) return false;

                const rgba = layer.match(/rgba\(([^)]+)\)/i);
                if (rgba) {
                    const alpha = Number(rgba[1].split(',').at(-1).trim());
                    if (Number.isFinite(alpha) && alpha === 0) return false;
                }
                if (/\/(?:\s*)0(?:\.0+)?(?:\s*)\)/.test(layer)) return false;

                const lengths = layer.match(/-?(?:\d+\.?\d*|\.\d+)px/g) || [];
                return lengths.some((length) => Math.abs(Number.parseFloat(length)) > 0);
            });

        return elements.map((element) => {
            const style = getComputedStyle(element);
            const borders = {
                top: Number.parseFloat(style.borderTopWidth),
                right: Number.parseFloat(style.borderRightWidth),
                bottom: Number.parseFloat(style.borderBottomWidth),
                left: Number.parseFloat(style.borderLeftWidth),
            };
            const labelText = element.getAttribute('aria-label')
                || [...(element.labels || [])].map((item) => item.textContent.trim()).join(' ')
                || element.getAttribute('placeholder')
                || element.id
                || '(unlabelled)';

            return {
                element: element.tagName.toLowerCase(),
                type: element.getAttribute('type') || undefined,
                label: labelText,
                borders,
                boxShadow: style.boxShadow,
                outlined: Object.values(borders).some((width) => width >= 1)
                    || shadowIsVisible(style.boxShadow),
            };
        });
    });

    const offenders = measurements.filter(({ outlined }) => !outlined);
    expect(
        offenders,
        `${label}: visible fields without a 1px border or visible box shadow\n${JSON.stringify(measurements, null, 2)}`,
    ).toEqual([]);
}

async function expectInlineActionsInsideFields(page, label, requiredNames = []) {
    const result = await page.locator('body').evaluate((body) => {
        const textInputTypes = new Set([
            'text', 'search', 'email', 'url', 'tel', 'password', 'number',
            'date', 'time', 'month', 'week', 'datetime-local',
        ]);
        const visible = (element) => {
            const style = getComputedStyle(element);
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && style.visibility !== 'collapse'
                && element.getClientRects().length > 0;
        };
        const isField = (element) => element instanceof HTMLSelectElement
            || element instanceof HTMLTextAreaElement
            || (element instanceof HTMLInputElement && textInputTypes.has(element.type));
        const describe = (element) => element.getAttribute('aria-label')
            || [...(element.labels || [])].map((item) => item.textContent.trim()).join(' ')
            || element.getAttribute('placeholder')
            || element.id
            || element.tagName.toLowerCase();

        const actions = [...body.querySelectorAll('button')].filter((button) => (
            visible(button) && button.textContent.trim() === 'Max'
        ));
        const measurements = actions.map((button) => {
            let owner = button.parentElement;
            let fields = [];
            while (owner && owner !== body) {
                fields = [...owner.querySelectorAll('input, select, textarea')]
                    .filter((field) => isField(field) && visible(field));
                if (fields.length > 0) break;
                owner = owner.parentElement;
            }

            const buttonBox = button.getBoundingClientRect();
            const centerDistance = (field) => {
                const fieldBox = field.getBoundingClientRect();
                const dx = (fieldBox.left + fieldBox.right - buttonBox.left - buttonBox.right) / 2;
                const dy = (fieldBox.top + fieldBox.bottom - buttonBox.top - buttonBox.bottom) / 2;
                return (dx * dx) + (dy * dy);
            };
            const field = fields.sort((a, b) => centerDistance(a) - centerDistance(b))[0];
            const fieldBox = field?.getBoundingClientRect();
            const slack = 1;
            const inside = Boolean(fieldBox)
                && buttonBox.left >= fieldBox.left - slack
                && buttonBox.top >= fieldBox.top - slack
                && buttonBox.right <= fieldBox.right + slack
                && buttonBox.bottom <= fieldBox.bottom + slack;

            return {
                action: button.textContent.trim(),
                field: field ? describe(field) : null,
                inside,
                buttonBox: {
                    left: buttonBox.left,
                    top: buttonBox.top,
                    right: buttonBox.right,
                    bottom: buttonBox.bottom,
                },
                fieldBox: fieldBox ? {
                    left: fieldBox.left,
                    top: fieldBox.top,
                    right: fieldBox.right,
                    bottom: fieldBox.bottom,
                } : null,
            };
        });

        return {
            names: measurements.map(({ action }) => action),
            measurements,
        };
    });

    for (const name of requiredNames) {
        expect(result.names, `${label}: no visible ${name} field action`).toContain(name);
    }
    expect(
        result.measurements.filter(({ inside }) => !inside),
        `${label}: Max action escapes its field\n${JSON.stringify(result.measurements, null, 2)}`,
    ).toEqual([]);
}

async function checkScreen(page, label, requiredActions = []) {
    await expectVisibleFieldsHaveBorders(page, label);
    await expectInlineActionsInsideFields(page, label, requiredActions);
}

for (const theme of THEMES) {
    test.describe(`${theme} field borders`, () => {
        test.use({
            colorScheme: theme,
            viewport: VIEWPORTS[0],
        });

        test('form fields and inline actions retain visible outlines', async ({ page }) => {
            test.slow();
            // Demo wallets hide the Swap command, so this walk uses a real dev wallet.
            await createWallet(page);
            expect(await page.evaluate(() => (
                document.documentElement.getAttribute('data-xc-theme')
                || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            ))).toBe(theme);

            for (const viewport of VIEWPORTS) {
                await page.setViewportSize(viewport);
                const context = `${theme} at ${viewport.width}x${viewport.height}`;

                await test.step(`${context} / Send`, async () => {
                    await gotoSection(page, 'Send');
                    await expect(page.getByRole('heading', { name: 'Send', exact: true })).toBeVisible();
                    await checkScreen(page, `${context} / Send`, ['Max']);
                });

                await test.step(`${context} / Swap`, async () => {
                    await gotoPaletteRoute(page, 'Swap');
                    await expect(page.getByRole('heading', { name: 'Swap tokens', exact: true })).toBeVisible();
                    await checkScreen(page, `${context} / Swap`, ['Max']);
                });

                await test.step(`${context} / Receive`, async () => {
                    await gotoSection(page, 'Receive');
                    await expect(page.getByRole('heading', { name: 'Receive', exact: true })).toBeVisible();
                    await checkScreen(page, `${context} / Receive`);
                });

                await test.step(`${context} / Settings search`, async () => {
                    await openSettings(page);
                    await expect(page.getByRole('searchbox', { name: 'Search settings' })).toBeVisible();
                    await checkScreen(page, `${context} / Settings search`);
                });

                await test.step(`${context} / Contacts`, async () => {
                    await gotoSection(page, 'Contacts');
                    await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible();
                    await checkScreen(page, `${context} / Contacts`);
                });

                await test.step(`${context} / Addresses`, async () => {
                    await gotoPaletteRoute(page, 'Addresses');
                    await expect(page.getByRole('heading', { name: 'Addresses', exact: true })).toBeVisible();
                    await checkScreen(page, `${context} / Addresses`);
                });
            }
        });
    });
}
