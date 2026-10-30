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
    documentOverflow,
    enterDemoWallet,
} from '../../fixtures/responsive.js';

const RECIPIENT = 'bc1qdevmock02aabbcc';

test('a custom fee rate above the chain maximum is refused on a 360 px compose form', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell });
    await gotoSection(page, 'Messaging');
    await page.getByRole('button', { name: 'New conversation' }).click();

    const main = page.getByRole('main');
    await main.getByLabel('Address', { exact: true }).fill(RECIPIENT);
    await main.getByLabel('Message', { exact: true }).fill('Fee bound check.');
    await main.getByRole('button', { name: /^Edit fee rate/ }).click();

    const rate = main.getByRole('textbox', { name: /^Custom fee rate/ });
    await rate.fill('99999999');
    await expect(main.getByRole('alert').filter({ hasText: /no higher than/ })).toBeVisible();
    await expect(rate).toHaveAttribute('aria-invalid', 'true');
    expect(await rate.evaluate((input) => input.validationMessage)).toMatch(/^Enter a rate no higher than/);

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(scrollWidth, 'the document scrolls sideways').toBeLessThanOrEqual(clientWidth + 1);

    await rate.fill('2');
    expect(await rate.evaluate((input) => input.validationMessage)).toBe('');
});
