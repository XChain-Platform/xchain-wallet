// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The picker fields (G122): a Token field and a Fiat currency field are
// field-shaped buttons that open a full picker page, never a typed box or a
// dropdown, so specs pick through them the way a person does.

import { expect } from '@playwright/test';

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The page behind a Locator, or the Page itself. */
const pageOf = (scope) => (typeof scope.page === 'function' ? scope.page() : scope);

/**
 * Picks `code` on the Fiat currency field inside `scope`: tap the field, then
 * the currency's row on the picker page; the field shows the code after.
 *
 * @param {import('@playwright/test').Locator | import('@playwright/test').Page} scope
 * @param {string} code  an ISO code such as USD
 */
export async function pickFiatCurrency(scope, code) {
    const page = pageOf(scope);
    await scope.getByRole('button', { name: /^Fiat currency:/ }).click();
    const list = page.getByRole('list', { name: 'Fiat currencies' });
    await expect(list).toBeVisible();
    await list.locator(`li[data-fiat-currency-choice="${code}"] button`).click();
    await expect(page.getByRole('button', { name: new RegExp(`^Fiat currency: ${escapeRe(code)}\\b`) })).toBeVisible();
}

/**
 * Picks `tick` on the Token field inside `scope`: tap the field, search the
 * picker (owned tokens and, from three letters, every token on the network),
 * then tap the token's row; the field shows the ticker after.
 *
 * @param {import('@playwright/test').Locator | import('@playwright/test').Page} scope
 * @param {string} tick
 */
export async function pickToken(scope, tick) {
    const page = pageOf(scope);
    await scope.getByRole('button', { name: /^Token:/ }).click();
    await page.getByRole('button', { name: 'Filter coins and tokens' }).click();
    await page.getByRole('searchbox', { name: 'Search coins or tokens' }).fill(tick);
    const row = page.getByRole('button', { name: new RegExp(`^Select ${escapeRe(tick)} on `) }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.getByRole('button', { name: new RegExp(`^Token: ${escapeRe(tick)} on `) })).toBeVisible();
}
