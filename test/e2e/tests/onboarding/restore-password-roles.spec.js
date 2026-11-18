// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A restore asks for one password and says which role refused it.
//
// A backup can hold two different secrets: the one that opens the backup FILE
// and the one the backed-up WALLET used on the device it came from. The old
// screen asked for both, plus a new password for this device, all at once
// (§19.4), and the likeliest mistake there was a correct password in the wrong
// box. The rebuilt tab (restore-v2, 2026-11-14) asks once, tries that password
// to open the file and then the wallet, and only when the wallet needs another
// one shows a "Wallet password" field in place. The restored wallet keeps its
// own password on this device.
//
// WHAT THIS DRIVES. A vault-less browser, the real restore screen, a real
// §19.4 envelope whose file and wallet passwords differ:
//
//   1. A password that opens neither: one red sentence under the field.
//   2. The file's password: the file opens, the wallet does not, so the
//      screen asks for the wallet's own password in a second field.
//
// The second lane is also the fixture check: the wallet field can only appear
// because the envelope really did decrypt under the file password.
//
// NO CHAIN, NO FUNDS, NO SIGNING: a pre-vault screen, so it runs on the
// dev-server venue.
//
// RUN IT:
//   npx playwright test --config test/e2e/playwright.config.js tests/onboarding/restore-password-roles.spec.js

import { dismissIntroCarousel, expect, test } from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
import { chooseBackupFile } from '../../fixtures/backupRestore.js';
import { exportBackupFile } from '../../../../packages/core/src/flows/backupFile.js';
import { encryptWalletSeed } from '../../../../packages/core/src/crypto/walletBlob.js';

// The restore still pays Argon2id derivations, so the waits take the shared
// budget rather than a hand-picked number.
const KDF_STEP_MS = kdfStepTimeout();

// DELIBERATELY DIFFERENT STRINGS. Reusing one for two roles would let a build
// that confuses them pass.
const BACKUP_PASSWORD = 'opens-the-backup-file';
const WALLET_PASSWORD = 'the-old-devices-password';
const UNRELATED_PASSWORD = 'this-devices-password';

const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

// Below the production floor on purpose: what is under test is which key opens
// the envelope, not how expensive the KDF is. The derive path enforces maxima only.
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, structuredClone(r)]));
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, structuredClone(rec)); },
        list: async () => Array.from(m.values()).map((r) => structuredClone(r)),
        delete: async (id) => { m.delete(id); },
    };
}

/**
 * A real §19.4 envelope holding a wallet whose seed is really sealed under
 * WALLET_PASSWORD. Built here rather than exported through the UI because this
 * spec is about the RESTORE screen.
 */
async function buildEnvelope() {
    const sealed = await encryptWalletSeed({
        password: WALLET_PASSWORD,
        seed: new TextEncoder().encode(MNEMONIC),
        kdfParams: KDF_PARAMS,
    });
    const vault = {
        wallets: memCollection([{
            id: 'src-wallet',
            schemaVersion: 1,
            name: 'Backed-up Wallet',
            kind: 'mnemonic',
            format: 'bip39',
            encryptedSeed: sealed.encryptedSeed,
            kdfParams: sealed.kdfParams,
            importedKeys: [],
        }]),
        // Complete records: a restore validates every record before it writes
        // or tries the wallet password, so a partial one would answer first.
        accounts: memCollection([{
            id: 'src-account', walletId: 'src-wallet', schemaVersion: 2,
            name: 'Account 0', index: 0, activeAddressByChainId: {},
            createdAt: '2026-10-13T18:00:00.000Z',
        }]),
        addresses: memCollection([{
            id: 'src-address', schemaVersion: 4, accountId: 'src-account',
            chain: 'bitcoin', network: 'mainnet', address: 'bc1qexample',
            source: 'hd', addressType: 'p2wpkh', derivationPath: "m/84'/0'/0'/0/0",
            publicKey: 'ab'.repeat(33), label: '', pinned: false, hidden: false,
            signerId: null, role: 'receive', createdAt: '2026-10-13T18:00:00.000Z',
        }]),
        contacts: memCollection(),
        connectedSites: memCollection(),
        signers: memCollection(),
        pendingTxs: memCollection(),
        settings: { get: async () => null, put: async () => {} },
    };
    const { fileContent } = await exportBackupFile({
        vault, walletId: 'src-wallet', password: BACKUP_PASSWORD, kdfParams: KDF_PARAMS,
    });
    return fileContent;
}

/** Walks a vault-less browser to the restore screen and chooses the envelope. */
async function openRestoreScreen(page, envelope) {
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Import wallet' }).click();
    await page.getByRole('tab', { name: 'Encrypted backup' }).click();
    await chooseBackupFile(page, envelope, 'backed-up-wallet.xchain-wallet');
}

async function restoreWith(page, password) {
    await page.getByLabel('Backup password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Restore' }).click();
}

// The field-level sentence; the form-errors summary above it repeats it.
function fieldError(page) {
    return page.getByRole('alert').filter({ hasNotText: 'Fix 1 thing to continue' });
}

test.describe('restore: one password, and the role that refused it', () => {
    test('the screen asks for one password and shows the chosen file\'s summary', async ({ page }) => {
        await openRestoreScreen(page, await buildEnvelope());
        const card = page.getByRole('region', { name: 'Chosen backup file' });
        await expect(card).toContainText('Backed-up Wallet');
        await expect(card.getByRole('button', { name: 'Change File' })).toBeVisible();
        await expect(page.locator('input[type="password"]'),
            'the restore screen asks for more than one password before any is refused')
            .toHaveCount(1);
        await expect(page.getByLabel('Backup password', { exact: true })).toBeVisible();
    });

    test('a password that opens nothing is one red sentence under the field', async ({ page }) => {
        await openRestoreScreen(page, await buildEnvelope());
        await restoreWith(page, UNRELATED_PASSWORD);

        const error = fieldError(page);
        await expect(error).toHaveText("That password doesn't open this backup.", { timeout: KDF_STEP_MS });
        await expect(page.getByLabel('Backup password', { exact: true })).toHaveAttribute('aria-invalid', 'true');
        // Nothing was created, and no second field was offered for a file
        // that never opened.
        await expect(page.getByLabel('Wallet password', { exact: true })).toHaveCount(0);
    });

    test('the file\'s password opens the file and the screen asks for the wallet\'s own', async ({ page }) => {
        await openRestoreScreen(page, await buildEnvelope());
        await restoreWith(page, BACKUP_PASSWORD);

        const walletField = page.getByLabel('Wallet password', { exact: true });
        await expect(walletField,
            'the file opened under its own password but the screen never asked for the wallet\'s')
            .toBeVisible({ timeout: KDF_STEP_MS });
        await expect(page.getByText('The file opened, but the wallet inside uses a different password.'))
            .toBeVisible();
        await expect(page.getByLabel('Backup password', { exact: true }))
            .not.toHaveAttribute('aria-invalid', 'true');

        // The wrong wallet password is named on the wallet field, not the file's.
        await walletField.fill(UNRELATED_PASSWORD);
        await page.getByRole('button', { name: 'Restore' }).click();
        await expect(fieldError(page))
            .toHaveText("That password doesn't open the wallet in this backup.", { timeout: KDF_STEP_MS });
    });
});
