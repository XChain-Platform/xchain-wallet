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

function priceAlertFormControls(page) {
    return page.getByLabel('Target price', { exact: true })
        .locator('xpath=ancestor::div[.//select and .//button][1]')
        .locator('select, input, button');
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
            // The condensed header opens its action menu; the full wallet Menu
            // page is its "More wallet actions" row.
            await page.getByRole('button', { name: 'Open menu' }).click();
            await page.getByRole('menuitem', { name: 'More wallet actions' }).click();
            await expect(page.getByRole('heading', { level: 1, name: 'Menu' })).toBeVisible();
            await page.getByRole('main').getByRole('button', { name: 'Alerts', exact: true }).click();

            await expectScreen(page, `${viewport.name} alerts list`, 'Alerts');
            await expectScreenStartsAtTop(page, `${viewport.name} alerts list`);
            const main = page.getByRole('main');
            const markAll = page.getByRole('banner').getByRole('button', { name: 'Mark all read' });
            const search = main.getByRole('searchbox', { name: 'Search alerts' });
            const typeFilter = main.getByRole('combobox', { name: 'Filter alert type' });
            await expect(search).toBeVisible();
            await expect(typeFilter).toBeVisible();

            // The seeded inbox renders as day groups of rows; the type
            // filter lists a count per type, "All types" first.
            const allTypes = typeFilter.locator('option').first();
            await expect(allTypes).toHaveText(/^All types \(\d+\)$/);
            const total = Number((await allTypes.innerText()).match(/\((\d+)\)/)[1]);
            const rows = main.getByRole('list').getByRole('listitem');
            if (total > 0) {
                await expect(main.getByRole('region').first()).toBeVisible();
                await expect(rows).toHaveCount(total);
            } else {
                await expect(main.getByRole('heading', { name: 'No alerts', exact: true })).toBeVisible();
            }

            const toolbarControls = search.locator('xpath=ancestor::div[.//select][1]').locator('select, input');
            await expectSharedLineControlHeights(toolbarControls, `${viewport.name} alerts toolbar`);

            // A search with no match reports it and shows the empty state.
            await search.fill('zzz-no-such-alert');
            await expect(main.getByText('0 alerts match', { exact: true })).toBeVisible();
            await expect(main.getByRole('heading', { name: 'No alerts', exact: true })).toBeVisible();
            await expectScreen(page, `${viewport.name} alerts no match`, 'Alerts');
            await main.getByRole('button', { name: 'Clear search', exact: true }).click();
            await expect(search).toHaveValue('');
            if (total > 0) await expect(rows).toHaveCount(total);

            // Mark all read clears every unread dot and disables itself.
            if (total > 0 && await markAll.isEnabled()) {
                await markAll.click();
                await expect(main.getByLabel('Unread', { exact: true })).toHaveCount(0);
            }
            await expect(markAll).toBeDisabled();
            await expectScreen(page, `${viewport.name} alerts all read`, 'Alerts');
        });

        await test.step('create and edit a price alert from Notifications', async () => {
            // Notifications is a section of the Settings screen, not a screen of its own.
            await openSettings(page);
            const main = page.getByRole('main');
            await expect(main.getByRole('heading', { level: 2, name: 'Notifications', exact: true })).toBeVisible();
            await expectScreen(page, `${viewport.name} notifications`, 'Settings');
            await expectScreenStartsAtTop(page, `${viewport.name} notifications`);

            const priceAlerts = main.getByRole('switch', { name: 'Price alerts' });
            await priceAlerts.scrollIntoViewIfNeeded();
            if (!(await priceAlerts.isChecked())) await priceAlerts.click();
            await expect(priceAlerts).toBeChecked();
            await expect(main.getByText('No price alerts yet', { exact: true })).toBeVisible();

            await expectSharedLineControlHeights(
                priceAlertFormControls(page),
                `${viewport.name} add price alert row`,
            );
            await main.getByLabel('Target price', { exact: true }).fill('71000');
            await main.getByRole('button', { name: 'Add alert' }).click();

            await expect(main.getByText('Bitcoin rises above $71,000', { exact: true })).toBeVisible();
            await expectScreen(page, `${viewport.name} created price alert`, 'Settings');
            const edit = main.getByRole('button', { name: 'Edit Bitcoin price alert' });
            const savedRowControls = edit.locator('xpath=parent::span').locator('button');
            await expectSharedLineControlHeights(savedRowControls, `${viewport.name} saved price alert row`);

            await edit.click();
            await expect(main.getByLabel('Coin', { exact: true })).toHaveValue('bitcoin-mainnet');
            await expect(main.getByLabel('Direction', { exact: true })).toHaveValue('above');
            await expect(main.getByLabel('Target price', { exact: true })).toHaveValue('71000');
            await expectSharedLineControlHeights(
                priceAlertFormControls(page),
                `${viewport.name} edit price alert row`,
            );
            await expectScreen(page, `${viewport.name} edit price alert`, 'Settings');

            await main.getByLabel('Direction', { exact: true }).selectOption('below');
            await main.getByLabel('Target price', { exact: true }).fill('65000');
            // Editing keeps the form's one action name, Add alert (U51).
            await main.getByRole('button', { name: 'Add alert' }).click();

            await expect(main.getByText('Bitcoin falls below $65,000', { exact: true })).toBeVisible();
            await expect(main.getByText('Bitcoin rises above $71,000', { exact: true })).toHaveCount(0);
            await expectScreen(page, `${viewport.name} updated price alert`, 'Settings');
        });
    });
}
