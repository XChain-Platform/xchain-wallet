// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
    gotoSection,
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
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

        await test.step('publish a wallet alert from the seeded demo inbox', async () => {
            await gotoSection(page, 'Messaging');
            await expect(page.getByRole('heading', { level: 1, name: 'Messaging' })).toBeVisible();
            await expect(page.getByRole('list', { name: 'Conversations' })).toBeVisible();
        });

        await test.step('render and dismiss the alerts route list', async () => {
            // The condensed header opens its action menu; the full wallet Menu
            // page is its "More wallet actions" row.
            await page.getByRole('button', { name: 'Open menu' }).click();
            await page.getByRole('menuitem', { name: 'More wallet actions' }).click();
            await expect(page.getByRole('heading', { level: 1, name: 'Menu' })).toBeVisible();
            await page.getByRole('main').getByRole('button', { name: 'Alerts', exact: true }).click();

            await expectScreen(page, `${viewport.name} alerts list`, 'Alerts');
            await expectScreenStartsAtTop(page, `${viewport.name} alerts list`);
            const main = page.getByRole('main');
            await expect(main.getByRole('list').getByText('Unread messages', { exact: true })).toBeVisible();
            await expect(main.getByText(/\d+ unread/)).toBeVisible();

            const clearAlerts = main.getByRole('button', { name: 'Clear alerts' });
            const toolbarControls = clearAlerts
                .locator('xpath=ancestor::div[.//button][1]')
                .locator('button');
            await expectSharedLineControlHeights(toolbarControls, `${viewport.name} alerts toolbar`);

            await clearAlerts.click();
            await expect(main.getByRole('heading', { name: 'No alerts', exact: true })).toBeVisible();
            await expect(main.getByRole('list')).toHaveCount(0);
            await expectScreen(page, `${viewport.name} dismissed alerts`, 'Alerts');
        });

        await test.step('create and edit a price alert from Notifications', async () => {
            const main = page.getByRole('main');
            await main.getByRole('button', { name: 'Manage notifications' }).click();
            await expectScreen(page, `${viewport.name} notifications`, 'Notifications');
            await expectScreenStartsAtTop(page, `${viewport.name} notifications`);

            const priceAlerts = main.getByRole('switch', { name: 'Price alerts' });
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
            await expectScreen(page, `${viewport.name} created price alert`, 'Notifications');
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
            await expectScreen(page, `${viewport.name} edit price alert`, 'Notifications');

            await main.getByLabel('Direction', { exact: true }).selectOption('below');
            await main.getByLabel('Target price', { exact: true }).fill('65000');
            await main.getByRole('button', { name: 'Save changes' }).click();

            await expect(main.getByText('Bitcoin falls below $65,000', { exact: true })).toBeVisible();
            await expect(main.getByText('Bitcoin rises above $71,000', { exact: true })).toHaveCount(0);
            await expectScreen(page, `${viewport.name} updated price alert`, 'Notifications');
        });
    });
}
