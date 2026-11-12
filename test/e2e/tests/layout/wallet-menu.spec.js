// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, expect, test } from '../../fixtures/wallet.js';

const VIEWPORTS = [
    { width: 390, height: 844, columns: 2 },
    { width: 834, height: 1112, columns: 4 },
    { width: 1280, height: 800, columns: 4 },
];

const menuDialog = (page) => page.getByRole('dialog', { name: 'Wallet menu' });

async function openMenu(page) {
    const opener = page.getByRole('region', { name: 'App header' })
        .getByRole('button', { name: 'Open menu' });
    await opener.click();
    const dialog = menuDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-wallet-menu', '');
    return { dialog, opener };
}

async function groupPositions(dialog) {
    return dialog.locator('[data-wallet-menu-group]').evaluateAll((groups) => Object.fromEntries(
        groups.map((group) => [
            group.getAttribute('data-wallet-menu-group'),
            Math.round(group.getBoundingClientRect().x),
        ]),
    ));
}

async function expectNoUnreadMarkers(scope, label) {
    const markers = scope.locator([
        '[aria-label*="unread" i]',
        '[aria-label*="pending" i]',
        '[class*="badge" i]',
        '[data-unread]',
        '[data-badge]',
    ].join(', '));
    await expect(markers, `${label} contains no unread dot or count`).toHaveCount(0);
}

test('wallet menu lays out its catalogue, searches, and provides compact navigation', async ({ page }) => {
    await createWallet(page, { name: 'Menu layout wallet' });

    for (const viewport of VIEWPORTS) {
        await test.step(`${viewport.width}x${viewport.height}`, async () => {
            await page.setViewportSize(viewport);
            const { dialog, opener } = await openMenu(page);
            const groups = dialog.locator('[data-wallet-menu-group]');
            await expect(groups).toHaveCount(4);
            for (const id of ['wallet', 'trade', 'manage', 'people']) {
                const group = dialog.locator(`[data-wallet-menu-group="${id}"]`);
                await expect(group).toBeVisible();
                await expect(group).toHaveCSS('border-top-width', '1px');
                await expect(group).toHaveCSS('border-top-style', 'solid');
            }

            const positions = await groupPositions(dialog);
            expect(new Set(Object.values(positions)).size, 'the menu uses the expected group columns')
                .toBe(viewport.columns);
            if (viewport.columns === 2) {
                expect(positions.wallet).toBe(positions.people);
                expect(positions.trade).toBe(positions.manage);
                expect(positions.wallet).not.toBe(positions.trade);
            }

            await expect(dialog.locator('[data-wallet-menu-row="settings"]')).toHaveAccessibleName('Settings');
            await expect(dialog.locator('[data-wallet-menu-row="lock"]')).toHaveAccessibleName('Lock wallet');
            const titlePainted = await dialog.getByText('Wallet menu', { exact: true }).evaluateAll((elements) => (
                elements.some((element) => {
                    const style = getComputedStyle(element);
                    const box = element.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden'
                        && box.width > 1 && box.height > 1
                        && style.clip === 'auto' && style.clipPath === 'none';
                })
            ));
            expect(titlePainted, 'the accessible heading stays visually hidden').toBe(false);
            await expectNoUnreadMarkers(opener, 'the header menu button');
            await expectNoUnreadMarkers(dialog, 'the wallet menu');

            const leftNav = page.getByRole('navigation', { name: 'Primary navigation' });
            if (await leftNav.count() > 0) await expectNoUnreadMarkers(leftNav, 'the left navigation');
            const bottomBar = page.getByRole('navigation', { name: 'Bottom navigation' });
            if (await bottomBar.count() > 0) await expectNoUnreadMarkers(bottomBar, 'the bottom navigation');

            if (viewport.width === 390) {
                const fit = await dialog.evaluate((node) => {
                    const box = node.getBoundingClientRect();
                    const scrollable = [node, ...node.querySelectorAll('*')].filter((element) => {
                        const style = getComputedStyle(element);
                        return /(auto|scroll)/.test(style.overflowY)
                            && element.scrollHeight > element.clientHeight + 1;
                    });
                    return {
                        withinViewport: box.top >= 0 && box.bottom <= window.innerHeight + 1,
                        scrollableCount: scrollable.length,
                    };
                });
                expect(fit.withinViewport, 'the phone menu fits inside the viewport').toBe(true);
                expect(fit.scrollableCount, 'the phone menu has no scrollable overflow').toBe(0);

                const tabs = bottomBar.locator('[data-bottom-tab]');
                await expect(tabs).toHaveCount(5);
                for (const [index, label] of ['Home', 'Send', 'Receive', 'History', 'Settings'].entries()) {
                    await expect(tabs.nth(index)).toHaveAccessibleName(label);
                }
                await expect(bottomBar.locator('[data-bottom-tab="more"]')).toHaveCount(0);
            }

            await page.keyboard.press('Escape');
            await expect(dialog).toBeHidden();
        });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const { dialog } = await openMenu(page);
    await dialog.getByRole('combobox').fill('set');
    const firstResult = dialog.getByRole('option').first();
    await expect(firstResult).toContainText('Settings');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

    await page.keyboard.press('ControlOrMeta+k');
    await expect(menuDialog(page)).toBeVisible();
});
