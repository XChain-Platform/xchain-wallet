// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The web shell loads the action catalogue (every action's label and
// description) together with the Token actions screen rather than at startup.
// The screen must still list the catalogue's entries and each one must still
// open its form.

import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';

test('Token actions lists the catalogue and opens the chosen form', async ({ page }) => {
    await createWallet(page);
    await openPaletteCommand(page, 'All actions');

    const main = page.getByRole('main');
    // The screen title sits in the page header, outside the main landmark.
    await expect(page.getByRole('heading', { name: 'Token actions', level: 1 })).toBeVisible();
    const issue = main.getByRole('button', { name: /^Issue token/ });
    await expect(issue).toBeVisible();
    await expect(main.getByText('Create a new token with full control over all settings.')).toBeVisible();
    await expect(main.getByRole('button', { name: /^Sign message/ })).toBeVisible();

    await issue.click();
    await expect(page.getByRole('heading', { name: 'Issue token', level: 1 })).toBeVisible();
});
