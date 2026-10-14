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
    dismissIntroCarousel,
    expect,
    gotoSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { enterDemoWallet } from '../../fixtures/responsive.js';

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

test('demo Send opens at once with the inline demo note', async ({ page }) => {
    await gotoSection(page, 'Send');
    const main = page.getByRole('main');
    await expect(main.getByRole('form', { name: 'Send', exact: true })).toBeVisible({ timeout: 5_000 });
    const note = main.getByRole('status').filter({ hasText: /Demo wallets can't move funds/ });
    await expect(note).toHaveCount(1);
    await expect(note.getByRole('button', { name: 'Create a real wallet' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
});

test('the stale-balances Details open below the line without an inner scroller', async ({ page }) => {
    test.slow();
    // The dev services are not running here, so the reachability notice
    // appears once its startup grace ends.
    const message = page.getByRole('status').filter({ hasText: 'Some balances may be out of date' });
    await expect(message).toBeVisible({ timeout: 90_000 });
    const notice = message.locator('xpath=../..');
    await notice.getByRole('button', { name: 'Details' }).click();
    const panelId = await notice.getByRole('button', { name: 'Details' }).getAttribute('aria-controls');
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel).toBeVisible();

    const layout = await panel.evaluate((node) => {
        let strip = node.parentElement;
        while (strip && !/notices/.test(strip.className)) strip = strip.parentElement;
        const panelBox = node.getBoundingClientRect();
        const stripBox = strip?.getBoundingClientRect();
        return {
            panelBottom: panelBox.bottom,
            panelHeight: panelBox.height,
            stripBottom: stripBox?.bottom ?? 0,
            stripScrolls: strip ? strip.scrollHeight > strip.clientHeight + 1 : true,
        };
    });
    expect(layout.panelHeight).toBeGreaterThan(20);
    expect(layout.stripScrolls).toBe(false);
    expect(layout.panelBottom).toBeLessThanOrEqual(layout.stripBottom + 1);

    // The header menu opens over the notices, never under a notice panel.
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('menu', { name: 'Header actions' });
    await expect(menu).toBeVisible();
    const firstItem = menu.getByRole('menuitem').first();
    const onTop = await firstItem.evaluate((item) => {
        const box = item.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return Boolean(hit && item.contains(hit));
    });
    expect(onTop).toBe(true);
});
