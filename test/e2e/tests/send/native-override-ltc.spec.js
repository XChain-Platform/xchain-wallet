// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An amount over the available balance on Litecoin is blocked on the form
// itself, as on Bitcoin: no Confirm opens and there is no Sign anyway override.

import { createWallet, expect, gotoSection, revealChainPicker, test } from '../../fixtures/wallet.js';
import { searchTokenPicker } from '../../fixtures/fields.js';

const VALID_LTC = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

// The price feed is a third-party service the dev server reaches live. When it
// rate-limits a CI runner it answers without CORS headers, and the browser logs
// that as an error that says nothing about this flow.
const PRICE_FEED = /api\.coingecko\.com/;

test('an unaffordable Litecoin token send is blocked on the form with no Sign anyway', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (PRICE_FEED.test(msg.text()) || PRICE_FEED.test(msg.location()?.url || '')) return;
        consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await createWallet(page);
    await gotoSection(page, 'Send');
    // The From section picks the chain the send is made on; LITEGEM is a Litecoin token.
    const network = page.getByRole('main').getByRole('button', { name: /^Network:/ });
    await revealChainPicker(page.getByRole('main'), network, 'Network');
    await network.click();
    await page.getByRole('dialog', { name: 'Network' }).getByRole('button', { name: 'Select Litecoin' }).click();
    await page.getByRole('button', { name: /^Asset: LTC on Litecoin/ }).click();
    await searchTokenPicker(page, 'LITEGEM');
    const filter = page.getByRole('button', { name: 'Filter coins and tokens', exact: true });
    if (await filter.getAttribute('aria-expanded') === 'true') await filter.click();
    await page.getByRole('button', { name: /^Select Lite Gem/ }).first().click();
    const main = page.getByRole('main');
    await expect(main.getByRole('textbox', { name: /^Amount \(LITEGEM\)/ })).toBeVisible();

    await page.getByLabel('To', { exact: true }).fill(VALID_LTC);
    await page.getByRole('textbox', { name: /^Amount/ }).fill('999999');
    await main.getByRole('button', { name: 'Send', exact: true }).click();

    // Operator ruling 2026-11-17: the form blocks an amount over the balance,
    // so no Confirm opens and there is no Sign anyway override.
    await expect(main.getByText('Amount exceeds the available balance', { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
    await expect(page.getByText('Sign anyway')).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
});
