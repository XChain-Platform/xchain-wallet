// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's tabs are Balances, NFTs and DeFi (operator 2026-11-15). The
// Balances list holds coins and tokens together and narrows to one of them
// through the Filter and sort menu's Type field, which replaced the Coins and
// Tokens tabs. Specs open a narrowed list through this file.

import { pickOption } from './pickOption.js';

/**
 * Opens Home's Balances tab narrowed to `type` ('all', 'coins' or 'tokens'),
 * the way a person does: the tab, then the menu's Type field, then the menu
 * closed again.
 *
 * @param {import('@playwright/test').Page | import('@playwright/test').Locator} scope  the page or Home's main region
 * @param {'all' | 'coins' | 'tokens'} [type]
 */
export async function showHomeBalances(scope, type = 'all') {
    await scope.getByRole('tab', { name: /^Balances/ }).click();
    const filter = scope.getByRole('button', { name: 'Filter and sort' });
    await filter.click();
    const menu = scope.getByRole('dialog', { name: 'Filter and sort' });
    await pickOption(menu.getByRole('button', { name: /^Type/ }), type);
    await filter.click();
}
