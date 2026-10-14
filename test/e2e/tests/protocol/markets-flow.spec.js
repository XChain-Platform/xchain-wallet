// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

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

const PRICE = '0.00000089';
const SIZE = '2';
const TOTAL = '0.00000178';

async function settle(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectScreen(page, heading, label) {
    await expect(page.getByRole('main').getByRole('heading', { name: heading, exact: true }).first())
        .toBeVisible();
    await settle(page);
    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label} paints outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);
    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label} scrolls horizontally (${scrollWidth}px of content in ${clientWidth}px)`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

async function expectMatchingLineHeights(controls, label) {
    const boxes = await controls.evaluateAll((elements) => elements
        .map((element) => {
            const rect = element.getBoundingClientRect();
            return { top: rect.top, height: rect.height };
        })
        .filter(({ height }) => height > 0));

    const lines = [];
    for (const box of boxes) {
        const line = lines.find((candidate) => Math.abs(candidate[0].top - box.top) <= 2);
        if (line) line.push(box);
        else lines.push([box]);
    }

    for (const [index, line] of lines.entries()) {
        if (line.length < 2) continue;
        const heights = line.map(({ height }) => height);
        expect(
            Math.max(...heights) - Math.min(...heights),
            `${label}, line ${index + 1}, has control heights ${heights.join(', ')}`,
        ).toBeLessThanOrEqual(2);
    }
}

async function useWatcherMode(page) {
    await openSettings(page);
    await page.getByRole('main').getByRole('button', { name: /^Wallet Mode/ }).click();
    const watcher = page.getByRole('radio', { name: /^Watcher \(watch-only\)/ });
    await expect(watcher).toBeVisible();
    await watcher.click();
    const dialog = page.getByRole('dialog', {
        name: 'Switch to Watcher (watch-only) mode?',
    });
    await dialog.getByRole('button', { name: 'Confirm mode change' }).click();
    await expect(dialog).toBeHidden();
    await expect(watcher).toBeChecked();
}

function reviewValue(review, label) {
    return review.getByText(label, { exact: true })
        .locator('xpath=following-sibling::dd[1]');
}

for (const viewport of VIEWPORTS) {
    test(`markets flow fits and preserves order amounts on ${viewport.name}`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        await useWatcherMode(page);

        await test.step('filter the populated markets list', async () => {
            await gotoSection(page, 'DEX');
            const main = page.getByRole('main');
            const filters = main.getByRole('tablist', { name: 'Markets view' });
            await expect(filters).toBeVisible();
            await filters.getByRole('tab', { name: 'All' }).click();
            await main.getByLabel('Search markets').fill('PEPECASH');

            await expect(main.getByRole('region', { name: 'Markets results' }))
                .not.toHaveAttribute('aria-busy', 'true');
            const market = main.getByRole('button', { name: 'Open PEPECASH market' });
            await expect(market).toBeVisible();
            await expect(main.getByRole('list', { name: 'Markets' }).getByRole('button', {
                name: /^Open .* market$/,
            })).toHaveCount(1);
            await expectScreen(page, 'Decentralized exchange', `${viewport.name} markets list`);
            await expectMatchingLineHeights(
                main.getByLabel('Search markets').or(filters.getByRole('tab')),
                `${viewport.name} market filters`,
            );
            await market.click();
        });

        const main = page.getByRole('main');
        const panels = main.getByRole('tablist', { name: 'Market panels' });

        await test.step('show the order book and trade history', async () => {
            await expect(main.getByRole('region', { name: 'Market summary' }))
                .not.toHaveAttribute('aria-busy', 'true');
            const orderBook = main.getByRole('region', { name: 'Order book' });
            await expect(orderBook).toBeVisible();
            await expect(orderBook).not.toHaveAttribute('aria-busy', 'true');
            await expectScreen(page, 'PEPECASH/BTC', `${viewport.name} order book`);
            await expectMatchingLineHeights(
                panels.getByRole('tab'),
                `${viewport.name} market panel tabs`,
            );

            await panels.getByRole('tab', { name: 'History' }).click();
            const tradeHistory = main.getByRole('region', { name: 'Trade history' });
            await expect(tradeHistory).toBeVisible();
            await expect(tradeHistory).not.toHaveAttribute('aria-busy', 'true');
            await expectScreen(page, 'PEPECASH/BTC', `${viewport.name} trade history`);
            await expectMatchingLineHeights(
                panels.getByRole('tab'),
                `${viewport.name} market panel tabs with history selected`,
            );
        });

        await test.step('place a sell order through its review', async () => {
            await panels.getByRole('tab', { name: 'Place' }).click();
            const order = main.getByRole('form', { name: 'Place order' });
            await expect(order).toBeVisible();
            await order.getByRole('button', { name: 'Sell PEPECASH' }).click();
            await order.getByLabel('Price (BTC)').fill(PRICE);
            await order.getByLabel('Size (PEPECASH)').fill(SIZE);
            await expect(order).toContainText(`Give ${SIZE} PEPECASH, get ${TOTAL} BTC`);
            await expectScreen(page, 'PEPECASH/BTC', `${viewport.name} place order`);
            await expectMatchingLineHeights(
                order.getByRole('group', { name: 'Order side' }).getByRole('button'),
                `${viewport.name} order side`,
            );
            await expectMatchingLineHeights(
                order.getByRole('group', { name: 'Price and amount' }).getByRole('textbox'),
                `${viewport.name} price and amount`,
            );

            await order.getByRole('button', { name: 'Review' }).click();
            const review = main.getByRole('form', { name: 'Review order' });
            await expect(review).toBeVisible();
            await expect(reviewValue(review, 'Give')).toHaveText(`${SIZE} PEPECASH`);
            await expect(reviewValue(review, 'Get')).toHaveText(`${TOTAL} BTC`);
            await expect(reviewValue(review, 'Price')).toHaveText(`${PRICE} BTC/PEPECASH`);
            const reviewPosition = await review.evaluate((element) => {
                const scrollport = element.closest('main');
                const formRect = element.getBoundingClientRect();
                const scrollportRect = scrollport.getBoundingClientRect();
                return {
                    formTop: formRect.top,
                    scrollportTop: scrollportRect.top,
                    scrollportBottom: scrollportRect.bottom,
                    reviewScrollTop: element.scrollTop,
                };
            });
            expect(
                reviewPosition.reviewScrollTop,
                `${viewport.name} review does not open at its top`,
            ).toBeLessThanOrEqual(1);
            expect(
                reviewPosition.formTop,
                `${viewport.name} review opens above its visible scrollport`,
            ).toBeGreaterThanOrEqual(reviewPosition.scrollportTop - 1);
            expect(
                reviewPosition.formTop,
                `${viewport.name} review opens below its visible scrollport`,
            ).toBeLessThan(reviewPosition.scrollportBottom);
            await expectScreen(page, 'PEPECASH/BTC', `${viewport.name} order review`);
            await expectMatchingLineHeights(
                review.getByRole('button', { name: 'Edit order' })
                    .or(review.getByRole('button', { name: 'Create unsigned transaction' })),
                `${viewport.name} review actions`,
            );
        });
    });
}
