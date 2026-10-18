// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { expect } from './wallet.js';

export const WALLET_UNLOCK = 'testnetpassword123';

export async function approve(page, password = WALLET_UNLOCK) {
    const confirm = page.getByTestId('confirm-modal');
    await expect(confirm).toBeVisible({ timeout: 120_000 });
    const passwordInput = page.getByLabel('Password', { exact: true });
    if (await passwordInput.count() && await passwordInput.isVisible()) await passwordInput.fill(password);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    await page.getByTestId('confirm-approve').click();
}

export async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('combobox').fill(title);
    await dialog.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first().click();
}

export async function readDoneTxid(page) {
    const value = page.getByRole('main').locator('code, dd')
        .filter({ hasText: /^[0-9a-f]{64}$/ }).first();
    await expect(value).toBeVisible({ timeout: 120_000 });
    const txid = (await value.innerText()).trim();
    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    return txid;
}
