// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// User report 2026-10-06: the dispenser expiration could be set, but the
// field never said which time zone it was read in.

import { createWallet, expect, test } from '../../fixtures/wallet.js';

test.use({ timezoneId: 'America/Chicago' });

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('combobox').first().fill(title);
    await page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

test('the dispenser expiration field names its time zone and shows the UTC moment', async ({ page }) => {
    await createWallet(page);
    await gotoPalette(page, 'Create dispenser');
    const main = page.getByRole('main');
    await main.getByRole('radio', { name: /Expire at a specific time/ }).check();

    const field = main.getByLabel('Expires');
    await expect(field).toHaveAccessibleDescription(/Time is in your local time zone, America\/Chicago \(UTC-[56]\)\./);

    // December is standard time in Chicago, so the offset follows the entered
    // date rather than today's daylight time.
    await field.fill('2026-12-01T15:30');
    await expect(main.getByText(
        'Time is in your local time zone, America/Chicago (UTC-6). That is 2026-12-01 21:30 UTC.',
    )).toBeVisible();
});
