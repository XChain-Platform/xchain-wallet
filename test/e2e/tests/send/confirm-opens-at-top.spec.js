// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, expect, gotoSection, openPaletteCommand, test } from '../../fixtures/wallet.js';
import { fieldByLabel, searchTokenPicker } from '../../fixtures/fields.js';

const PASSWORD = 'confirm-top-password';
const VALID_BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const VIEWPORTS = [
    { name: 'phone', width: 402, height: 874 },
    { name: 'desktop', width: 1024, height: 700 },
];

// The shared wallet-menu fixture, which follows the palette's current search.
const gotoPalette = (page, title) => openPaletteCommand(page, title);

async function scrollFormToBottom(page) {
    const main = page.getByRole('main');
    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await main.evaluate((element) => element.scrollTop),
        'the form must be scrolled so the confirm screen cannot inherit its position')
        .toBeGreaterThan(0);
}

async function expectConfirmAtTop(page) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Confirm' })).toBeFocused();

    const scroller = page.getByRole('main').filter({ has: confirm });
    expect(await scroller.evaluate((element) => element.scrollTop),
        'the confirm scroll container must start at the top')
        .toBe(0);

    const summary = confirm.getByTestId('confirm-sentence')
        .or(confirm.getByText(VALID_BTC, { exact: false }))
        .or(confirm.getByText('Review action', { exact: true }))
        .first();
    await expect(summary).toBeVisible();
    await expect(summary).toBeInViewport();
}

async function openSendConfirm(page) {
    await gotoSection(page, 'Send');
    const main = page.getByRole('main');
    await main.getByLabel('To', { exact: true }).fill(VALID_BTC);
    await main.getByRole('textbox', { name: /^Amount/ }).fill('0.01');
    // Advanced is a form section now, not a <details> summary, and the fees
    // sit in their own Speed and Fees section. Opening both makes the form
    // long enough to scroll at every width.
    for (const name of [/^Advanced\b/, /^Speed and Fees\b/]) {
        const section = main.getByRole('button', { name }).first();
        await expect(section).toBeVisible();
        if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
    }
    await scrollFormToBottom(page);
    await main.getByRole('button', { name: 'Send', exact: true }).click();
}

async function openIssueConfirm(page) {
    // Issue token opens the one-page Issue Token form, its template a
    // picker inside the Token section, which starts open and holds Ticker
    // and Max supply. Each field's 'About ...' help tip (U57) carries its
    // label too, so fields are found through the shared field lookup.
    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    const ticker = fieldByLabel(main, 'Ticker');
    await expect(ticker).toBeVisible();
    await ticker.fill('TOPVIEW');
    await fieldByLabel(main, 'Max supply').fill('100');
    // The availability lookup starts after a 350 ms debounce.
    await page.waitForTimeout(500);
    await scrollFormToBottom(page);
    await main.getByRole('button', { name: 'Issue Token', exact: true }).click();
}

async function openDispenserConfirm(page) {
    await gotoPalette(page, 'Create dispenser');
    let main = page.getByRole('main');
    await expect(main.getByRole('button', { name: /^Token:/ })).toBeVisible();
    await main.getByRole('button', { name: /^Token:/ }).click();
    await searchTokenPicker(page, 'RAREPEPE');
    await page.getByRole('button', { name: /^Select Rare Pepe/ }).click();

    main = page.getByRole('main');
    await main.getByRole('textbox', { name: /^Give amount per fill/ }).fill('1');
    await main.getByRole('textbox', { name: /^Escrow amount/ }).fill('2');
    await main.getByRole('textbox', { name: /^Trigger price/ }).fill('0.004');
    await scrollFormToBottom(page);
    // The main action names what it does (U63).
    await main.getByRole('button', { name: 'Create Dispenser', exact: true }).click();
}

const FLOWS = [
    { name: 'Send', open: openSendConfirm },
    { name: 'Issue token', open: openIssueConfirm },
    { name: 'Create dispenser', open: openDispenserConfirm },
];

for (const viewport of VIEWPORTS) {
    test.describe(`confirm opens at the top at ${viewport.width}x${viewport.height}`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        for (const flow of FLOWS) {
            test(`${flow.name} resets scroll and focuses the heading`, async ({ page }) => {
                await createWallet(page, { password: PASSWORD });
                await flow.open(page);
                await expectConfirmAtTop(page);
            });
        }
    });
}
