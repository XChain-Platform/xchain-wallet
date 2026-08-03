// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : which password opens a RESTORED wallet's seed.
//
// WHY THIS EXISTS. The §19.4 envelope carries the wallet record verbatim -
// including `encryptedSeed` and that wallet's OWN `kdf` - and `importBackupFile`
// re-encrypts nothing. So a restored wallet's seed is opened by the password the
// wallet had when it was backed up, and by no other. That is invisible to every
// existing backup test, because they all use a STUB `encryptedSeed`
// (`{ iv: 'AAAA', tag: 'BBBB', ct: 'CCCC' }`) that is never decrypted. This one
// encrypts a real seed and then tries to open it.
//
// WHAT IT PINS, and why it matters beyond its own lane:
//
//   1. The restored record's ciphertext and kdf params are byte-identical to the
//      source. That is the mechanism; everything else follows from it.
//   2. The ORIGINAL wallet password opens the restored seed.
//   3. A DIFFERENT password does not - so a restore performed under a new device
//      password produces a wallet that cannot sign.
//
// (3) is not theoretical. `SignerPool.populate` unlocks each wallet with the one
// password it was handed and, on failure, "skip[s] it" so "the op-level fallback
// (password prompt) will surface the real error if the user tries to use that
// wallet". Nothing at restore time tells the user; the wallet restores, looks
// complete, and fails at the first signature.
//
// It applies to the mode='add' lane that ships today (restore into a vault whose
// device password differs from the backed-up wallet's), and it is the reason the
//  fresh-install lane must ask for the password of the wallet IN the
// backup rather than letting the user pick a new one.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';

// Every case here pays a real Argon2id derivation at the production floor.
vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });
import {
    exportBackupFile,
    importBackupFile,
} from '../../../packages/core/src/flows/backupFile.js';
import {
    encryptWalletSeed,
    decryptWalletSeed,
} from '../../../packages/core/src/crypto/walletBlob.js';

// Argon2id at real cost would make this test slow for no extra truth: what is
// under test is WHICH key opens the blob, not how expensive the KDF is.
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

/** The password the wallet was created with, and still carries inside the backup. */
const ORIGINAL_PASSWORD = 'original-device-password';
/** What a user would type on a NEW device if the lane let them choose freely. */
const NEW_DEVICE_PASSWORD = 'a-brand-new-device-password';
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

describe('integration/flows/backup restore: which password opens the seed ', () => {
    let sourceVault;
    let exported;
    /** @type {{ encryptedSeed: string, kdfParams: any }} */
    let sealed;

    beforeEach(async () => {
        // A REAL encrypted seed, sealed under the wallet's own password.
        sealed = await encryptWalletSeed({
            password: ORIGINAL_PASSWORD,
            seed: new TextEncoder().encode(MNEMONIC),
            kdfParams: KDF_PARAMS,
        });

        sourceVault = makeVault({
            wallets: [{
                id: 'src',
                schemaVersion: 1,
                name: 'Backed-up Wallet',
                kind: 'mnemonic',
                format: 'bip39',
                encryptedSeed: sealed.encryptedSeed,
                kdf: sealed.kdfParams,
                importedKeys: [],
            }],
            accounts: [{ id: 'acc-src', walletId: 'src', schemaVersion: 1, label: 'Account 0', accountIndex: 0 }],
            addresses: [{
                id: 'addr-1', schemaVersion: 1, accountId: 'acc-src', address: 'bc1qexample',
                derivationPath: "m/84'/0'/0'/0/0", addressType: 'p2wpkh',
            }],
        });

        const r = await exportBackupFile({
            vault: sourceVault,
            walletId: 'src',
            password: BACKUP_PASSWORD,
            kdfParams: KDF_PARAMS,
        });
        exported = r.fileContent;
    });

    it('carries the seed ciphertext and its kdf params through unchanged', async () => {
        // The mechanism, stated first: nothing re-encrypts, so the restored
        // record is sealed exactly as it was on the old device.
        const target = makeVault();
        const res = await importBackupFile({
            vault: target, fileContent: exported, password: BACKUP_PASSWORD, mode: 'add',
        });
        const restored = await target.wallets.get(res.walletId);

        expect(restored, 'the restore produced no wallet record').toBeTruthy();
        expect(restored.encryptedSeed === sealed.encryptedSeed,
            'the restored seed ciphertext differs from the source, so something DID re-encrypt it '
            + 'and the rest of this file is testing the wrong invariant')
            .toBe(true);
        expect(JSON.stringify(restored.kdf) === JSON.stringify(sealed.kdfParams),
            'the restored wallet carries different kdf params from the source')
            .toBe(true);
    });

    it('opens under the password the wallet had when it was backed up', async () => {
        const target = makeVault();
        const res = await importBackupFile({
            vault: target, fileContent: exported, password: BACKUP_PASSWORD, mode: 'add',
        });
        const restored = await target.wallets.get(res.walletId);

        const plaintext = await decryptWalletSeed({
            password: ORIGINAL_PASSWORD,
            encryptedSeed: restored.encryptedSeed,
            kdfParams: restored.kdf,
        });
        // Compared as a boolean: a failure message must never print a mnemonic.
        expect(new TextDecoder().decode(plaintext) === MNEMONIC,
            'the original password did not recover the seed, so the backup does not round-trip at all')
            .toBe(true);
    });

    it('does NOT open under a different device password, which is the trap', async () => {
        // The assertion the lane turns on. If this ever starts passing, some
        // path has begun re-keying the seed on import and the fresh-install
        // lane may safely let the user choose a new password.
        const target = makeVault();
        const res = await importBackupFile({
            vault: target, fileContent: exported, password: BACKUP_PASSWORD, mode: 'add',
        });
        const restored = await target.wallets.get(res.walletId);

        let opened = false;
        try {
            await decryptWalletSeed({
                password: NEW_DEVICE_PASSWORD,
                encryptedSeed: restored.encryptedSeed,
                kdfParams: restored.kdf,
            });
            opened = true;
        } catch {
            // Expected: the AEAD tag fails under a key derived from another password.
        }
        expect(opened,
            'a restored wallet opened under a password it was never sealed with. If that is now true '
            + 'the seed is not password-bound and this is a much bigger finding than the one this test '
            + 'was written for')
            .toBe(false);
    });

    it('the backup password alone never opens the seed either', async () => {
        // Worth pinning because the restore screen asks for exactly this one,
        // which is the password a user is most likely to assume unlocks the
        // wallet afterwards.
        const target = makeVault();
        const res = await importBackupFile({
            vault: target, fileContent: exported, password: BACKUP_PASSWORD, mode: 'add',
        });
        const restored = await target.wallets.get(res.walletId);

        let opened = false;
        try {
            await decryptWalletSeed({
                password: BACKUP_PASSWORD,
                encryptedSeed: restored.encryptedSeed,
                kdfParams: restored.kdf,
            });
            opened = true;
        } catch { /* expected */ }
        expect(opened,
            'the BACKUP-file password opened the wallet seed, which would mean the two passwords the '
            + 'UI says are independent are not')
            .toBe(false);
    });
});
