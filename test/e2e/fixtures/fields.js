// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Field lookups that survive the form standard's help tips and the token
// picker's filter panel (xchain-wallet#83).
//
// Every field with help carries an InfoTip button named "About <label>"
// (ui.field.about), so a substring getByLabel('Ticker') matches the field AND
// that button, and strict mode fails. An AmountField appends its active unit
// to the label ("Escrow amount (BTC)"), so a plain exact lookup misses it.
// `fieldByLabel` matches the whole label, with or without that unit, and never the
// help button.

import { expect } from '@playwright/test';

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The page behind a Locator, or the Page itself. */
const pageOf = (scope) => (typeof scope.page === 'function' ? scope.page() : scope);

/**
 * The field labelled `label` inside `scope`. A string matches the whole label,
 * optionally followed by an AmountField unit such as " (BTC)"; a RegExp is
 * used as given. Either way the field's "About ..." help button is excluded.
 *
 * @param {import('@playwright/test').Locator | import('@playwright/test').Page} scope
 * @param {string | RegExp} label
 * @returns {import('@playwright/test').Locator}
 */
export function fieldByLabel(scope, label) {
    const name = typeof label === 'string'
        ? new RegExp(`^${escapeRe(label)}(?: \\([^)]*\\))?$`)
        : label;
    return scope.getByLabel(name).and(scope.locator(':not(button[aria-label^="About "])'));
}

/**
 * Types `text` into the open token picker's search box. The search sits in the
 * panel behind the picker's "Filter coins and tokens" button, which toggles,
 * so the panel is opened only while that button reads collapsed.
 *
 * @param {import('@playwright/test').Locator | import('@playwright/test').Page} scope
 * @param {string} text
 * @returns {Promise<import('@playwright/test').Locator>} the search box
 */
export async function searchTokenPicker(scope, text) {
    const page = pageOf(scope);
    const filter = page.getByRole('button', { name: 'Filter coins and tokens', exact: true });
    await expect(filter, 'the token picker did not open').toBeVisible({ timeout: 30_000 });
    if (await filter.getAttribute('aria-expanded') !== 'true') await filter.click();
    const search = page.getByRole('searchbox', { name: 'Search coins or tokens', exact: true });
    await expect(search).toBeVisible();
    await search.fill(text);
    return search;
}
