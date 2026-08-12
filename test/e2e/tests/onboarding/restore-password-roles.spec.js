// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// : a restore that refuses a password says WHICH password it wanted.
//
// THE DEFECT, as reported. The restore screen asks for three passwords at once
// (§19.4 / ): the one that opens the backup FILE, the one the backed-up
// WALLET used on the device it came from, and the one THIS DEVICE unlocks
// with.  shipped the mechanism that needs all three and left the copy
// alone, so every refusal came back as "wrong password or tampered file". Two
// of those three are passwords the user still uses, so the likeliest mistake
// on this screen is not a typo at all: it is a correct password in the wrong
// box, and the app could not tell them apart.
//
// WHAT THIS DRIVES. A vault-less browser, the real restore screen, a real
// §19.4 envelope, and the two mix-ups a user actually makes:
//
//   1. This device's password typed into the backup-FILE box.
//   2. The backup file's password typed into the backed-up-WALLET box.
//
// Both are refused (they should be), and the point of the spec is that the two
// refusals are DIFFERENT and each names the box it is talking about. A test
// that only asserted "it failed" passes against the defect.
//
// WHY THE SECOND LANE IS ALSO THE FIXTURE CHECK. Its message begins "The
// backup file opened", which it can only say because the envelope really did
// decrypt under the file password. So a genuinely encrypted fixture, a real
// decrypt, and a real re-key attempt are all pinned without needing a chain.
//
// NO CHAIN, NO FUNDS, NO SIGNING: this is a copy question on a pre-vault
// screen, so it runs on the dev-server venue.
//
// RUN IT:
//   cd test/e2e && npx playwright test tests/onboarding/restore-password-roles.spec.js

import { dismissIntroCarousel, expect, test } from '../../fixtures/wallet.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
import { exportBackupFile } from '../../../../packages/core/src/flows/backupFile.js';
import { encryptWalletSeed } from '../../../../packages/core/src/crypto/walletBlob.js';
import {
    RESTORE_PASSWORD_INTRO,
    RESTORE_PASSWORD_LABELS,
} from '../../../../packages/core/src/flows/restorePasswordCopy.js';

// The restore still pays one Argon2id derivation at the production floor (the
// device key the vault would have been created under), so the waits take the
// shared budget rather than a hand-picked number.
const KDF_STEP_MS = kdfStepTimeout();

// THREE DELIBERATELY DIFFERENT STRINGS. Reusing one for two roles would let a
// build that confuses two of them pass.
const BACKUP_PASSWORD = 'opens-the-backup-file';
const WALLET_PASSWORD = 'the-old-devices-password';
const DEVICE_PASSWORD = 'this-devices-password';

const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

// Below the production floor on purpose: what is under test is which key opens
// the envelope, not how expensive the KDF is, and the fixture's cost is what
// the browser has to pay to find out the password is wrong. The derive path
// enforces maxima only.
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
 * spec is about the RESTORE screen, and an export walk would only add another
 * way for it to go red for an unrelated reason.
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
        accounts: memCollection([{
            id: 'src-account', walletId: 'src-wallet', schemaVersion: 1,
            label: 'Account 0', accountIndex: 0,
        }]),
        addresses: memCollection([{
            id: 'src-address', schemaVersion: 1, accountId: 'src-account',
            address: 'bc1qexample', derivationPath: "m/84'/0'/0'/0/0", addressType: 'p2wpkh',
        }]),
        contacts: memCollection(),
        connectedSites: memCollection(),
        pendingTxs: memCollection(),
        settings: { get: async () => null, put: async () => {} },
    };
    const { fileContent } = await exportBackupFile({
        vault, walletId: 'src-wallet', password: BACKUP_PASSWORD, kdfParams: KDF_PARAMS,
    });
    return fileContent;
}

/** Walks a vault-less browser to the restore screen and pastes the envelope. */
async function openRestoreScreen(page, envelope) {
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Import wallet' }).click();
    await page.getByRole('tab', { name: 'Encrypted backup' }).click();
    await page.getByPlaceholder(/argon2id/).fill(envelope);
}

async function fillPasswords(page, { file, wallet, device }) {
    await page.getByLabel(RESTORE_PASSWORD_LABELS.file, { exact: true }).fill(file);
    await page.getByLabel(RESTORE_PASSWORD_LABELS.wallet, { exact: true }).fill(wallet);
    await page.getByLabel(RESTORE_PASSWORD_LABELS.device.fresh, { exact: true }).fill(device);
}

/** The screen's error region. Scoped, so a label on the form cannot answer for it. */
function restoreError(page) {
    return page.getByRole('alert').first();
}

test.describe('restore: which of the three passwords is it asking for ', () => {
    test('the screen names all three before anything is typed', async ({ page }) => {
        await openRestoreScreen(page, await buildEnvelope());

        // Said once, up front: without it the second and third boxes read as
        // the app asking for the same thing twice.
        await expect(page.getByText(RESTORE_PASSWORD_INTRO),
            'the restore screen never says that three DIFFERENT passwords are in play')
            .toBeVisible();

        // And each box carries its own name. `getByLabel(exact)` is the
        // assertion: a renamed or duplicated label finds nothing.
        for (const label of [
            RESTORE_PASSWORD_LABELS.file,
            RESTORE_PASSWORD_LABELS.wallet,
            RESTORE_PASSWORD_LABELS.device.fresh,
        ]) {
            await expect(page.getByLabel(label, { exact: true }),
                `the restore screen has no field labelled "${label}"`).toBeVisible();
        }
    });

    test('this device\'s password in the backup-file box is told which box wants it', async ({ page }) => {
        // THE REPORTED CASE, exactly: a password that is correct for something
        // else, in the wrong field.
        await openRestoreScreen(page, await buildEnvelope());
        await fillPasswords(page, {
            file: DEVICE_PASSWORD,
            wallet: WALLET_PASSWORD,
            device: DEVICE_PASSWORD,
        });
        await page.getByRole('button', { name: 'Restore' }).click();

        const error = restoreError(page);
        await expect(error).toBeVisible({ timeout: KDF_STEP_MS });
        await expect(error,
            'the restore refused a correct-but-misfiled password without naming which of the '
            + 'three passwords it wanted, so the user cannot tell a mix-up from a typo')
            .toContainText(RESTORE_PASSWORD_LABELS.file, { timeout: KDF_STEP_MS });
        await expect(error).toContainText(/did not open the backup file/i);
        // And it does not blame either of the two boxes that were right.
        await expect(error,
            'the refusal points at the wrong field, which sends the user to change a password '
            + 'that was correct')
            .not.toContainText(`The "${RESTORE_PASSWORD_LABELS.wallet}" field wants`);

        // Nothing was created: the user is still on the restore screen and can
        // fix the one box the message named.
        await expect(page.getByLabel(RESTORE_PASSWORD_LABELS.file, { exact: true })).toBeVisible();
    });

    test('the file password in the wallet box gets a DIFFERENT answer, naming that box', async ({ page }) => {
        // The half that makes the case above meaningful. If both mix-ups
        // produced the same sentence, naming a field would be decoration.
        //
        // This is also the fixture check: the message can only open with "the
        // backup file opened" because the envelope really did decrypt under
        // BACKUP_PASSWORD, and the wallet's seal really was then tried.
        await openRestoreScreen(page, await buildEnvelope());
        await fillPasswords(page, {
            file: BACKUP_PASSWORD,
            wallet: BACKUP_PASSWORD,        // the wrong ROLE for this string
            device: DEVICE_PASSWORD,
        });
        await page.getByRole('button', { name: 'Restore' }).click();

        const error = restoreError(page);
        await expect(error).toBeVisible({ timeout: KDF_STEP_MS });
        await expect(error,
            'a wrong WALLET password is reported without naming the wallet field')
            .toContainText(RESTORE_PASSWORD_LABELS.wallet, { timeout: KDF_STEP_MS });
        await expect(error).toContainText(/backup file opened/i);
        await expect(error,
            'the wallet-password refusal blames the backup-file field, whose password was correct')
            .not.toContainText(`The "${RESTORE_PASSWORD_LABELS.file}" field wants`);
    });
});
