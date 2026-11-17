// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Restoring a backup file on Import Wallet's Backup tab, as the rebuilt tab
// (restore-v2, 2026-11-14) takes it: choose the file, type ONE password, press
// Restore. That password is tried to open the file and then the wallet inside;
// only when the wallet inside needs a different one does a "Wallet password"
// field appear, and the restored wallet then keeps that password here. There
// is no separate password for this device on a fresh install, so a spec that
// unlocks afterwards unlocks with the wallet's own password.

import { expect } from './wallet.js';
import { kdfStepTimeout } from '../timeout-budget.js';

/**
 * Chooses `content` as the backup file through the tab's hidden file input.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} content   the backup file's text
 * @param {string} [name]
 */
export async function chooseBackupFile(page, content, name = 'backup.xchain-wallet') {
    await page.getByLabel('Backup file', { exact: true }).setInputFiles({
        name,
        mimeType: 'application/json',
        buffer: Buffer.from(content, 'utf8'),
    });
    await expect(page.getByRole('region', { name: 'Chosen backup file' })).toContainText(name);
}

/**
 * Chooses the file and restores it. Pass `walletPassword` when the wallet in
 * the backup was sealed under a password other than the file's; the helper
 * then expects the second field and fills it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ content: string, name?: string, backupPassword: string, walletPassword?: string }} opts
 */
export async function restoreBackupFile(page, { content, name, backupPassword, walletPassword }) {
    await chooseBackupFile(page, content, name);
    await page.getByLabel('Backup password', { exact: true }).fill(backupPassword);
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    if (walletPassword && walletPassword !== backupPassword) {
        const walletField = page.getByLabel('Wallet password', { exact: true });
        await expect(walletField,
            'the file opened but the tab never asked for the wallet\'s own password')
            .toBeVisible({ timeout: kdfStepTimeout() });
        await walletField.fill(walletPassword);
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
    }
}
