// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    overflowingElements,
} from '../../fixtures/responsive.js';

const CONTACT_NAME = 'K51 recipient';
const CONTACT_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ENTERED_AMOUNT = '0.01';

async function expectFitsWithReachableAction(page, label, action) {
    await action.scrollIntoViewIfNeeded();
    await expect(action, `${label}: primary action is not reachable`).toBeVisible();

    const actionBox = await action.boundingBox();
    const viewport = page.viewportSize();
    expect(actionBox, `${label}: primary action has no rendered box`).not.toBeNull();
    expect(actionBox.x, `${label}: primary action starts outside the viewport`)
        .toBeGreaterThanOrEqual(-1);
    expect(actionBox.x + actionBox.width, `${label}: primary action ends outside the viewport`)
        .toBeLessThanOrEqual(viewport.width + 1);

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
    expect(await page.evaluate(() => window.scrollX), `${label}: the page moved sideways`).toBe(0);
}

async function expectReviewAndReject(page, expectedAmount, expectedFee, label) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible();
    await expect(page.getByTestId('confirm-chain-badge')).toHaveText('Bitcoin');

    const fee = page.getByTestId('confirm-fee');
    await expect(fee).toHaveText(`Network fee: ${expectedFee} BTC`);
    const feeAmount = Number((await fee.innerText()).match(/[\d.]+/)?.[0]);
    expect(feeAmount, `${label}: review shows no positive network fee`).toBeGreaterThan(0);

    const approve = page.getByTestId('confirm-approve');
    await expectFitsWithReachableAction(page, `${label} review`, approve);
    await page.getByTestId('confirm-reject').click();

    await expect(confirm).toHaveCount(0);
    await expect(page.locator('#send-destination')).toHaveValue(CONTACT_ADDRESS);
    await expect(page.locator('#send-amount')).toHaveValue(expectedAmount);
    await expect(page.getByText(CONTACT_NAME, { exact: true })).toBeVisible();
}

test.describe('LG K51 send review', { tag: '@lg-k51' }, () => {
    test('a contact amount and Max remain usable through review without broadcasting', async ({ page }, testInfo) => {
        const browserErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') browserErrors.push(message.text());
        });
        page.on('pageerror', (error) => browserErrors.push(String(error)));

        expect(testInfo.project.name).toBe('android-lg-k51');
        expect(page.viewportSize()).toEqual({ width: 412, height: 869 });
        expect(await page.evaluate(() => navigator.userAgent)).toContain('Chrome/102.');
        expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);

        await page.route('https://api.coingecko.com/api/v3/**', async (route) => {
            const isChart = route.request().url().includes('/market_chart');
            const body = isChart
                ? { prices: [[Date.now(), 65000]] }
                : {
                    bitcoin: { usd: 65000, usd_market_cap: 1, usd_24h_change: 0 },
                    litecoin: { usd: 80, usd_market_cap: 1, usd_24h_change: 0 },
                    dogecoin: { usd: 0.1, usd_market_cap: 1, usd_24h_change: 0 },
                };
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        });

        await createWallet(page);

        await gotoSection(page, 'Contacts');
        await page.getByRole('button', { name: 'Add contact' }).click();
        await page.getByRole('textbox', { name: 'Name', exact: true }).fill(CONTACT_NAME);
        await page.getByRole('textbox', { name: 'Address', exact: true }).fill(CONTACT_ADDRESS);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByText(CONTACT_NAME).first()).toBeVisible();

        await gotoSection(page, 'Home');
        const homeSend = mainButton(page, 'Send');
        await expectFitsWithReachableAction(page, 'Home', homeSend);
        await homeSend.click();

        await page.getByRole('button', { name: 'Open address book' }).click();
        await page.getByRole('button', { name: new RegExp(`^${CONTACT_NAME}`) }).click();
        await expect(page.locator('#send-destination')).toHaveValue(CONTACT_ADDRESS);
        await page.locator('#send-amount').fill(ENTERED_AMOUNT);

        const send = mainButton(page, 'Send');
        await expectFitsWithReachableAction(page, 'Send with entered amount', send);
        const enteredFee = await page.getByRole('button', { name: 'Edit exact fee amount' }).innerText();
        await send.click();
        await expectReviewAndReject(page, ENTERED_AMOUNT, enteredFee, 'entered amount');

        const max = page.getByRole('button', { name: 'Use max available amount' }).first();
        await expect(max).toBeEnabled();
        await max.click();
        await expect.poll(() => page.locator('#send-amount').inputValue()).not.toBe(ENTERED_AMOUNT);
        const maxAmount = await page.locator('#send-amount').inputValue();
        expect(Number(maxAmount.replace(/,/g, '')), 'Max did not produce a positive amount')
            .toBeGreaterThan(0);

        await expectFitsWithReachableAction(page, 'Send with Max', send);
        const maxFee = await page.getByRole('button', { name: 'Edit exact fee amount' }).innerText();
        await send.click();
        await expectReviewAndReject(page, maxAmount, maxFee, 'Max');

        await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
        expect(browserErrors, `browser errors:\n${browserErrors.join('\n')}`).toEqual([]);
    });
});
