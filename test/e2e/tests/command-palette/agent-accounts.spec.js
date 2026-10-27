// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Agent accounts opens from the command palette at phone and desktop widths.

import { createWallet, expect, test } from '../../fixtures/wallet.js';

for (const { name, width, height } of [
    { name: 'phone 360', width: 360, height: 640 },
    { name: 'desktop 1440', width: 1440, height: 900 },
]) {
    test(`the command palette opens Agent accounts at ${name}`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width, height });
        await createWallet(page);
        await page.keyboard.press('ControlOrMeta+k');
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await expect(palette).toBeVisible();
        await palette.getByRole('combobox').fill('Agent accounts');
        await palette.getByRole('option', { name: /^Agent accounts\b/ }).first().click();
        await expect(palette).toBeHidden();
        await expect(page.getByRole('heading', { level: 1, name: 'Agent accounts' })).toBeVisible();
    });
}
