// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  / : which password opens a RESTORED wallet's seed.
//
// WHY THIS EXISTS. The §19.4 envelope carries the wallet record verbatim -
// including `encryptedSeed`, `importedKeys[].encryptedWif` and that wallet's OWN
// `kdfParams`. Before  `importBackupFile` re-encrypted none of it, so a
// restored wallet was opened by the password it had on the device it left, and
// by no other. `SignerPool.populate` unlocks each wallet with the one password
// it was handed and, on failure, "skip[s] it" so "the op-level fallback
// (password prompt) will surface the real error if the user tries to use that
// wallet" - nothing at restore time told the user, and they met it at their
// first signature.
//
// That was invisible to every other backup test, because they all use a STUB
// `encryptedSeed` (`{ iv: 'AAAA', tag: 'BBBB', ct: 'CCCC' }`) that is never
// decrypted. This one encrypts a real seed and a real WIF and then tries to
// open them.
//
// WHAT IT PINS NOW, post-fix:
//
//   1. The restored record's ciphertext and salt are NOT the source's -
//      something re-sealed them. That is the mechanism; the rest follows.
//   2. The DEVICE password opens the restored seed.
//   3. The backed-up wallet's ORIGINAL password no longer does. The seal moved;
//      it was not copied.
//   4. `importedKeys[].encryptedWif` moved with it. `importWif` seals those with
//      the SAME master key, so re-keying the seed alone would have moved the
//      failure rather than fixed it - and a wif-only wallet would not have been
//      repaired at all.
//   5. A WRONG wallet password fails AT RESTORE TIME, naming which password is
//      wrong, and leaves the vault untouched. That is the whole point: the
//      failure is now in front of the user while they can still fix it.
//   6. The backup-file password never opens the seed, before or after.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';

// Every case here pays a real Argon2id derivation at the production floor.
vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });
import {
    exportBackupFile,
    importBackupFile,
    BackupSeedPasswordError,
} from '../../../packages/core/src/flows/backupFile.js';
import {
    RESTORE_PASSWORD_LABELS,
    restoreFailureMessage,
} from '../../../packages/core/src/flows/restorePasswordCopy.js';
import {
    encryptWalletSeed,
    decryptWalletSeed,
} from '../../../packages/core/src/crypto/walletBlob.js';
import {
    deriveMasterKey,
    encrypt,
    decrypt,
    bytesToBase64,
    base64ToBytes,
} from '../../../packages/core/src/crypto/index.js';

// Argon2id at real cost would make this test slow for no extra truth: what is
// under test is WHICH key opens the blob, not how expensive the KDF is. The
// derive path enforces maxima only, so a below-floor cost is accepted here, and
// the re-key inherits that cost with a fresh salt - which case 1 also checks.
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const WIF = 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ';

/** The password the wallet was created with, and still carries inside the backup. */
const ORIGINAL_PASSWORD = 'original-device-password';
/** This device's password - what the restored wallet must open under afterwards. */
const DEVICE_PASSWORD = 'this-devices-password';
/** The backup file's own password, independent of both by design. */
const BACKUP_PASSWORD = 'backup-file-password';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
    };
}

function memSettings(initial = null) {
    let v = initial ? JSON.parse(JSON.stringify(initial)) : null;
    return {
        get: async () => (v ? JSON.parse(JSON.stringify(v)) : null),
        put: async (next) => { v = JSON.parse(JSON.stringify(next)); },
    };
}

function makeVault({ wallets = [], accounts = [], addresses = [] } = {}) {
    return {
        wallets: memCollection(wallets),
        accounts: memCollection(accounts),
        addresses: memCollection(addresses),
        contacts: memCollection([]),
        connectedSites: memCollection([]),
        pendingTxs: memCollection([]),
        settings: memSettings(null),
    };
}

/** Restore `exported` into an empty vault and hand back the written record. */
async function restoreInto(exported, opts = {}) {
    const target = makeVault();
    const res = await importBackupFile({
        vault: target,
        fileContent: exported,
        password: BACKUP_PASSWORD,
        walletPassword: ORIGINAL_PASSWORD,
        devicePassword: DEVICE_PASSWORD,
        mode: 'add',
        ...opts,
    });
    return { target, res, restored: await target.wallets.get(res.walletId) };
}

describe('integration/flows/backup restore: which password opens the seed ', () => {
    let sourceVault;
    let exported;
    /** @type {{ encryptedSeed: string, kdfParams: any }} */
    let sealed;
    /** @type {string} */
    let sealedWif;

    beforeEach(async () => {
        // A REAL encrypted seed, sealed under the wallet's own password.
        sealed = await encryptWalletSeed({
            password: ORIGINAL_PASSWORD,
            seed: new TextEncoder().encode(MNEMONIC),
            kdfParams: KDF_PARAMS,
        });

        // And a REAL imported WIF, sealed with the same master key the way
        // `importWif` does it.
        const mk = deriveMasterKey(ORIGINAL_PASSWORD, KDF_PARAMS);
        try {
            sealedWif = bytesToBase64(await encrypt(mk, new TextEncoder().encode(WIF)));
        } finally {
            mk.fill(0);
        }

        sourceVault = makeVault({
            wallets: [{
                id: 'src',
                schemaVersion: 1,
                name: 'Backed-up Wallet',
                kind: 'mnemonic',
                format: 'bip39',
                encryptedSeed: sealed.encryptedSeed,
                // The real schema field is `kdfParams`; every production reader
                // (unlockWallet, importWif, exportPrivateKey, revealMnemonic)
                // uses that name, and so does the re-key.
                kdfParams: sealed.kdfParams,
                importedKeys: [{
                    addressId: 'addr-imp',
                    encryptedWif: sealedWif,
                    importedAt: '2026-01-01T00:00:00.000Z',
                }],
            }],
            accounts: [{ id: 'acc-src', walletId: 'src', schemaVersion: 1, label: 'Account 0', accountIndex: 0 }],
            addresses: [
                {
                    id: 'addr-1', schemaVersion: 1, accountId: 'acc-src', address: 'bc1qexample',
                    derivationPath: "m/84'/0'/0'/0/0", addressType: 'p2wpkh',
                },
                {
                    id: 'addr-imp', schemaVersion: 1, accountId: null, address: 'bc1qimported',
                    derivationPath: null, addressType: 'p2wpkh',
                },
            ],
        });

        const r = await exportBackupFile({
            vault: sourceVault,
            walletId: 'src',
            password: BACKUP_PASSWORD,
            kdfParams: KDF_PARAMS,
        });
        exported = r.fileContent;
    });

    it('re-seals the record: neither the ciphertext nor the salt survives the move', async () => {
        // The mechanism, stated first. Everything below follows from it.
        const { res, restored } = await restoreInto(exported);

        expect(restored, 'the restore produced no wallet record').toBeTruthy();
        expect(res.rekeyed, 'importBackupFile reported that it re-keyed nothing').toBe(true);
        expect(restored.encryptedSeed === sealed.encryptedSeed,
            'the restored seed ciphertext is byte-identical to the source, so nothing re-keyed it '
            + 'and a restored wallet is still sealed under the password it left with')
            .toBe(false);
        expect(restored.kdfParams.salt === sealed.kdfParams.salt,
            'the re-key reused the source salt. Under the same password that derives the same '
            + 'master key for two wallets, which is a weakening, not a re-key')
            .toBe(false);
        // Cost is inherited so a device that calibrated upward keeps it.
        expect(restored.kdfParams.iterations).toBe(KDF_PARAMS.iterations);
        expect(restored.kdfParams.memory).toBe(KDF_PARAMS.memory);
        expect(restored.kdfParams.parallelism).toBe(KDF_PARAMS.parallelism);
    });

    it('opens under THIS DEVICE password', async () => {
        const { restored } = await restoreInto(exported);

        const plaintext = await decryptWalletSeed({
            password: DEVICE_PASSWORD,
            encryptedSeed: restored.encryptedSeed,
            kdfParams: restored.kdfParams,
        });
        // Compared as a boolean: a failure message must never print a mnemonic.
        expect(new TextDecoder().decode(plaintext) === MNEMONIC,
            'the device password did not recover the seed, so the restored wallet cannot sign - '
            + 'which is the entire defect  exists to close')
            .toBe(true);
    });

    it('no longer opens under the password it was backed up with', async () => {
        // The seal MOVED. Had it merely been copied, the record would be
        // openable by two passwords, one of which the user has no reason to
        // still know.
        const { restored } = await restoreInto(exported);

        let opened = false;
        try {
            await decryptWalletSeed({
                password: ORIGINAL_PASSWORD,
                encryptedSeed: restored.encryptedSeed,
                kdfParams: restored.kdfParams,
            });
            opened = true;
        } catch { /* expected: the AEAD tag fails under the old key */ }
        expect(opened, 'the pre-restore password still opens the restored seed').toBe(false);
    });

    it('moves the imported WIF too, not just the seed', async () => {
        // `importWif` seals importedKeys with the SAME master key as the seed.
        // Re-keying only the seed would move the failure to the WIF lane, and a
        // wif-only wallet (empty encryptedSeed) would not be repaired at all.
        const { restored } = await restoreInto(exported);

        const key = restored.importedKeys[0];
        expect(key.encryptedWif === sealedWif,
            'the imported WIF ciphertext came through untouched, so it is still sealed under the '
            + 'old password while the seed is not')
            .toBe(false);

        const mk = deriveMasterKey(DEVICE_PASSWORD, restored.kdfParams);
        let recovered;
        try {
            recovered = await decrypt(mk, base64ToBytes(key.encryptedWif));
        } finally {
            mk.fill(0);
        }
        expect(new TextDecoder().decode(recovered) === WIF,
            'the device password did not recover the imported WIF')
            .toBe(true);
    });

    it('a WRONG wallet password fails at RESTORE time and writes nothing', async () => {
        // The teeth. Before  there was no restore-time check at all: the
        // wallet landed, looked complete, and failed at the first signature.
        const target = makeVault();
        await expect(importBackupFile({
            vault: target,
            fileContent: exported,
            password: BACKUP_PASSWORD,
            walletPassword: 'not-the-wallets-password',
            devicePassword: DEVICE_PASSWORD,
            mode: 'add',
        })).rejects.toBeInstanceOf(BackupSeedPasswordError);

        expect(await target.wallets.list(),
            'a refused restore still wrote a wallet record into the vault')
            .toHaveLength(0);
        expect(await target.addresses.list(),
            'a refused restore still wrote addresses into the vault')
            .toHaveLength(0);
    });

    it('refuses to restore key material with no device password to re-seal under', async () => {
        // Omitting it is how a caller silently reintroduces the defect, so it is
        // an error rather than a skip.
        //
        // : the refusal names the FIELD, not the parameter. This used to
        // assert `/devicePassword is required/`, which is a string that only
        // means something to whoever wrote the call site; the user is looking
        // at three password boxes and needs to know which one is empty.
        const target = makeVault();
        await expect(importBackupFile({
            vault: target,
            fileContent: exported,
            password: BACKUP_PASSWORD,
            walletPassword: ORIGINAL_PASSWORD,
            mode: 'add',
        })).rejects.toThrow(new RegExp(`"${RESTORE_PASSWORD_LABELS.device.fresh}" field is required`));
        expect(await target.wallets.list()).toHaveLength(0);
    });

    it('a password typed into the WRONG BOX is told which box wants it ', async () => {
        // The reported failure, exactly: the user puts THIS DEVICE's password
        // into the backup-file field. It is a password they really do use, so
        // "wrong password" reads as the app being broken rather than as a
        // mix-up, and the mix-up is the likely one on a screen with three
        // password boxes.
        const caught = await importBackupFile({
            vault: makeVault(),
            fileContent: exported,
            password: DEVICE_PASSWORD,          // the wrong ROLE, not a typo
            walletPassword: ORIGINAL_PASSWORD,
            devicePassword: DEVICE_PASSWORD,
            mode: 'add',
        }).then(() => null, (e) => e);

        expect(caught, 'the wrong file password restored anyway').toBeTruthy();
        expect(caught.message,
            'the restore rejected a correct-but-misfiled password without naming which of the '
            + 'three passwords it wanted, which is the whole of ')
            .toContain('backup file');
        expect(restoreFailureMessage(caught, { mode: 'add' }))
            .toContain(RESTORE_PASSWORD_LABELS.file);
        // And it does NOT blame the field that was right.
        expect(restoreFailureMessage(caught, { mode: 'add' }))
            .not.toContain(`The "${RESTORE_PASSWORD_LABELS.wallet}" field wants`);
    });

    it('a wrong WALLET password blames the wallet field, not the file one', async () => {
        // The near-miss that makes ordering matter: this failure mentions the
        // backup file too (it says the file opened), so a classifier that looks
        // for "backup file" first sends the user to retype a password that was
        // correct.
        const caught = await importBackupFile({
            vault: makeVault(),
            fileContent: exported,
            password: BACKUP_PASSWORD,
            walletPassword: 'not-the-wallets-password',
            devicePassword: DEVICE_PASSWORD,
            mode: 'add',
        }).then(() => null, (e) => e);

        const copy = restoreFailureMessage(caught, { mode: 'add' });
        expect(copy).toContain(RESTORE_PASSWORD_LABELS.wallet);
        expect(copy).not.toContain(`The "${RESTORE_PASSWORD_LABELS.file}" field wants`);
    });

    it('the backup-file password never opens the seed either', async () => {
        // Worth pinning because the restore screen asks for exactly this one,
        // which is the password a user is most likely to assume unlocks the
        // wallet afterwards.
        const { restored } = await restoreInto(exported);

        let opened = false;
        try {
            await decryptWalletSeed({
                password: BACKUP_PASSWORD,
                encryptedSeed: restored.encryptedSeed,
                kdfParams: restored.kdfParams,
            });
            opened = true;
        } catch { /* expected */ }
        expect(opened,
            'the BACKUP-file password opened the wallet seed, which would mean the two passwords the '
            + 'UI says are independent are not')
            .toBe(false);
    });
});
