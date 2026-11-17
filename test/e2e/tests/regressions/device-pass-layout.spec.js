// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Device pass findings on the final layout branch: the Receive address was
// hard-clipped to one line, the parked skip link showed behind the status
// bar, and demo Send sat on Loading instead of saying demo wallets cannot
// send.

import {
    createWallet,
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

test.describe('demo wallet', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    });

    test('Receive shows the whole address without clipping it', async ({ page }) => {
        await gotoSection(page, 'Receive');
        const preview = page.getByRole('main').locator('[class*="readOnlyValue"] > span').first();
        await expect(preview).toBeVisible();
        const metrics = await preview.evaluate((node) => ({
            text: node.textContent,
            full: node.getAttribute('aria-label'),
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            whiteSpace: getComputedStyle(node).whiteSpace,
        }));
        expect(metrics.full?.length ?? 0).toBeGreaterThan(25);
        expect(metrics.text).toBe(metrics.full);
        expect(metrics.whiteSpace).not.toBe('nowrap');
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    });

    test('the parked skip link takes no visible space until it is focused', async ({ page }) => {
        const skip = page.getByRole('link', { name: 'Skip to main content' });
        await expect(skip).toHaveCount(1);
        const parked = await skip.boundingBox();
        expect((parked?.width ?? 0) * (parked?.height ?? 0)).toBeLessThanOrEqual(1);

        await skip.focus();
        const focused = await skip.boundingBox();
        expect(focused?.width ?? 0).toBeGreaterThan(40);
        expect(focused?.y ?? -1).toBeGreaterThanOrEqual(0);
    });

    test('demo Send opens at once with no demo notice and refuses the press', async ({ page }) => {
        await gotoSection(page, 'Send');
        const main = page.getByRole('main');
        await expect(main.getByRole('form', { name: 'Send', exact: true })).toBeVisible({ timeout: 5_000 });
        await expect(main.getByText(/Demo wallets can't move funds/)).toHaveCount(0);
        const send = main.getByRole('button', { name: 'Send', exact: true });
        await expect(send).toBeEnabled();
        await send.click();
        const refusal = main.getByTestId('demo-guard-refusal');
        await expect(refusal).toContainText(/Demo wallets can't move funds/);
        await expect(refusal.getByRole('button', { name: /Create a real wallet/i })).toBeVisible();
    });

    test('a demo wallet never shows the out-of-date notice', async ({ page }) => {
        test.slow();
        // The real-wallet test below proves the notice appears within this wait.
        await page.waitForTimeout(45_000);
        await expect(page.getByText(/Some information may be out of date/)).toHaveCount(0);
    });

    test('Home has no quick action tiles at desktop width', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await gotoSection(page, 'Home');
        await expect(page.getByRole('main')).toBeVisible();
        await expect(page.getByRole('group', { name: 'Quick actions' })).toHaveCount(0);
    });
});

test.describe('real wallet', () => {
    test('does not show a degraded reachability notice', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 390, height: 844 });
        await createWallet(page);
        await page.waitForTimeout(45_000);
        await expect(page.getByText(/Some information may be out of date/)).toHaveCount(0);
    });

    test('keeps the degraded reachability notice off after a route change', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 390, height: 844 });
        await createWallet(page);
        await page.waitForTimeout(45_000);
        await expect(page.getByText(/Some information may be out of date/)).toHaveCount(0);
        await gotoSection(page, 'Receive');
        await expect(page.getByText(/Some information may be out of date/)).toHaveCount(0);
    });
});
