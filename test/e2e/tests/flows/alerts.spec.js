// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
    openSettings,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import { searchTokenPicker } from '../../fixtures/fields.js';
import { pickOption } from '../../fixtures/pickOption.js';
import {
    describeOffenders,
    documentOverflow,
    enterDemoWallet,
    overflowingElements,
} from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectScreen(page, label, heading) {
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    await settle(page);

    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: elements paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: document width ${scrollWidth}px exceeds its ${clientWidth}px viewport`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

async function expectScreenStartsAtTop(page, label) {
    const scrollTop = await page.getByRole('main').evaluate((main) => main.scrollTop);
    expect(scrollTop, `${label}: the screen did not open at the top`).toBeLessThanOrEqual(1);
}

async function expectSharedLineControlHeights(controls, label) {
    const lines = await controls.evaluateAll((nodes) => {
        const rendered = nodes
            .map((node) => {
                const box = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return {
                    label: node.getAttribute('aria-label') || node.textContent?.trim() || node.tagName,
                    height: box.height,
                    middle: box.top + (box.height / 2),
                    visible: box.width > 0 && box.height > 0
                        && style.display !== 'none' && style.visibility !== 'hidden',
                };
            })
            .filter((item) => item.visible);

        const grouped = [];
        for (const control of rendered) {
            const line = grouped.find((candidate) => Math.abs(candidate.middle - control.middle) <= 2);
            if (line) {
                line.controls.push(control);
            } else {
                grouped.push({ middle: control.middle, controls: [control] });
            }
        }
        return grouped.filter((line) => line.controls.length > 1).map((line) => line.controls);
    });

    expect(lines.length, `${label}: no shared control line was rendered`).toBeGreaterThan(0);
    for (const line of lines) {
        const heights = line.map((control) => control.height);
        const difference = Math.max(...heights) - Math.min(...heights);
        expect(
            difference,
            `${label}: controls on one line differ by ${difference}px: ${JSON.stringify(line)}`,
        ).toBeLessThanOrEqual(2);
    }
}

for (const viewport of VIEWPORTS) {
    test(`alerts and price alerts render and update at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // Notification toggles stay disabled until the browser grants delivery;
        // headless Chromium reports notifications as blocked even after a grant,
        // so the page also sees a granted permission from the start.
        await page.context().grantPermissions(['notifications']);
        await page.addInitScript(() => {
            try {
                Object.defineProperty(window.Notification, 'permission', { get: () => 'granted' });
            } catch { /* keep the browser's own value */ }
        });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

        await test.step('publish a wallet alert from the seeded demo inbox', async () => {
            await gotoSection(page, 'Messaging');
            await expect(page.getByRole('heading', { level: 1, name: 'Messaging' })).toBeVisible();
            await expect(page.getByRole('list', { name: 'Conversations' })).toBeVisible();
        });

        await test.step('render, search and mark read the alerts inbox', async () => {
            // Notifications is a catalogue row in the wallet menu.
            await page.getByRole('button', { name: 'Open menu' }).click();
            const menu = page.getByRole('dialog', { name: 'Wallet menu' });
            await menu.locator('[data-wallet-menu-row="alerts"]').click();

            await expectScreen(page, `${viewport.name} notifications list`, 'Notifications');
            await expectScreenStartsAtTop(page, `${viewport.name} notifications list`);
            const main = page.getByRole('main');
            const markAll = page.getByRole('banner').getByRole('button', { name: 'Mark all read' });
            const filterButton = page.getByRole('banner').getByRole('button', { name: 'Filter notifications', exact: true });
            await expect(filterButton).toBeVisible();
            // The header's Mark all read and Filter buttons share a line.
            await expectSharedLineControlHeights(page.getByRole('banner').getByRole('button'), `${viewport.name} notifications header`);

            // The seeded inbox renders as day groups of rows.
            const rows = main.getByRole('list').getByRole('listitem');
            await expect(rows.first()).toBeVisible();
            const total = await rows.count();
            expect(total).toBeGreaterThan(0);
            await expect(main.getByRole('region').first()).toBeVisible();

            // Search and the type filter live in the filter panel.
            await filterButton.click();
            const panel = page.getByRole('dialog', { name: 'Filter notifications' });
            const search = panel.getByRole('searchbox', { name: 'Search notifications' });
            await expect(search).toBeVisible();
            await expect(panel.getByRole('checkbox', { name: /^Unread \(\d+\)$/ })).toBeVisible();
            await expect(panel.getByRole('checkbox', { name: /^Payments \(\d+\)$/ })).toBeVisible();

            // A search with no match reports it and shows the empty state.
            await search.fill('zzz-no-such-alert');
            await expect(page.locator('[data-alert-match-count]')).toHaveText('0 notifications match');
            await expect(main.getByRole('heading', { name: 'No notifications', exact: true })).toBeVisible();
            await expectScreen(page, `${viewport.name} notifications no match`, 'Notifications');
            await search.fill('');
            await expect(search).toHaveValue('');
            await expect(rows).toHaveCount(total);
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();

            // Mark all read clears every unread dot and disables itself.
            if (await markAll.isEnabled()) {
                await markAll.click();
                await expect(main.getByLabel('Unread', { exact: true })).toHaveCount(0);
            }
            await expect(markAll).toBeDisabled();
            await expectScreen(page, `${viewport.name} notifications all read`, 'Notifications');
        });

        await test.step('create and edit a price alert from Notifications', async () => {
            // Notifications is a group page under Settings. Settings may reopen on the last sub-page, so step back to the landing first.
            await openSettings(page);
            const landing = page.getByRole('heading', { level: 1, name: 'Settings', exact: true });
            await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toBeVisible();
            for (let i = 0; i < 5 && !(await landing.isVisible().catch(() => false)); i += 1) {
                await page.getByRole('banner').getByRole('button', { name: /^Back\b/ }).first().click();
            }
            const main = page.getByRole('main');
            await main.getByRole('button', { name: /^Notifications\b/ }).click();
            await expectScreen(page, `${viewport.name} notifications settings`, 'Notifications');
            await expectScreenStartsAtTop(page, `${viewport.name} notifications settings`);

            const priceAlerts = main.getByRole('switch', { name: 'Price alerts' });
            await priceAlerts.scrollIntoViewIfNeeded();
            if (!(await priceAlerts.isChecked())) await priceAlerts.click();
            await expect(priceAlerts).toBeChecked();

            // The alert list is its own page (2026-11-14): the row opens it, the plus adds.
            await main.getByRole('button', { name: /^Your price alerts/ }).click();
            await expect(page.getByRole('heading', { level: 1, name: 'Price Alerts', exact: true })).toBeVisible();
            await expect(page.getByText('No price alerts yet', { exact: true })).toBeVisible();

            await page.getByRole('button', { name: 'Add Price Alert', exact: true }).click();
            await expect(page.getByRole('heading', { level: 1, name: 'Add Price Alert', exact: true })).toBeVisible();
            await page.getByRole('button', { name: /^Asset:/ }).click();
            await searchTokenPicker(page, 'Bitcoin');
            await page.getByRole('button', { name: 'Filter coins and tokens', exact: true }).click();
            await page.getByRole('button', { name: /^Select Bitcoin on Bitcoin,/ }).click();
            await page.getByLabel('Target price', { exact: true }).fill('71000');
            await page.getByRole('button', { name: 'Add Alert' }).click();

            await expect(page.getByText('BTC above $71,000')).toBeVisible();
            await expectScreen(page, `${viewport.name} created price alert`, 'Price Alerts');

            // The row opens the Price Alert page, whose Edit action reuses the add form.
            await page.getByRole('button', { name: /^Open BTC above \$71,000 alert/ }).click();
            await expect(page.getByRole('heading', { level: 1, name: 'Price Alert', exact: true })).toBeVisible();
            await page.getByRole('button', { name: /^Edit alert/ }).click();
            await expect(page.getByRole('heading', { level: 1, name: 'Edit Price Alert', exact: true })).toBeVisible();
            await expect(page.getByLabel('Target price', { exact: true })).toHaveValue('71000');
            await expectScreen(page, `${viewport.name} edit price alert`, 'Edit Price Alert');

            await pickOption(page.getByRole('button', { name: /^When the price/ }), 'below');
            await page.getByLabel('Target price', { exact: true }).fill('65000');
            await page.getByRole('button', { name: 'Save Alert' }).click();

            await expect(page.getByRole('heading', { level: 1, name: 'Price Alert', exact: true })).toBeVisible();
            await expect(page.getByText('BTC below $65,000', { exact: true })).toBeVisible();
            await expect(page.getByText('BTC above $71,000', { exact: true })).toHaveCount(0);
            await expectScreen(page, `${viewport.name} updated price alert`, 'Price Alert');
        });
    });
}
