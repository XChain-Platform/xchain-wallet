// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    dismissIntroCarousel,
    expect,
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

const EXPECTED_VIEWPORT = { width: 412, height: 869 };

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(title);
    await palette.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(palette).toBeHidden();
}

async function useWatcherMode(page) {
    await openSettings(page);
    await page.getByRole('main').getByRole('button', { name: /^Wallet mode/ }).click();
    await page.getByRole('radio', { name: /^Watcher/ }).click();
    await page.getByRole('button', { name: 'Confirm mode change' }).click();
    await expect(page.getByRole('radio', { name: /^Watcher/ })).toBeChecked();
}

async function expectNoHorizontalOverflow(page, label) {
    const offenders = await overflowingElements(page);
    expect(
        offenders,
        `${label}: ${offenders.length} element(s) paint outside the viewport\n${describeOffenders(offenders)}`,
    ).toEqual([]);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
        scrollWidth,
        `${label}: the document is ${scrollWidth}px wide in a ${clientWidth}px viewport`,
    ).toBeLessThanOrEqual(clientWidth + 1);
}

async function expectPrimaryActionReachable(page, action, label) {
    await action.scrollIntoViewIfNeeded();
    await expect(action, `${label}: primary action is not visible`).toBeVisible();
    const bounds = await action.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            viewportWidth: document.documentElement.clientWidth,
            viewportHeight: window.innerHeight,
            scrollLeft: document.scrollingElement?.scrollLeft || 0,
        };
    });
    expect(bounds.scrollLeft, `${label}: reaching the primary action scrolled sideways`).toBe(0);
    expect(bounds.left, `${label}: primary action starts outside the viewport`).toBeGreaterThanOrEqual(-1);
    expect(bounds.right, `${label}: primary action ends outside the viewport`)
        .toBeLessThanOrEqual(bounds.viewportWidth + 1);
    expect(bounds.top, `${label}: primary action starts above the viewport`).toBeGreaterThanOrEqual(-1);
    expect(bounds.bottom, `${label}: primary action ends below the viewport`)
        .toBeLessThanOrEqual(bounds.viewportHeight + 1);
}

async function expectDetail(review, label, value) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const term = review.locator('dt').filter({ hasText: new RegExp(`^${escapedLabel}$`) });
    await expect(term).toHaveCount(1);
    await expect(term.locator('xpath=following-sibling::dd[1]')).toHaveText(value);
}

async function discardReview(page) {
    await page.getByRole('button', { name: 'Back to previous screen', exact: true }).click();
    await page.getByRole('button', { name: 'Discard and leave' }).click();
}

test.describe('LG K51 protocol authoring and markets', { tag: '@lg-k51' }, () => {
    test('review screens and a market pair fit the touch viewport', async ({ page }) => {
        test.slow();
        const consoleErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push(String(error)));

        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
        expect(page.viewportSize()).toEqual(EXPECTED_VIEWPORT);
        const device = await page.evaluate(() => ({
            touchPoints: navigator.maxTouchPoints,
            userAgent: navigator.userAgent,
        }));
        expect(device.touchPoints).toBeGreaterThan(0);
        expect(device.userAgent).toContain('Chrome/102.0.0.0');
        await useWatcherMode(page);

        await test.step('Issue token reaches review with the entered values', async () => {
            await gotoPalette(page, 'Issue token');
            const main = page.getByRole('main');
            await main.getByLabel('Ticker').fill('K51TOKEN');
            await main.getByLabel('Supply', { exact: true }).fill('125000');
            await main.getByLabel('Initial mint (optional)').fill('25000');
            await main.getByLabel('Divisible (8 decimal places)').check();
            await main.getByLabel('Description (optional)').fill('K51 protocol token');
            await main.getByRole('button', { name: 'Preview', exact: true }).click();

            const review = page.getByRole('form', { name: 'Review token issue' });
            await expect(review).toBeVisible();
            await expectDetail(review, 'Token', 'K51TOKEN');
            await expectDetail(review, 'Max supply', '125000');
            await expectDetail(review, 'Decimals', '8');
            await expectDetail(review, 'Initial mint', '25000');
            await expectDetail(review, 'Description', 'K51 protocol token');
            await expectNoHorizontalOverflow(page, 'Issue token review');
            await expectPrimaryActionReachable(
                page,
                review.getByRole('button', { name: 'Create unsigned transaction' }),
                'Issue token review',
            );
            await discardReview(page);
        });

        await test.step('Create dispenser reaches review with the entered values', async () => {
            await gotoPalette(page, 'Create dispenser');
            const main = page.getByRole('main');
            await main.getByRole('button', { name: 'Token: Select a token' }).click();
            await page.getByLabel('Search coins or tokens').fill('PEPECASH');
            await page.getByRole('button', { name: /^Select PepeCash on Bitcoin$/ }).click();
            await main.getByRole('textbox', { name: /^Give amount/ }).fill('2');
            await main.getByRole('textbox', { name: /^Escrow amount/ }).fill('20');
            await main.getByRole('radio', { name: 'A token' }).check();
            await main.getByLabel('Payment token').fill('XCP');
            await main.getByLabel('Payment amount (per fill)').fill('0.5');
            await main.getByRole('button', { name: 'Create', exact: true }).click();

            const review = page.getByRole('form', { name: 'Review dispenser' });
            await expect(review).toBeVisible();
            await expectDetail(review, 'Token (give)', 'PEPECASH');
            await expectDetail(review, 'Per-fill amount', '2');
            await expectDetail(review, 'Escrow (locked)', '20');
            await expectDetail(review, 'Estimated fills', '10');
            await expectDetail(review, 'Trigger amount', '0.5');
            await expectDetail(review, 'Buyer pays (token)', 'XCP');
            await expectNoHorizontalOverflow(page, 'Create dispenser review');
            await expectPrimaryActionReachable(
                page,
                review.getByRole('button', { name: 'Create unsigned transaction' }),
                'Create dispenser review',
            );
            await discardReview(page);
        });

        await test.step('Markets opens a populated pair view', async () => {
            await gotoPalette(page, 'Open DEX');
            const main = page.getByRole('main');
            await expect(main.getByRole('region', { name: 'Markets results' })).toBeVisible();
            await main.getByRole('button', { name: 'Open PEPECASH market' }).click();

            await expect(page.getByRole('heading', { name: 'PEPECASH/BTC' })).toBeVisible();
            await expect(main.getByRole('region', { name: 'Market summary' })).toContainText('PEPECASH / BTC');
            await expectNoHorizontalOverflow(page, 'PEPECASH/BTC market');
            await expectPrimaryActionReachable(
                page,
                main.getByRole('tab', { name: 'Place', exact: true }),
                'PEPECASH/BTC market',
            );
        });

        expect(consoleErrors, `browser console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
    });
});
