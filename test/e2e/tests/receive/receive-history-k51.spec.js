// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
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
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import {
    describeOffenders,
    documentOverflow,
    enterDemoWallet,
    LG_K51,
    overflowingElements,
} from '../../fixtures/responsive.js';

const REQUEST_AMOUNT = '0.025';
const HISTORY_TX_ID = 'demo-bitcoin-mainnet-nft-recv-1';
const HISTORY_SOURCE = 'demo-collector-1xchainpubnftsender';

async function expectNoHorizontalOverflow(page, label) {
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

async function expectReachableWithoutSidewaysScroll(locator, label) {
    await locator.scrollIntoViewIfNeeded();
    const bounds = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            right: rect.right,
            viewportWidth: document.documentElement.clientWidth,
            documentScrollLeft: document.documentElement.scrollLeft,
            bodyScrollLeft: document.body.scrollLeft,
        };
    });
    expect(bounds.left, `${label} starts left of the viewport`).toBeGreaterThanOrEqual(0);
    expect(bounds.right, `${label} ends right of the viewport`).toBeLessThanOrEqual(bounds.viewportWidth);
    expect(bounds.documentScrollLeft, `${label} requires document-level sideways scrolling`).toBe(0);
    expect(bounds.bodyScrollLeft, `${label} requires body-level sideways scrolling`).toBe(0);
}

function detailRow(page, label) {
    return page.getByRole('row').filter({
        has: page.getByRole('rowheader', { name: label, exact: true }),
    });
}

test.use(LG_K51);

test.describe('Receive to History on LG K51', { tag: '@lg-k51' }, () => {
    test('reviews an amount request and its matching transaction detail', async ({ page }) => {
        const consoleErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push(String(error)));
        // No share sheet in the emulator: Share falls back to copying the
        // payment link, and the copy lands where the spec can read it back.
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
            Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
            window.__copiedText = null;
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: async (text) => { window.__copiedText = String(text); },
                    readText: async () => window.__copiedText || '',
                },
            });
        });

        await page.goto('/');
        const device = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
            userAgent: navigator.userAgent,
            touchPoints: navigator.maxTouchPoints,
        }));
        expect(device).toMatchObject(LG_K51.viewport);
        expect(device.userAgent).toContain('Chrome/102.0.5005.125');
        expect(device.touchPoints).toBeGreaterThan(0);

        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

        await test.step('Receive shows the address and QR without horizontal overflow', async () => {
            await gotoSection(page, 'Receive');
            await expect(page.getByRole('heading', { name: 'Receive', exact: true })).toBeVisible();

            const addressField = page.getByRole('textbox', { name: /address/i }).and(page.locator('input[readonly]'));
            await expect(addressField).toBeVisible();
            const address = await addressField.inputValue();
            expect(address).toMatch(/^bc1/);

            const qr = page.getByRole('img', { name: `QR code for ${address}` });
            await expect(qr).toBeVisible();
            await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/);
            await expectNoHorizontalOverflow(page, 'Receive');
        });

        let receiveAddress;
        await test.step('an amount request is reflected in the QR and copied payment link', async () => {
            const addressField = page.getByRole('textbox', { name: /address/i }).and(page.locator('input[readonly]'));
            receiveAddress = await addressField.inputValue();
            const qr = page.getByRole('img', { name: `QR code for ${receiveAddress}` });
            const qrBefore = await qr.getAttribute('src');

            await page.getByRole('textbox', { name: /^Amount \(BTC\)/ }).fill(REQUEST_AMOUNT);
            await expect.poll(() => qr.getAttribute('src')).not.toBe(qrBefore);

            const copyAction = page.getByRole('button', { name: /^Copy (QR code|payment link)$/ });
            await expect(copyAction).toBeVisible();
            await expectReachableWithoutSidewaysScroll(copyAction, 'QR copy action');
            const shareAction = page.getByRole('button', { name: 'Share QR payment link' });
            await expectReachableWithoutSidewaysScroll(shareAction, 'QR share action');
            await shareAction.click();
            await expect(page.getByText('Sharing is unavailable, so the payment link was copied to the clipboard.'))
                .toBeVisible();

            const copied = await page.evaluate(() => window.__copiedText || '');
            const match = /^bitcoin:([^?]+)\?(.*)$/.exec(copied);
            expect(match, `copied request is not a Bitcoin payment URI: ${copied}`).not.toBeNull();
            expect(match[1]).toBe(receiveAddress);
            const params = new URLSearchParams(match[2]);
            expect(params.get('amount')).toBe(REQUEST_AMOUNT);
            expect(params.get('chain')).toBe('bitcoin-mainnet');
            await expectNoHorizontalOverflow(page, 'Receive amount request');
        });

        await test.step('History filters to the transaction and shows the matching detail values', async () => {
            await gotoSection(page, 'History');
            await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();

            // A phone folds the History filters behind one Filters button.
            const search = page.getByRole('searchbox', { name: 'Search history' });
            if (!(await search.isVisible())) {
                await page.getByRole('button', { name: /^Filters/ }).click();
            }
            await search.fill(HISTORY_TX_ID);
            const rows = page.locator('[data-history-key]');
            await expect(rows).toHaveCount(1);
            await expectNoHorizontalOverflow(page, 'filtered History');
            await rows.getByRole('button').click();

            // An incoming transfer is titled from this wallet's side.
            await expect(page.getByRole('heading', { name: 'Receive #100,012' })).toBeVisible();
            await page.getByRole('tab', { name: 'Details' }).click();
            await expect(detailRow(page, 'Action number')).toContainText('100,012');
            // Long values render shortened at this width; the row's
            // accessible name still carries the full value.
            await expect(detailRow(page, 'Transaction ID')).toHaveAccessibleName(new RegExp(HISTORY_TX_ID));
            await expect(detailRow(page, 'From')).toHaveAccessibleName(new RegExp(HISTORY_SOURCE));
            await expect(detailRow(page, 'To')).toHaveAccessibleName(new RegExp(receiveAddress));
            await expect(detailRow(page, 'Amount')).toContainText('+1');
            await expect(detailRow(page, 'Tick')).toContainText('RAREPEPE');
            await expectNoHorizontalOverflow(page, 'transaction detail');
        });

        expect(consoleErrors).toEqual([]);
    });
});
