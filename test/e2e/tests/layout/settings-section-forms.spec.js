// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Settings sections a form sweep could not "open": Keyboard (not offered
// at phone width, where there is no hardware keyboard), Notifications (a panel
// on the settings page itself, not a drill-down row) and Network & endpoints
// (offered only once Developer mode is on). Each is checked at a phone and a
// desktop size against the form rulings: bordered fields of one height, a
// visible label on every field, no sideways page scroll, and one message per
// state.

import {
    createWallet, expect, openSettings, test,
} from '../../fixtures/wallet.js';

const SIZES = [
    { name: '360x800', width: 360, height: 800 },
    { name: '1440x900', width: 1440, height: 900 },
];

/** Border width, height and label of every text-like field inside `scope`. */
function readFields(scope) {
    return scope.evaluate((root) => [...root.querySelectorAll('input, select, textarea')]
        .filter((el) => !['hidden', 'checkbox', 'radio', 'file'].includes(el.type))
        .map((el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const labelled = el.getAttribute('aria-label')
                || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent)
                || el.closest('label')?.textContent
                || '';
            return {
                label: labelled.trim(),
                border: parseFloat(style.borderTopWidth) || 0,
                borderStyle: style.borderTopStyle,
                height: Math.round(rect.height),
                width: Math.round(rect.width),
            };
        }));
}

async function expectBorderedLabelledFields(scope, what) {
    const fields = await readFields(scope);
    expect(fields.length, `${what}: no fields found`).toBeGreaterThan(0);
    for (const field of fields) {
        expect(field.border, `${what}: "${field.label}" has no border`).toBeGreaterThanOrEqual(1);
        expect(field.borderStyle, `${what}: "${field.label}" border style`).toBe('solid');
        expect(field.label, `${what}: a field has no label`).not.toBe('');
        expect(field.height, `${what}: "${field.label}" height`).toBe(36);
    }
}

async function expectNoSidewaysScroll(page, what) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${what}: the page scrolls sideways`).toBeLessThanOrEqual(0);
}

for (const size of SIZES) {
    test.describe(`settings section forms at ${size.name}`, () => {
        test.use({ viewport: { width: size.width, height: size.height } });

        test('Notifications fields are bordered and one height, and alerts-off says one thing', async ({ page }) => {
            await createWallet(page);
            await openSettings(page);

            await page.getByRole('switch', { name: 'Price alerts' }).scrollIntoViewIfNeeded();
            const priceField = page.getByLabel('Target price', { exact: true });
            await expect(priceField).toBeVisible();

            await expectBorderedLabelledFields(page.getByRole('main'), `${size.name} Notifications`);
            await expectNoSidewaysScroll(page, `${size.name} Notifications`);

            // The currency symbol stays on its field's row.
            const field = await priceField.boundingBox();
            const symbol = await page.getByText('$', { exact: true }).last().boundingBox();
            expect(Math.abs((symbol.y + symbol.height / 2) - (field.y + field.height / 2)),
                `${size.name}: the currency symbol is stranded from its field`).toBeLessThan(field.height / 2);

            // Alerts are off: the reason is the one message, not an empty-list line too.
            await expect(page.getByText(/Turn on Price alerts above/)).toBeVisible();
            await expect(page.getByText('No price alerts yet', { exact: true })).toHaveCount(0);
        });

        test('Network & endpoints fields are bordered, labelled and one height', async ({ page }) => {
            await createWallet(page);
            await openSettings(page);
            await page.getByRole('button', { name: /^Developer mode/ }).click();
            const toggle = page.getByRole('switch', { name: 'Turn on developer mode', exact: true });
            await toggle.click();
            await expect(toggle).toBeChecked();
            await page.getByRole('button', { name: 'Back to settings' }).click();
            await page.getByRole('button', { name: /^Network & endpoints/ }).click();
            await expect(page.getByLabel('Explorer URL').first()).toBeVisible();

            await expectBorderedLabelledFields(page.getByRole('main'), `${size.name} Network & endpoints`);
            await expectNoSidewaysScroll(page, `${size.name} Network & endpoints`);
        });

        test('Keyboard is offered where there is a keyboard and its rows fit', async ({ page }) => {
            await createWallet(page);
            await openSettings(page);
            const row = page.getByRole('button', { name: /^Keyboard/ });
            if (size.width < 480) {
                await expect(row).toHaveCount(0);
                return;
            }
            await row.click();
            await expect(page.getByRole('button', { name: 'Rebind' }).first()).toBeVisible();
            await expectNoSidewaysScroll(page, `${size.name} Keyboard`);
        });
    });
}
