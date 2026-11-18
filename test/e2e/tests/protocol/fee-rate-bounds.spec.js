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
    openFormSection,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';
import {
    documentOverflow,
    enterDemoWallet,
} from '../../fixtures/responsive.js';

const RECIPIENT = 'bc1qdevmock02aabbcc';

test('a custom fee rate above the chain maximum is refused on a 360 px compose form', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await gotoSection(page, 'Messaging');
    await page.getByRole('button', { name: 'New message', exact: true }).click();

    const main = page.getByRole('main');
    // The estimate below assumes Bitcoin, so send from the Bitcoin address.
    await main.getByRole('button', { name: /^From\b/ }).click();
    await main.getByRole('button', { name: /^Network:/ }).click();
    await page.getByRole('dialog', { name: 'Network' })
        .getByRole('button', { name: /^Select Bitcoin\b/ }).first().click();
    await expect(main.getByRole('button', { name: 'Network: Bitcoin' })).toBeVisible();
    await main.getByLabel('Address', { exact: true }).fill(RECIPIENT);
    await main.getByLabel('Message', { exact: true }).fill('Fee bound check.');
    // The Fees section starts closed; its slider's last stop is Custom, which
    // opens the Network fee line's one editor (G113) and no rate box.
    await openFormSection(main, 'Speed and Fees');
    await main.getByRole('slider', { name: 'Network fee' }).press('End');
    await expect(main.getByRole('textbox', { name: /^Custom fee rate/ })).toHaveCount(0);

    // A BTC estimate assumes 250 vB: 1 BTC is far above the 1,000 sat/vB
    // ceiling, and 0.000005 BTC is 2 sat/vB.
    const fee = main.getByRole('textbox', { name: /^Network fee amount/ });
    await fee.fill('1');
    await expect(main.getByRole('alert').filter({ hasText: /no higher than/ })).toBeVisible();
    await expect(fee).toHaveAttribute('aria-invalid', 'true');
    expect(await fee.evaluate((input) => input.validationMessage)).toMatch(/^Enter a rate no higher than/);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(scrollWidth, 'the document scrolls sideways').toBeLessThanOrEqual(clientWidth + 1);

    await fee.fill('0.000005');
    expect(await fee.evaluate((input) => input.validationMessage)).toBe('');
});
