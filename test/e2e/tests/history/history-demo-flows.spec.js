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

const SIGNED_AMOUNTS = [
    { chainId: 'bitcoin-mainnet', incomingTick: 'EXAMPLE', outgoingTick: 'BTC' },
    { chainId: 'litecoin-mainnet', incomingTick: 'LITECRED', outgoingTick: 'LTC' },
    { chainId: 'dogecoin-mainnet', incomingTick: 'DOGI', outgoingTick: 'DOGE' },
];

async function settleLayout(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectNoHorizontalOverflow(page, label) {
    await settleLayout(page);
    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: ${offenders.length} element(s) paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: the document scrolls sideways (${scrollWidth}px of content in ${clientWidth}px)`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

async function openPhoneFilters(page) {
    const toggle = page.getByRole('button', { name: /^Filters \(\d+\)$/ });
    if (await toggle.isVisible()) {
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    }
}

function historyRow(page, chainId, actionIndex) {
    return page.locator(`[data-history-key^="${chainId}:${actionIndex}:"]`);
}

async function expectTimelineCount(page, count) {
    await expect(page.locator('[data-history-row]')).toHaveCount(count);
}

async function localDate(page) {
    return page.evaluate(() => {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    });
}

for (const viewport of VIEWPORTS) {
    test(`demo History flows work at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await gotoSection(page, 'History');

        await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
        await expectTimelineCount(page, 27);
        await expectNoHorizontalOverflow(page, `${viewport.name} History list`);

        // Demo history rows carry whole-token units, so 1e8 base units read as 1.
        for (const amount of SIGNED_AMOUNTS) {
            await expect(historyRow(page, amount.chainId, 100011))
                .toContainText(`+1 ${amount.incomingTick}`);
            await expect(historyRow(page, amount.chainId, 100002))
                .toContainText(`-0.05 ${amount.outgoingTick}`);
        }

        await openPhoneFilters(page);
        const datePresets = page.getByRole('group', { name: 'Date range presets' });
        for (const preset of ['7 days', '30 days', 'All dates']) {
            const button = datePresets.getByRole('button', { name: preset, exact: true });
            await button.click();
            await expect(button).toHaveAttribute('aria-pressed', 'true');
            await expectTimelineCount(page, 27);
        }

        const today = await localDate(page);
        await page.getByLabel('From date').fill(today);
        await page.getByLabel('To date').fill(today);
        // The active range reads in the viewer's local date format.
        await expect(page.getByText(/^Date range: .+ to .+$/)).toBeVisible();
        await expect(page.locator('[data-history-key*=":100003:"]')).toHaveCount(0);
        await expect(historyRow(page, 'bitcoin-mainnet', 100001)).toBeVisible();
        await expectNoHorizontalOverflow(page, `${viewport.name} custom date range`);

        await datePresets.getByRole('button', { name: 'All dates', exact: true }).click();
        const search = page.getByRole('searchbox', { name: 'Search history' });
        await search.fill('thanks for lunch');
        await expectTimelineCount(page, 3);
        for (const amount of SIGNED_AMOUNTS) {
            await expect(historyRow(page, amount.chainId, 100002))
                .toContainText(`-0.05 ${amount.outgoingTick}`);
        }
        await expectNoHorizontalOverflow(page, `${viewport.name} searched History list`);
        await page.getByRole('button', { name: 'Clear history search' }).click();
        await expectTimelineCount(page, 27);

        const grouped = page.getByRole('radio', { name: 'Grouped' });
        const flat = page.getByRole('radio', { name: 'Flat' });
        await expect(grouped).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByText('Limit order: 2 fills', { exact: true })).toHaveCount(3);
        await flat.click();
        await expect(flat).toHaveAttribute('aria-checked', 'true');
        await expectTimelineCount(page, 33);
        await expect(page.getByText('Limit order: 2 fills', { exact: true })).toHaveCount(0);
        await grouped.click();
        await expectTimelineCount(page, 27);
        await expectNoHorizontalOverflow(page, `${viewport.name} grouped History list`);

        const exportButton = page.getByRole('button', { name: 'Export…' });
        await expect(exportButton).toBeEnabled();
        await exportButton.click();
        const exportDialog = page.getByRole('dialog', { name: 'Export history' });
        await expect(exportDialog).toBeVisible();
        await expect(exportDialog.getByText('33 history items will be exported.')).toBeVisible();
        await expect(exportDialog.getByLabel(/^CSV/)).toBeChecked();
        await expect(exportDialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
        await expectNoHorizontalOverflow(page, `${viewport.name} export dialog`);
        await exportDialog.getByRole('button', { name: 'Cancel' }).click();

        const outgoing = historyRow(page, 'bitcoin-mainnet', 100002);
        await outgoing.locator('button').first().click();
        await expect(page.getByRole('heading', { name: 'Send #100,002' })).toBeVisible();
        // The detail opens on its Status tab; the amount lives under Details.
        await page.getByRole('tablist', { name: 'Transaction detail tabs' })
            .getByRole('tab', { name: 'Details', exact: true }).click();
        const amountCell = page.getByRole('rowheader', { name: 'Amount' }).first()
            .locator('xpath=following-sibling::td');
        await expect(amountCell).toContainText('-0.05');
        await expectNoHorizontalOverflow(page, `${viewport.name} transaction detail`);

        await page.getByRole('button', { name: 'Back to history' }).click();
        await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
        await expectTimelineCount(page, 27);
        await expectNoHorizontalOverflow(page, `${viewport.name} History after back`);
    });
}
