// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Recovery-phrase password reset (operator ruling 2026-11-16), real crypto end
// to end: a real Vault over in-memory backends, real Argon2id at demo cost and
// real wallet seals. The question is the one a user with a forgotten password
// asks: does the phrase get me back in with everything still there?

import { describe, expect, it, vi } from 'vitest';

// The recovery paths refuse KDF params below the KDF_MIN_* floors. This file
// runs real Argon2id at demo cost, so the floors are lowered to that cost
// (FAST below), and the attacks go under it. The derivation itself is real.
vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => ({
    ...(await importOriginal()),
    KDF_MIN_ITERATIONS: 1,
    KDF_MIN_MEMORY_KIB: 8192,
}));

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { storage as storageLib, crypto as cryptoLib } from '../../../packages/core/src/index.js';
import { encryptWalletSeed, decryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { encrypt, decrypt } from '../../../packages/core/src/crypto/aead.js';
import { bytesToBase64, base64ToBytes } from '../../../packages/core/src/crypto/kdf.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { createContact } from '../../../packages/core/src/schemas/contact.js';
import {
    dropPhraseRecoveryWallet,
    dropPhraseRecoveryWalletInMeta,
    phraseResetAvailable,
    readPhraseRecovery,
    reconcilePhraseRecovery,
    reconcilePhraseRecoveryInMeta,
    resetPasswordWithRecoveryPhrase,
    vaultWalletIds,
    withPhraseRecovery,
} from '../../../packages/core/src/flows/phraseRecovery.js';
import {
    RECOVERY_BUNDLE_AAD,
    derivePhraseKey,
    openRecoveryBundle,
    openRecoveryEntry,
    openRecoveryKey,
    sealRecoveryBundle,
} from '../../../packages/core/src/crypto/phraseRecovery.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const FAST = { algorithm: 'argon2id', iterations: 1, memory: 8192, parallelism: 1 };
const VAULT_KDF = { ...FAST, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' };
// A wallet added after onboarding carries its own salt, so its seal key is
// NOT the vault key: the case a vault-key-only wrap would lose.
const OTHER_KDF = { ...FAST, salt: 'AQEBAQEBAQEBAQEBAQEBAQ==' };
const PHRASE_KDF = { ...FAST, salt: 'AgICAgICAgICAgICAgICAg==' };

const MNEMONIC_A = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const MNEMONIC_B = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
const MNEMONIC_WRONG = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const OLD = 'old-wallet-password';
const NEW = 'brand-new-password';
const WIF_BYTES = new TextEncoder().encode('cVt4o7BGAig1UXywgGSmARhxMdzP5qvQsxKkSsc1XEkw3tDTQFpy');

function memBackend() {
    let v = null;
    return {
        load: async () => v,
        save: async (next) => { v = next instanceof Uint8Array ? new Uint8Array(next) : next; },
        clear: async () => { v = null; },
    };
}

async function seedWallet({ id, mnemonic, password = OLD, kdfParams, importedWif = false }) {
    const sealed = await encryptWalletSeed({ password, seed: new TextEncoder().encode(mnemonic), kdfParams });
    const wallet = {
        ...createWallet({
            name: `Wallet ${id}`,
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: sealed.encryptedSeed,
            kdfParams: sealed.kdfParams,
        }),
        id,
    };
    if (importedWif) {
        // importWif seals an imported key under the wallet's own master key.
        const key = cryptoLib.deriveMasterKey(password, kdfParams);
        wallet.importedKeys = [{
            addressId: `addr-${id}`,
            encryptedWif: bytesToBase64(await encrypt(key, WIF_BYTES)),
            importedAt: new Date().toISOString(),
        }];
        key.fill(0);
    }
    return wallet;
}

function hardwareWallet(id) {
    return {
        ...createWallet({
            name: `Ledger ${id}`,
            origin: 'connected-hardware',
            format: 'hardware',
            passphraseEnabled: false,
            encryptedSeed: '',
            kdfParams: VAULT_KDF,
        }),
        id,
    };
}

/** A vault as onboarding leaves it, plus `specs` wallets and one contact. */
async function onboarded(walletRecords) {
    const storageBackend = memBackend();
    const metaBackend = memBackend();
    await metaBackend.save({ kdfParams: VAULT_KDF });
    const vaultKey = cryptoLib.deriveMasterKey(OLD, VAULT_KDF);
    const vault = new storageLib.Vault({ backend: storageBackend, masterKey: vaultKey });
    await vault.open();
    for (const record of walletRecords) await vault.wallets.put(record);
    await vault.contacts.put(createContact({
        name: 'Alice',
        entries: [{ chain: 'bitcoin', address: 'bc1qalice', label: '' }],
    }));
    return { vault, vaultKey, storageBackend, metaBackend };
}

async function reconcileStored(env, extra = {}) {
    return reconcilePhraseRecoveryInMeta({
        metaBackend: env.metaBackend,
        vault: env.vault,
        vaultKey: env.vaultKey,
        password: OLD,
        phraseKdfParams: PHRASE_KDF,
        ...extra,
    });
}

async function openVault(storageBackend, password) {
    const key = cryptoLib.deriveMasterKey(password, VAULT_KDF);
    const vault = new storageLib.Vault({ backend: storageBackend, masterKey: key });
    key.fill(0);
    await vault.open();
    return vault;
}

describe('the vault key alone does not open a later wallet', () => {
    it('a wallet with its own salt and its imported key stay shut under the vault key', async () => {
        const env = await onboarded([await seedWallet({ id: 'w2', mnemonic: MNEMONIC_B, kdfParams: OTHER_KDF, importedWif: true })]);
        const [w2] = await env.vault.wallets.list();
        await expect(decryptWalletSeed({ encryptedSeed: w2.encryptedSeed, kdfParams: w2.kdfParams, masterKey: env.vaultKey }))
            .rejects.toThrow();
        await expect(decrypt(env.vaultKey, base64ToBytes(w2.importedKeys[0].encryptedWif))).rejects.toThrow();
    });
});

describe('the recovery wrap is written', () => {
    it('on create and import: one entry per seed wallet, none for a hardware wallet', async () => {
        const env = await onboarded([
            await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF }),
            await seedWallet({ id: 'w2', mnemonic: MNEMONIC_B, kdfParams: OTHER_KDF, importedWif: true }),
            hardwareWallet('hw1'),
        ]);
        expect(await reconcileStored(env)).toBe(true);
        const meta = await env.metaBackend.load();
        expect(meta.kdfParams).toEqual(VAULT_KDF);
        expect(phraseResetAvailable(meta)).toBe(true);
        const record = readPhraseRecovery(meta.phraseRecovery);
        expect(record.entries.map((e) => e.walletId).sort()).toEqual(['w1', 'w2']);
        expect(meta.walletIds.sort()).toEqual(['hw1', 'w1', 'w2']);
        expect(vaultWalletIds(meta).sort()).toEqual(['hw1', 'w1', 'w2']);
        expect(vaultWalletIds({ phraseRecovery: meta.phraseRecovery }).sort()).toEqual(['w1', 'w2']);
        // Plain metadata, no secret in the clear.
        expect(JSON.stringify(meta)).not.toContain('legal winner');

        // Each phrase opens the same recovery key; the bundle holds the vault key and both seal keys.
        const phraseKey = await derivePhraseKey(MNEMONIC_B, record.kdfParams);
        const rk = await openRecoveryEntry(phraseKey, record.entries.find((e) => e.walletId === 'w2'));
        expect(rk).not.toBeNull();
        const bundle = await openRecoveryBundle(rk, record.bundle);
        expect([...bundle.walletKeys.keys()].sort()).toEqual(['w1', 'w2']);
        expect(Buffer.from(bundle.vaultKey).equals(Buffer.from(env.vaultKey))).toBe(true);
    });

    it('as a backfill on the next unlock for a wallet made before the wrap existed, and not again after', async () => {
        const env = await onboarded([await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF })]);
        expect((await env.metaBackend.load()).phraseRecovery).toBeUndefined();
        expect(await reconcileStored(env)).toBe(true);
        const first = (await env.metaBackend.load()).phraseRecovery;
        // A second unlock finds everything current and writes nothing.
        expect(await reconcileStored(env)).toBe(false);
        expect((await env.metaBackend.load()).phraseRecovery).toEqual(first);
    });

    it('for a wallet added later, keeping the earlier entry as it was', async () => {
        const env = await onboarded([await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF })]);
        await reconcileStored(env);
        const before = readPhraseRecovery((await env.metaBackend.load()).phraseRecovery);
        await env.vault.wallets.put(await seedWallet({ id: 'w2', mnemonic: MNEMONIC_B, kdfParams: OTHER_KDF }));
        expect(await reconcileStored(env)).toBe(true);
        const after = readPhraseRecovery((await env.metaBackend.load()).phraseRecovery);
        expect(after.entries.find((e) => e.walletId === 'w1').wrap).toBe(before.entries[0].wrap);
        expect(after.entries.map((e) => e.walletId)).toEqual(['w1', 'w2']);
    });

    it('never writes over a meta slot that a new vault replaced meanwhile', async () => {
        const env = await onboarded([await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF })]);
        const realLoad = env.metaBackend.load;
        let calls = 0;
        env.metaBackend.load = async () => {
            calls += 1;
            return calls === 1 ? realLoad() : { kdfParams: OTHER_KDF };
        };
        const save = vi.spyOn(env.metaBackend, 'save');
        expect(await reconcileStored(env)).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });
});

describe('resetPasswordWithRecoveryPhrase', () => {
    async function resetEnv() {
        const env = await onboarded([
            await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF, importedWif: true }),
            await seedWallet({ id: 'w2', mnemonic: MNEMONIC_B, kdfParams: OTHER_KDF, importedWif: true }),
        ]);
        await reconcileStored(env);
        env.vault.close();
        return env;
    }

    it('keeps every wallet, imported key and contact, and the new password opens all of it', async () => {
        const env = await resetEnv();
        const blobBefore = await env.storageBackend.load();
        const result = await resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend,
            meta: await env.metaBackend.load(),
            phrase: `  ${MNEMONIC_A.toUpperCase()}  `,
            newPassword: NEW,
        });
        await env.metaBackend.save(result.meta);
        expect(result.resetWalletIds.sort()).toEqual(['w1', 'w2']);
        expect(result.skippedWalletIds).toEqual([]);
        expect(await env.storageBackend.load()).not.toEqual(blobBefore);

        await expect(openVault(env.storageBackend, OLD)).rejects.toMatchObject({ name: 'AeadAuthError' });
        const vault = await openVault(env.storageBackend, NEW);
        expect((await vault.contacts.list()).map((c) => c.name)).toEqual(['Alice']);
        for (const wallet of await vault.wallets.list()) {
            const key = cryptoLib.deriveMasterKey(NEW, wallet.kdfParams);
            const seed = await decryptWalletSeed({ encryptedSeed: wallet.encryptedSeed, kdfParams: wallet.kdfParams, masterKey: key });
            expect(new TextDecoder().decode(seed)).toBe(wallet.id === 'w1' ? MNEMONIC_A : MNEMONIC_B);
            const wif = await decrypt(key, base64ToBytes(wallet.importedKeys[0].encryptedWif));
            expect(new TextDecoder().decode(wif)).toBe(new TextDecoder().decode(WIF_BYTES));
            key.fill(0);
        }
        // The salts are kept, as a password change keeps them.
        expect((await vault.wallets.get('w2')).kdfParams).toEqual(OTHER_KDF);

        // The record follows the new key: the other wallet's phrase resets it again.
        const vaultKey = cryptoLib.deriveMasterKey(NEW, VAULT_KDF);
        const record = readPhraseRecovery(result.meta.phraseRecovery);
        expect(await openRecoveryKey(vaultKey, record.keySeal)).not.toBeNull();
        vault.close();
        const again = await resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend,
            meta: result.meta,
            phrase: MNEMONIC_B,
            newPassword: 'third-password',
        });
        expect(again.resetWalletIds.sort()).toEqual(['w1', 'w2']);
        (await openVault(env.storageBackend, 'third-password')).close();
    });

    it('a wrong phrase changes nothing and says so', async () => {
        const env = await resetEnv();
        const meta = await env.metaBackend.load();
        const blob = await env.storageBackend.load();
        await expect(resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta, phrase: MNEMONIC_WRONG, newPassword: NEW,
        })).rejects.toMatchObject({ name: 'RecoveryPhraseMismatchError' });
        expect(await env.storageBackend.load()).toEqual(blob);
        expect(await env.metaBackend.load()).toEqual(meta);
        (await openVault(env.storageBackend, OLD)).close();
    });

    it('with several wallets, any one wallet\'s phrase works', async () => {
        const env = await resetEnv();
        const result = await resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend,
            meta: await env.metaBackend.load(),
            phrase: MNEMONIC_B,
            newPassword: NEW,
        });
        expect(result.resetWalletIds.sort()).toEqual(['w1', 'w2']);
        (await openVault(env.storageBackend, NEW)).close();
    });

    it('a removed wallet\'s phrase no longer resets the vault', async () => {
        const env = await resetEnv();
        const meta = dropPhraseRecoveryWallet(await env.metaBackend.load(), 'w2');
        expect(readPhraseRecovery(meta.phraseRecovery).entries.map((e) => e.walletId)).toEqual(['w1']);
        expect(meta.walletIds).toEqual(['w1']);
        await expect(resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta, phrase: MNEMONIC_B, newPassword: NEW,
        })).rejects.toMatchObject({ name: 'RecoveryPhraseMismatchError' });
        // Dropping the last wrap removes the record.
        const none = dropPhraseRecoveryWallet(meta, 'w1');
        expect(none.phraseRecovery).toBeUndefined();
        expect(none.walletIds).toEqual([]);
        expect(phraseResetAvailable(none)).toBe(false);
        expect(none.kdfParams).toEqual(VAULT_KDF);
    });

    it('is unavailable to a hardware-only vault', async () => {
        const env = await onboarded([hardwareWallet('hw1')]);
        expect(await reconcileStored(env)).toBe(true);
        const meta = await env.metaBackend.load();
        expect(phraseResetAvailable(meta)).toBe(false);
        expect(vaultWalletIds(meta)).toEqual(['hw1']);
        await expect(resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta, phrase: MNEMONIC_A, newPassword: NEW,
        })).rejects.toMatchObject({ name: 'PhraseResetUnavailableError' });
    });

    it('a stale record (vault key moved, meta write lost) refuses without writing, and the next unlock repairs it', async () => {
        const env = await resetEnv();
        const meta = await env.metaBackend.load();
        // A password change rekeys the blob but its meta write never lands.
        const vault = await openVault(env.storageBackend, OLD);
        const newKey = cryptoLib.deriveMasterKey(NEW, VAULT_KDF);
        await vault.rekey({ masterKey: newKey });
        const blob = await env.storageBackend.load();
        await expect(resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta, phrase: MNEMONIC_A, newPassword: 'another-password',
        })).rejects.toMatchObject({ name: 'PhraseResetStaleError' });
        expect(await env.storageBackend.load()).toEqual(blob);

        // The next unlock (with the password the vault opens under now) rebuilds the keySeal.
        const repaired = await reconcilePhraseRecovery({
            vault,
            vaultKey: newKey,
            vaultKdfParams: VAULT_KDF,
            password: OLD,
            current: meta.phraseRecovery,
        });
        expect(repaired.changed).toBe(true);
        expect(await openRecoveryKey(newKey, repaired.record.keySeal)).not.toBeNull();
        vault.close();
        newKey.fill(0);
    });

    it('refuses a short new password before touching anything', async () => {
        const env = await resetEnv();
        await expect(resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta: await env.metaBackend.load(), phrase: MNEMONIC_A, newPassword: 'short',
        })).rejects.toThrow(/at least 8/);
    });
});

describe('re-wrap when the master key changes', () => {
    it('a password change keeps every entry and moves the key seal and bundle onto the new key', async () => {
        const env = await onboarded([
            await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF }),
            await seedWallet({ id: 'w2', mnemonic: MNEMONIC_B, kdfParams: OTHER_KDF }),
        ]);
        await reconcileStored(env);
        const before = readPhraseRecovery((await env.metaBackend.load()).phraseRecovery);

        // What changeWalletPassword does: re-seal each wallet and the vault under NEW.
        const { rekeyWalletRecord } = await import('../../../packages/core/src/flows/backupFile.js');
        const stored = await env.vault.wallets.list();
        const copies = [];
        for (const w of stored) {
            const copy = { ...w, kdfParams: { ...w.kdfParams } };
            await rekeyWalletRecord(copy, { walletPassword: OLD, devicePassword: NEW, kdfParams: copy.kdfParams });
            copies.push(copy);
        }
        const newKey = cryptoLib.deriveMasterKey(NEW, VAULT_KDF);
        await env.vault.rekey({ masterKey: newKey, wallets: copies, readWallets: stored });
        expect(await reconcileStored({ ...env, vaultKey: newKey }, { password: NEW, previousVaultKey: env.vaultKey })).toBe(true);

        const after = readPhraseRecovery((await env.metaBackend.load()).phraseRecovery);
        expect(after.entries).toEqual(before.entries);
        expect(await openRecoveryKey(newKey, after.keySeal)).not.toBeNull();
        env.vault.close();
        const result = await resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend,
            meta: await env.metaBackend.load(),
            phrase: MNEMONIC_B,
            newPassword: 'third-password',
        });
        expect(result.resetWalletIds.sort()).toEqual(['w1', 'w2']);
    });
});

describe('record parsing', () => {
    it('rejects malformed records and hostile KDF params', async () => {
        expect(readPhraseRecovery(null)).toBeNull();
        expect(readPhraseRecovery({ version: 2 })).toBeNull();
        const rk = new Uint8Array(32).fill(7);
        const record = {
            version: 1,
            kdfParams: { ...PHRASE_KDF, memory: 1024 * 1024 * 1024 },
            keySeal: 'x',
            bundle: await sealRecoveryBundle(rk, { vaultKey: new Uint8Array(32), walletKeys: new Map() }),
            entries: [],
        };
        expect(readPhraseRecovery(record)).toBeNull();
        // Removing the record still moves the write counter, so a stale reconcile sees it.
        expect(withPhraseRecovery({ kdfParams: VAULT_KDF, phraseRecovery: record }, null))
            .toEqual({ kdfParams: VAULT_KDF, phraseRecoveryGen: 1 });
    });
});

// Security review of the Forgot Password recovery, 2026-11-16.

/** The recovery key a phrase opens from one record's entry for `walletId`. */
async function recoveryKeyFrom(record, mnemonic, walletId) {
    const phraseKey = await derivePhraseKey(mnemonic, record.kdfParams);
    try {
        return await openRecoveryEntry(phraseKey, record.entries.find((e) => e.walletId === walletId));
    } finally {
        phraseKey.fill(0);
    }
}

const BELOW_FLOOR = { memory: 1024 };

describe('KDF floors on the recovery paths', () => {
    it('a reset refuses vault KDF params lowered below the floor and writes nothing', async () => {
        const env = await onboarded([await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF })]);
        await reconcileStored(env);
        env.vault.close();
        const meta = await env.metaBackend.load();
        // Plain meta: anyone with the device's storage can lower the cost the
        // reset would derive the new vault key under.
        const lowered = { ...meta, kdfParams: { ...meta.kdfParams, ...BELOW_FLOOR } };
        const blob = await env.storageBackend.load();
        expect(phraseResetAvailable(lowered)).toBe(false);
        await expect(resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta: lowered, phrase: MNEMONIC_A, newPassword: NEW,
        })).rejects.toMatchObject({ name: 'PhraseResetUnavailableError' });
        expect(await env.storageBackend.load()).toEqual(blob);
        (await openVault(env.storageBackend, OLD)).close();
    });

    it('a record whose phrase KDF params sit below the floor reads as absent', async () => {
        const env = await onboarded([await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF })]);
        await reconcileStored(env);
        const meta = await env.metaBackend.load();
        const weak = { ...meta.phraseRecovery, kdfParams: { ...meta.phraseRecovery.kdfParams, ...BELOW_FLOOR } };
        expect(readPhraseRecovery(weak)).toBeNull();
        expect(phraseResetAvailable({ ...meta, phraseRecovery: weak })).toBe(false);
    });

    it('a reconcile never seals a new entry under lowered phrase params', async () => {
        const env = await onboarded([await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF })]);
        await reconcileStored(env);
        const meta = await env.metaBackend.load();
        await env.metaBackend.save({
            ...meta,
            phraseRecovery: { ...meta.phraseRecovery, kdfParams: { ...meta.phraseRecovery.kdfParams, ...BELOW_FLOOR } },
        });
        await env.vault.wallets.put(await seedWallet({ id: 'w2', mnemonic: MNEMONIC_B, kdfParams: OTHER_KDF }));
        await reconcileStored(env);
        const after = (await env.metaBackend.load()).phraseRecovery;
        expect(after.kdfParams.memory).toBeGreaterThanOrEqual(FAST.memory);
        expect(after.kdfParams.iterations).toBeGreaterThanOrEqual(FAST.iterations);
        expect(readPhraseRecovery(after).entries.map((e) => e.walletId).sort()).toEqual(['w1', 'w2']);
    });
});

describe('the recovery key rotates', () => {
    it('on wallet remove: an old copy\'s wrap for the removed wallet opens no current bundle', async () => {
        const env = await onboarded([
            await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF }),
            await seedWallet({ id: 'w2', mnemonic: MNEMONIC_B, kdfParams: OTHER_KDF }),
        ]);
        await reconcileStored(env);
        const oldCopy = readPhraseRecovery((await env.metaBackend.load()).phraseRecovery);
        const oldRk = await recoveryKeyFrom(oldCopy, MNEMONIC_B, 'w2');
        expect(oldRk).not.toBeNull();

        // What wallet.remove runs: the record drop, then the rotation.
        await env.vault.wallets.delete('w2');
        await dropPhraseRecoveryWalletInMeta(env.metaBackend, 'w2');
        await reconcileStored(env, { password: undefined, rotate: true });

        const after = readPhraseRecovery((await env.metaBackend.load()).phraseRecovery);
        expect(after.entries.map((e) => e.walletId)).toEqual(['w1']);
        expect(await openRecoveryBundle(oldRk, after.bundle)).toBeNull();
        // The kept wallet's phrase still resets.
        env.vault.close();
        const result = await resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta: await env.metaBackend.load(), phrase: MNEMONIC_A, newPassword: NEW,
        });
        expect(result.resetWalletIds).toEqual(['w1']);
    });

    it('on password change: the old password and an old copy of the record open nothing current', async () => {
        const env = await onboarded([
            await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF }),
            await seedWallet({ id: 'w2', mnemonic: MNEMONIC_B, kdfParams: OTHER_KDF }),
        ]);
        await reconcileStored(env);
        const oldCopy = readPhraseRecovery((await env.metaBackend.load()).phraseRecovery);
        // The old password derives the old vault key, which opens the old key seal.
        const oldRk = await openRecoveryKey(cryptoLib.deriveMasterKey(OLD, VAULT_KDF), oldCopy.keySeal);
        expect(oldRk).not.toBeNull();

        const { rekeyWalletRecord } = await import('../../../packages/core/src/flows/backupFile.js');
        const stored = await env.vault.wallets.list();
        const copies = [];
        for (const w of stored) {
            const copy = { ...w, kdfParams: { ...w.kdfParams } };
            await rekeyWalletRecord(copy, { walletPassword: OLD, devicePassword: NEW, kdfParams: copy.kdfParams });
            copies.push(copy);
        }
        const newKey = cryptoLib.deriveMasterKey(NEW, VAULT_KDF);
        await env.vault.rekey({ masterKey: newKey, wallets: copies, readWallets: stored });
        // What wallet.changePassword runs.
        expect(await reconcileStored({ ...env, vaultKey: newKey }, {
            password: NEW, previousVaultKey: env.vaultKey, rotate: true,
        })).toBe(true);

        const after = readPhraseRecovery((await env.metaBackend.load()).phraseRecovery);
        expect(await openRecoveryBundle(oldRk, after.bundle)).toBeNull();
        expect(after.entries.map((e) => e.walletId).sort()).toEqual(['w1', 'w2']);
        env.vault.close();
        for (const [phrase, pw] of [[MNEMONIC_A, 'third-password'], [MNEMONIC_B, 'fourth-password']]) {
            const result = await resetPasswordWithRecoveryPhrase({
                storageBackend: env.storageBackend, meta: await env.metaBackend.load(), phrase, newPassword: pw,
            });
            await env.metaBackend.save(result.meta);
            expect(result.resetWalletIds.sort()).toEqual(['w1', 'w2']);
        }
    });

    it('on reset: the recovery key the phrase opened before the reset opens nothing after it', async () => {
        const env = await onboarded([
            await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF }),
            await seedWallet({ id: 'w2', mnemonic: MNEMONIC_B, kdfParams: OTHER_KDF }),
        ]);
        await reconcileStored(env);
        env.vault.close();
        const before = await env.metaBackend.load();
        const oldRk = await recoveryKeyFrom(readPhraseRecovery(before.phraseRecovery), MNEMONIC_A, 'w1');
        const result = await resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta: before, phrase: MNEMONIC_A, newPassword: NEW,
        });
        const after = readPhraseRecovery(result.meta.phraseRecovery);
        expect(await openRecoveryBundle(oldRk, after.bundle)).toBeNull();
        expect(after.entries.map((e) => e.walletId).sort()).toEqual(['w1', 'w2']);
        // Both phrases still reset under the new record.
        await env.metaBackend.save(result.meta);
        const again = await resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta: await env.metaBackend.load(), phrase: MNEMONIC_B, newPassword: 'third-password',
        });
        expect(again.resetWalletIds.sort()).toEqual(['w1', 'w2']);
    });
});

describe('a reconcile in flight never writes over a later change', () => {
    it('a wallet removed while an unlock reconcile runs stays removed', async () => {
        const env = await onboarded([
            await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF }),
            await seedWallet({ id: 'w2', mnemonic: MNEMONIC_B, kdfParams: OTHER_KDF }),
            hardwareWallet('hw1'),
        ]);
        await reconcileStored(env);
        // Older meta without the id list, so the next reconcile has a write to make.
        const seeded = await env.metaBackend.load();
        delete seeded.walletIds;
        await env.metaBackend.save(seeded);

        const realList = env.vault.wallets.list.bind(env.vault.wallets);
        const realLoad = env.metaBackend.load;
        let snapshot = null;
        let passthrough = false;
        let removing = false;
        let loads = 0;
        env.vault.wallets.list = async () => {
            if (passthrough) return realList();
            if (!snapshot) {
                snapshot = await realList();
                // The remove lands while the reconcile is between its read and its write.
                removing = true;
                await env.vault.wallets.delete('w2');
                await dropPhraseRecoveryWalletInMeta(env.metaBackend, 'w2');
                removing = false;
            }
            return snapshot;
        };
        env.metaBackend.load = async () => {
            if (!removing) {
                loads += 1;
                if (loads === 2) passthrough = true;
            }
            return realLoad();
        };

        await reconcileStored(env);
        env.metaBackend.load = realLoad;
        env.vault.wallets.list = realList;

        const meta = await env.metaBackend.load();
        expect(readPhraseRecovery(meta.phraseRecovery).entries.map((e) => e.walletId)).toEqual(['w1']);
        expect(meta.walletIds).not.toContain('w2');
        env.vault.close();
        await expect(resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta, phrase: MNEMONIC_B, newPassword: NEW,
        })).rejects.toMatchObject({ name: 'RecoveryPhraseMismatchError' });
    });

    it('a reconcile holding the key from before a password change writes nothing', async () => {
        const env = await onboarded([await seedWallet({ id: 'w1', mnemonic: MNEMONIC_A, kdfParams: VAULT_KDF })]);
        await reconcileStored(env);
        const staleKey = new Uint8Array(env.vaultKey);

        const { rekeyWalletRecord } = await import('../../../packages/core/src/flows/backupFile.js');
        const stored = await env.vault.wallets.list();
        const copies = [];
        for (const w of stored) {
            const copy = { ...w, kdfParams: { ...w.kdfParams } };
            await rekeyWalletRecord(copy, { walletPassword: OLD, devicePassword: NEW, kdfParams: copy.kdfParams });
            copies.push(copy);
        }
        const newKey = cryptoLib.deriveMasterKey(NEW, VAULT_KDF);
        await env.vault.rekey({ masterKey: newKey, wallets: copies, readWallets: stored });
        await reconcileStored({ ...env, vaultKey: newKey }, { password: NEW, previousVaultKey: env.vaultKey });
        const current = await env.metaBackend.load();

        const save = vi.spyOn(env.metaBackend, 'save');
        expect(await reconcileStored({ ...env, vaultKey: staleKey })).toBe(false);
        expect(save).not.toHaveBeenCalled();
        expect(await env.metaBackend.load()).toEqual(current);
        env.vault.close();
        const result = await resetPasswordWithRecoveryPhrase({
            storageBackend: env.storageBackend, meta: current, phrase: MNEMONIC_A, newPassword: 'third-password',
        });
        expect(result.resetWalletIds).toEqual(['w1']);
    });
});

describe('key material is zeroed on every exit', () => {
    it('a malformed bundle zeroes the vault key and wallet keys it had already copied', async () => {
        const rk = new Uint8Array(32).fill(7);
        // A bundle that claims two wallets and holds one: the parse throws after copying keys.
        const plain = new Uint8Array(32 + 2 + 2 + 2 + 32);
        const view = new DataView(plain.buffer);
        plain.fill(0xa5, 0, 32);
        view.setUint16(32, 2);
        view.setUint16(34, 2);
        plain.set(new TextEncoder().encode('w1'), 36);
        plain.fill(0x5a, 38, 70);
        const blob = bytesToBase64(await encrypt(rk, plain, RECOVERY_BUNDLE_AAD));

        const realSlice = Uint8Array.prototype.slice;
        const copies = [];
        const spy = vi.spyOn(Uint8Array.prototype, 'slice').mockImplementation(function (...args) {
            const out = realSlice.apply(this, args);
            if (out.length === 32 && (out.every((b) => b === 0xa5) || out.every((b) => b === 0x5a))) copies.push(out);
            return out;
        });
        try {
            expect(await openRecoveryBundle(rk, blob)).toBeNull();
        } finally {
            spy.mockRestore();
        }
        expect(copies.length).toBe(2);
        for (const copy of copies) expect(copy.every((b) => b === 0)).toBe(true);
    });
});
