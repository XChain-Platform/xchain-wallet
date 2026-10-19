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

    test('demo Send opens at once with the inline demo note', async ({ page }) => {
        await gotoSection(page, 'Send');
        const main = page.getByRole('main');
        await expect(main.getByRole('form', { name: 'Send', exact: true })).toBeVisible({ timeout: 5_000 });
        const note = main.getByRole('status').filter({ hasText: /Demo wallets can't move funds/ });
        await expect(note).toHaveCount(1);
        await expect(note.getByRole('button', { name: 'Create a real wallet' })).toBeVisible();
        await expect(main.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    });

    test('a demo wallet never shows the stale-balances notice', async ({ page }) => {
        test.slow();
        // The real-wallet test below proves the notice appears within this wait.
        await page.waitForTimeout(45_000);
        await expect(page.getByText('Some balances may be out of date')).toHaveCount(0);
    });

    test('Home quick-action tiles are outlined at desktop width', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await gotoSection(page, 'Home');
        const tiles = page.getByRole('group', { name: 'Quick actions' }).getByRole('button');
        await expect(tiles.first()).toBeVisible();
        const looks = await tiles.evaluateAll((buttons) => buttons.map((button) => {
            const style = getComputedStyle(button);
            const accent = getComputedStyle(document.documentElement).getPropertyValue('--xc-accent-primary').trim();
            const probe = document.createElement('span');
            probe.style.color = accent;
            document.body.append(probe);
            const accentRgb = getComputedStyle(probe).color;
            probe.remove();
            return { label: button.innerText.trim(), background: style.backgroundColor, accentRgb };
        }));
        for (const look of looks) {
            expect(look.background, `${look.label} tile must not be filled with the accent`).not.toBe(look.accentRgb);
        }
    });
});

test.describe('real wallet', () => {
    test('the stale-balances Details open below the line without an inner scroller', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 390, height: 844 });
        await createWallet(page);
        // The dev services are not running here, so the reachability notice
        // appears once its startup grace ends.
        const message = page.getByRole('status').filter({ hasText: 'Some balances may be out of date' });
        await expect(message).toBeVisible({ timeout: 90_000 });
        // Notices are page content, never toolbar content: the notice is in
        // the route's main region.
        await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'Some balances may be out of date' }))
            .toBeVisible();
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

    test('the stale-balances Details close when the route changes', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 390, height: 844 });
        await createWallet(page);
        const message = page.getByRole('status').filter({ hasText: 'Some balances may be out of date' });
        await expect(message).toBeVisible({ timeout: 90_000 });
        const toggle = message.locator('xpath=..').getByRole('button', { name: 'Details' });
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        // Settings, not History: an empty History in a wallet whose balances
        // could not be checked says so itself and the shell notice steps
        // aside there (one message per state), so it is not a route the
        // notice shows on.
        await gotoSection(page, 'Settings');
        // Settings holds no balance, so the same notice drops the word
        // balances.
        const settingsMessage = page.getByRole('status').filter({ hasText: 'Some information may be out of date' });
        await expect(settingsMessage).toBeVisible();
        await expect(settingsMessage.locator('xpath=..').getByRole('button', { name: 'Details' }))
            .toHaveAttribute('aria-expanded', 'false');
        // On a route with a page header the notice opens the scrolling
        // content below that header, never between the two toolbars.
        // Settings loads lazily; until its Screen mounts, the notice waits in
        // the route area's fallback slot, so poll for the settled placement.
        const placement = () => settingsMessage.evaluate((node) => {
            const main = node.closest('main');
            const pageHeader = main?.previousElementSibling;
            return {
                inMain: Boolean(main),
                firstInMain: Boolean(main?.firstElementChild?.contains(node)),
                belowPageHeader: pageHeader?.tagName === 'HEADER'
                    && pageHeader.getBoundingClientRect().bottom <= node.getBoundingClientRect().top + 1,
            };
        });
        await expect.poll(placement, { timeout: 15_000 })
            .toEqual({ inMain: true, firstInMain: true, belowPageHeader: true });
    });
});
