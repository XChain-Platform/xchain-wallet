// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Scan page's "camera unavailable" and "camera failed" panels are the shared
// StatusMessage: one message per state, the first thing in the page content, with
// the tone and live-region role its state calls for.

import { createWallet, expect, test, gotoSection } from '../../fixtures/wallet.js';

const SHOTS = process.env.XC_SHOT_DIR || '';

async function shot(page, name) {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

for (const size of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) {
    test.describe(`Scan panels at ${size.width}x${size.height}`, () => {
        test.use({ viewport: size });

        test('an unsupported camera is one warning message at the top of the page', async ({ page }) => {
            await page.addInitScript(() => { delete window.BarcodeDetector; });
            await createWallet(page);
            await gotoSection(page, 'Scan');
            const panel = page.getByTestId('qr-scanner-unsupported');
            await expect(panel).toBeVisible();
            await shot(page, `scan-unsupported-${size.width}`);
            await expect(panel).toHaveAttribute('data-variant', 'warning');
            await expect(panel).toHaveAttribute('role', 'status');
            await expect(page.locator('[data-testid="scan-route"] [data-variant]')).toHaveCount(1);
            const first = await page.getByTestId('scan-route').evaluate(
                (form) => form.querySelector('[data-variant], textarea, input, button')?.closest('[data-testid]')?.getAttribute('data-testid') || '',
            );
            expect(first).toBe('qr-scanner-unsupported');
        });

        test('a camera that fails to start is one error message with an alert role', async ({ page }) => {
            await page.addInitScript(() => {
                window.BarcodeDetector = class { async detect() { return []; } };
                Object.defineProperty(navigator, 'mediaDevices', {
                    configurable: true,
                    value: { getUserMedia: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' })) },
                });
            });
            await createWallet(page);
            await gotoSection(page, 'Scan');
            const cont = page.getByRole('button', { name: 'Continue' });
            if (await cont.count()) await cont.first().click();
            const alert = page.getByTestId('scan-route').getByRole('alert');
            await expect(alert).toHaveCount(1);
            await shot(page, `scan-error-${size.width}`);
            await expect(alert).toHaveAttribute('data-variant', 'error');
        });
    });
}
