// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings pages whose current layouts need checks beyond the broad form sweep:
// Notifications keeps event switches on its group page and opens the price-alert
// list and add form; Automatic Donations is one wallet-wide notice plus Donation
// and Totals list cards; Network endpoints appears only in Developer mode; and
// Keyboard is absent at phone width. Each is checked at phone and desktop sizes.

import {
    createWallet, expect, openAutomaticDonations, openSettings, test,
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

        test('Notifications keeps price alerts in its group and opens their form', async ({ page }) => {
            await createWallet(page);
            await openSettings(page);
            const main = page.getByRole('main');
            // The app header's bell is also named Notifications; the row is in main.
            await main.getByRole('button', { name: /^Notifications\b/ }).click();

            await expect(page.getByRole('heading', { level: 1, name: 'Notifications', exact: true })).toBeVisible();
            await expect(main.getByRole('switch', { name: 'Price alerts', exact: true })).toBeVisible();
            await expect(main.getByLabel('Target price', { exact: true })).toHaveCount(0);
            await expect(main.getByText(/Turn on Price alerts above/)).toHaveCount(0);
            await expectNoSidewaysScroll(page, `${size.name} Notifications`);

            await main.getByRole('button', { name: /^Your price alerts\b/ }).click();
            await expect(page.getByRole('heading', { level: 1, name: 'Price Alerts', exact: true })).toBeVisible();
            await expect(main.getByText('No price alerts yet', { exact: true })).toBeVisible();
            // A list page's create action is the title bar's plus (G95).
            await page.getByRole('banner').getByRole('button', { name: 'Add Price Alert', exact: true }).click();

            const priceField = main.getByLabel('Target price', { exact: true });
            await expect(priceField).toBeVisible();
            await expectBorderedLabelledFields(main, `${size.name} Add Price Alert`);
            await expectNoSidewaysScroll(page, `${size.name} Add Price Alert`);

            // The currency unit (USD, inside the field's trailing slot) stays on the field's row.
            const field = await priceField.boundingBox();
            const symbol = await main.getByText('USD', { exact: true }).last().boundingBox();
            expect(Math.abs((symbol.y + symbol.height / 2) - (field.y + field.height / 2)),
                `${size.name}: the currency symbol is stranded from its field`).toBeLessThan(field.height / 2);
        });

        test('Automatic Donations uses one notice and wallet-wide list cards', async ({ page }) => {
            await createWallet(page);
            await openAutomaticDonations(page);
            const main = page.getByRole('main');
            await expect(page.getByRole('heading', { level: 1, name: 'Automatic Donations', exact: true })).toBeVisible();
            await expect(main.getByTestId('ads-hero')).toBeVisible();
            await expect(main.getByRole('list', { name: 'Donation', exact: true })).toBeVisible();
            await expect(main.getByRole('list', { name: 'Totals', exact: true })).toBeVisible();
            await expect(main.getByRole('combobox', { name: 'Per transaction', exact: true })).toBeVisible();
            await expect(main.getByRole('combobox', { name: 'Send at', exact: true })).toBeVisible();
            await expect(main.getByRole('combobox', { name: 'Donate to', exact: true })).toBeVisible();
            await expect(main.getByText(/outgoing transactions? to reach the threshold/)).toHaveCount(0);
            await expectNoSidewaysScroll(page, `${size.name} Automatic Donations`);
        });

        test('Network & endpoints fields are bordered, labelled and one height', async ({ page }) => {
            await createWallet(page);
            await openSettings(page);
            await page.getByRole('button', { name: /^Advanced\b/ }).click();
            // Developer mode is a switch on the Advanced page's own row.
            const toggle = page.getByRole('switch', { name: 'Developer mode', exact: true });
            await toggle.click();
            await expect(toggle).toBeChecked();
            // Back once: the Advanced group page to the index.
            const backToSettings = page.getByRole('button', { name: 'Back to settings', exact: true }).filter({ visible: true }).first();
            await backToSettings.click();
            await page.getByRole('button', { name: /^Network and Fees\b/ }).click();
            await page.getByRole('button', { name: /^Network endpoints\b/ }).click();
            // Endpoints is a list of networks; each network's page holds its fields.
            await page.getByRole('main').getByRole('button', { name: /^Bitcoin\b/ }).first().click();
            await expect(page.getByLabel('Explorer URL').first()).toBeVisible();

            await expectBorderedLabelledFields(page.getByRole('main'), `${size.name} Network & endpoints`);
            await expectNoSidewaysScroll(page, `${size.name} Network & endpoints`);
        });

        test('Keyboard is offered where there is a keyboard and its rows fit', async ({ page }) => {
            await createWallet(page);
            await openSettings(page);
            await page.getByRole('button', { name: /^Advanced\b/ }).click();
            const row = page.getByRole('button', { name: /^Keyboard shortcuts\b/ });
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
