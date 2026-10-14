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
    overflowingElements,
} from '../../fixtures/responsive.js';

const VIEWPORTS = [
    { name: 'phone', width: 412, height: 869 },
    { name: 'desktop', width: 1280, height: 800 },
];

const RECIPIENT = 'bc1qdevmock02aabbcc';
const MESSAGE = 'Review this encrypted message before sending.';
const NORMAL_FEE = '0.25';
const NORMAL_RATE = '1 DOGE/kB';

async function settleLayout(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function expectHeading(page, name) {
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
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

async function expectSameLineHeights(label, controls) {
    const boxes = [];
    for (const control of controls) {
        await expect(control, `${label}: control is not visible`).toBeVisible();
        const box = await control.boundingBox();
        expect(box, `${label}: control has no rendered box`).not.toBeNull();
        boxes.push(box);
    }

    const tops = boxes.map((box) => box.y);
    const heights = boxes.map((box) => box.height);
    // On phones the filter keeps room for its label and wraps below the
    // search field; stacked controls then share the same left edge instead.
    const sameLine = Math.max(...tops) - Math.min(...tops) <= 2;
    const stacked = Math.max(...boxes.map((box) => box.x)) - Math.min(...boxes.map((box) => box.x)) <= 2;
    expect(sameLine || stacked, `${label}: controls neither share a line nor stack on one edge`).toBe(true);
    expect(
        Math.max(...heights) - Math.min(...heights),
        `${label}: control heights differ by more than 2px (${heights.join(', ')})`,
    ).toBeLessThanOrEqual(2);
}

for (const viewport of VIEWPORTS) {
    test(`messaging compose stops at the demo note at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });

        await test.step('encrypted inbox renders without a horizontal leak', async () => {
            await gotoSection(page, 'Messaging');
            const main = page.getByRole('main');
            const conversations = main.getByRole('list', { name: 'Conversations' });
            await expect(conversations).toBeVisible({ timeout: 30_000 });
            await expect(conversations.getByRole('button', { name: /Erin Calloway/ })).toBeVisible();
            await expectHeading(page, 'Messaging');
            await expectSameLineHeights('inbox filter row', [
                main.getByRole('searchbox', { name: 'Search conversations' }),
                main.getByRole('button', { name: 'Filter by network' }),
            ]);
            await expectNoHorizontalOverflow(page, `${viewport.name} inbox`);
        });

        await test.step('encrypted thread renders with an even reply row', async () => {
            await page.getByRole('main')
                .getByRole('list', { name: 'Conversations' })
                .getByRole('button', { name: /Erin Calloway/ })
                .click();
            await expectHeading(page, 'Erin Calloway');
            await expect(page.getByRole('main').getByText('Moved the savings stash to the new address. All set.'))
                .toBeVisible();
            await expect(page.getByRole('main').getByText(/ECIES/).first()).toBeVisible();
            await expectSameLineHeights('thread reply row', [
                page.getByRole('textbox', { name: 'Message' }),
                page.getByRole('button', { name: 'Send message' }),
            ]);
            await expectNoHorizontalOverflow(page, `${viewport.name} thread`);
        });

        await test.step('compose renders the selected fee and aligned address controls', async () => {
            await page.getByRole('button', { name: 'Back to previous screen' }).click();
            await expectHeading(page, 'Messaging');
            await page.getByRole('button', { name: 'New conversation' }).click();

            const main = page.getByRole('main');
            await expectHeading(page, 'New message');
            await main.getByLabel('Address', { exact: true }).fill(RECIPIENT);
            await main.getByLabel('Message', { exact: true }).fill(MESSAGE);
            await expect(main.getByText(/Recipient public key found/)).toBeVisible({ timeout: 15_000 });
            await expect(main.getByRole('button', { name: /^Encryption: Standard \(ECIES\)/ }))
                .toBeVisible();
            await expect(main.getByRole('button', { name: /^Delivery network: Dogecoin/ }))
                .toBeVisible();

            // The address book opens from an icon button inside the field box,
            // so it must sit within the field rather than match its height.
            const addressBox = await main.getByLabel('Address', { exact: true }).boundingBox();
            const bookBox = await main.getByRole('button', { name: 'Open address book' }).boundingBox();
            expect(addressBox && bookBox, 'compose address row: controls have no rendered box').toBeTruthy();
            expect(bookBox.y, 'compose address row: address book button rises above the field')
                .toBeGreaterThanOrEqual(addressBox.y - 1);
            expect(bookBox.y + bookBox.height, 'compose address row: address book button drops below the field')
                .toBeLessThanOrEqual(addressBox.y + addressBox.height + 1);
            const feeAmount = main.getByRole('button', { name: 'Edit exact fee amount' });
            const feeRate = main.getByRole('button', { name: 'Edit fee rate (DOGE/kB)' });
            await expect(feeAmount).toHaveText(NORMAL_FEE);
            await expect(feeRate).toHaveText(NORMAL_RATE);
            await expectSameLineHeights('compose fee row', [feeAmount, feeRate]);
            await expectNoHorizontalOverflow(page, `${viewport.name} compose`);

            // A demo wallet cannot broadcast, so compose stops at the demo note;
            // the review screen is covered by the regtest messaging specs.
            await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
            await expect(main.getByRole('button', { name: 'Send message' })).toBeDisabled();
            await expect(main.getByText(/Demo wallets can.t move funds/)).toBeVisible();
            await expectNoHorizontalOverflow(page, `${viewport.name} compose demo note`);
        });
    });
}
