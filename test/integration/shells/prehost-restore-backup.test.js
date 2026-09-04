// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Restoring an encrypted backup onto a FRESH install.
//
// The shipping `wallet.importBackup` is registered on the MessageHost, and the
// host is only built once a vault exists. On a device with no wallet there is
// no vault, so there is no host, so the restore lane on the onboarding screen
// had nothing to answer it: the single situation a backup exists FOR - a lost
// or replaced device - was the one the feature could not serve.
//
// `wallet.importBackup.fresh` is its pre-host twin, dispatched by the same
// `dispatchPreHost` that already owns wallet.create / wallet.unlock / wallet.
// import, and shared by all three shells (extension SW, Electron main, and -
// via `importBackupLocal` - the web in-page bridge).
//
// This drives the real dispatcher against in-memory backends. What it pins:
//
//   1. The restore creates the vault, and the vault opens under the NEW device
//      password afterwards.
//   2. The restored wallet's SEED opens under that same new password. This is
// the re-key seen from the fresh-install side, and it is what lets
//      the lane offer a free password choice at all.
//   3. A wrong wallet password leaves the install FRESH - no meta, no vault
//      blob, no session - so the user can simply try again. A half-onboarded
//      device that cannot be re-onboarded is worse than a refusal.
//   4. It refuses outright once a wallet exists, so this lane can never be the
//      way an existing vault gets clobbered.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

// Every case below mints a FRESH vault, and the restore handler tunes that
// vault with `makeFreshKdfParams()` called with no overrides, i.e. the
// production floor: 3 passes over 64 MiB, ~1.7s per derivation on a fast dev
// box. Each restore pays it twice, once inside the handler and once in
// `openAs` reopening under the params the restore persisted, which is what put
// this file at 76.4s on a hosted runner. Argon2id is synchronous, so a worker
// blocked that long stops answering vitest's RPC and an otherwise green run
// ends on `[vitest-worker]: Timeout calling "onTaskUpdate"` with all thirteen
// cases passed.
//
// What this file pins is the restore lane: which password opens what, and that
// the new vault's params reach the meta slot. The KDF's tuning belongs to
// test/unit/crypto/kdf.test.js, so only the no-argument DEFAULT is cheapened.
// An explicit override still wins, which keeps the one caller that passes them
// on its production path: `rekeyWalletRecord` re-seals at the cost it INHERITS
// from the backed-up wallet, asserted in
// test/integration/flows/backup-restore-seed-password.test.js. The salt still
// comes from the real helper, so it stays fresh per call.
//
// The suite still bites: re-sealing under the wrong password reds four of the
// thirteen cases with this mock in place.
vi.mock('../../../packages/core/src/crypto/kdf.js', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        makeFreshKdfParams: (overrides = {}) =>
            actual.makeFreshKdfParams({ iterations: 1, memory: 8 * 1024, ...overrides }),
    };
});

import { dispatchPreHost, PRE_HOST_MESSAGE_TYPES } from '../../../packages/extension/src/background/sessionMeta.js';
import {
    exportBackupFile,
    rekeyWalletRecord,
    BackupSeedPasswordError,
} from '../../../packages/core/src/flows/backupFile.js';
import {
    encryptWalletSeed,
    decryptWalletSeed,
    encryptWalletPassphrase,
    decryptWalletPassphrase,
} from '../../../packages/core/src/crypto/walletBlob.js';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';
import { storage as storageLib, crypto as cryptoLib } from '../../../packages/core/src/index.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { createAccount } from '../../../packages/core/src/schemas/account.js';
import { createAddress } from '../../../packages/core/src/schemas/address.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

// Demo grade, and one pass rather than two for the reason above: with the
// default cost mocked out, the fixtures are what is left. Sealing the seed,
// encoding the envelope, opening it again and re-keying both blobs put 86 of
// the file's 103 derivations at these parameters, which is 10.8s of its
// remaining 11.9s. One pass is what the sibling suites already use.
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 1,
    memory: 8192,
    parallelism: 1,
};

const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OLD_DEVICE_PASSWORD = 'the-lost-devices-password';
const NEW_DEVICE_PASSWORD = 'the-new-devices-password';
const BACKUP_PASSWORD = 'backup-file-password';
const PASSPHRASE = 'the twenty fifth word';

/** load/save/clear over a single in-memory slot, the shape the backends share. */
function memBackend() {
    let v = null;
    return {
        load: async () => v,
        save: async (next) => { v = next; },
        clear: async () => { v = null; },
        peek: () => v,
    };
}

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
    };
}

// Records come from the schema FACTORIES, not from hand-written literals. The
// real Vault validates on every put - unlike the in-memory collections the
// other backup tests use - so a hand-rolled fixture dies inside the flow on
// `schemaVersion` rather than on anything the test is about. Building them the
// way production does also means a schema bump reaches this test rather than
// rotting past it.
function sourceVaultWith(sealed, shapeWallet = (w) => w) {
    const wallet = shapeWallet({
        ...createWallet({
            name: 'Wallet From The Old Phone',
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: sealed.encryptedSeed,
            kdfParams: sealed.kdfParams,
        }),
        id: 'src',
    });
    const account = { ...createAccount({ walletId: 'src', name: 'Account 0', index: 0 }), id: 'acc-src' };
    const address = {
        ...createAddress({
            accountId: 'acc-src',
            chain: 'bitcoin',
            network: 'mainnet',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: "m/84'/0'/0'/0/0",
            address: 'bc1qexample',
            publicKey: '02'.padEnd(66, '0'),
        }),
        id: 'addr-1',
    };
    let settings = { ...createDefaultSettings(), fiatCurrency: 'EUR' };
    return {
        wallets: memCollection([wallet]),
        accounts: memCollection([account]),
        addresses: memCollection([address]),
        contacts: memCollection([]),
        connectedSites: memCollection([]),
        pendingTxs: memCollection([]),
        settings: {
            get: async () => (settings ? JSON.parse(JSON.stringify(settings)) : null),
            put: async (next) => { settings = JSON.parse(JSON.stringify(next)); },
        },
    };
}

describe('integration/shells/pre-host fresh-install backup restore', () => {
    let exported;
    let deps;
    let storageBackend;
    let sessionBackend;
    let metaBackend;
    let onUnlocked;

    beforeEach(async () => {
        const sealed = await encryptWalletSeed({
            password: OLD_DEVICE_PASSWORD,
            seed: new TextEncoder().encode(MNEMONIC),
            kdfParams: KDF_PARAMS,
        });
        const r = await exportBackupFile({
            vault: sourceVaultWith(sealed),
            walletId: 'src',
            password: BACKUP_PASSWORD,
            kdfParams: KDF_PARAMS,
        });
        exported = r.fileContent;

        storageBackend = memBackend();
        sessionBackend = memBackend();
        metaBackend = memBackend();
        onUnlocked = vi.fn();
        deps = {
            storageBackend,
            sessionBackend,
            signingSecretBackend: memBackend(),
            metaBackend,
            onUnlocked,
        };
    });

    function restore(overrides = {}) {
        return dispatchPreHost('wallet.importBackup.fresh', {
            password: NEW_DEVICE_PASSWORD,
            backupPassword: BACKUP_PASSWORD,
            walletPassword: OLD_DEVICE_PASSWORD,
            fileContent: exported,
            ...overrides,
        }, deps);
    }

    /** Reopen the persisted vault the way `wallet.unlock` would. */
    async function openAs(password) {
        const meta = await metaBackend.load();
        expect(meta?.kdfParams, 'no kdfParams were persisted, so nothing can unlock').toBeTruthy();
        const key = cryptoLib.deriveMasterKey(password, meta.kdfParams);
        try {
            const v = new storageLib.Vault({ backend: storageBackend, masterKey: key });
            await v.open();
            return v;
        } finally {
            key.fill(0);
        }
    }

    it('is routed pre-host, and does not steal the host-registered add lane', async () => {
        // Both shells that own a runtime (`ChromeRuntimeAdapter`, the desktop
        // `runtime.js`) split traffic on this exact set. Putting the plain
        // 'wallet.importBackup' string in it would route the SHIPPING add-mode
        // restore away from the host that answers it, so the two names being
        // distinct is a load-bearing fact and not a style choice.
        expect(PRE_HOST_MESSAGE_TYPES.has('wallet.importBackup.fresh')).toBe(true);
        expect(PRE_HOST_MESSAGE_TYPES.has('wallet.importBackup'),
            "the host-registered add-mode restore was moved into the pre-host set; it will now be "
            + 'answered by a dispatcher that has no case for it')
            .toBe(false);
    });

    it('creates the vault and restores the wallet into it', async () => {
        const res = await restore();

        expect(res.walletId).toBe('src');
        expect(res.walletName).toBe('Wallet From The Old Phone');
        expect(res.rekeyed, 'the restore did not re-key, so the wallet landed sealed under the old password').toBe(true);
        expect(onUnlocked, 'the shell was never told the session opened, so no host attaches').toHaveBeenCalled();
        expect(await sessionBackend.load(), 'no session key was written, so the restore left the app locked').toBeTruthy();

        const vault = await openAs(NEW_DEVICE_PASSWORD);
        const wallets = await vault.wallets.list();
        expect(wallets.map((w) => w.name)).toEqual(['Wallet From The Old Phone']);
        // The backup's own settings ride through: on a fresh vault there is
        // nothing of the user's to overwrite, and their fiat / fee / network
        // choices are part of what they are restoring.
        expect((await vault.settings.get())?.fiatCurrency).toBe('EUR');
        const addresses = await vault.addresses.list();
        expect(addresses.map((a) => a.address)).toEqual(['bc1qexample']);
    });

    it('the restored seed opens under the NEW device password', async () => {
        // The fresh-install half. Without the re-key the user would
        // choose a password here, unlock with it, and then be unable to sign.
        await restore();
        const vault = await openAs(NEW_DEVICE_PASSWORD);
        const [wallet] = await vault.wallets.list();

        const plaintext = await decryptWalletSeed({
            password: NEW_DEVICE_PASSWORD,
            encryptedSeed: wallet.encryptedSeed,
            kdfParams: wallet.kdfParams,
        });
        expect(new TextDecoder().decode(plaintext) === MNEMONIC,
            'the password the user just chose does not open the restored seed')
            .toBe(true);
    });

    it('a wrong wallet password leaves the install fresh and retryable', async () => {
        // The refusal names the FIELD on the restore screen ("Password
        // of the wallet in this backup"), where it used to describe the role in
        // prose ("the backed-up wallet's password"). Same claim, worded so the
        // user can find the box.
        await expect(restore({ walletPassword: 'wrong' }))
            .rejects.toThrow(/Password of the wallet in this backup/);

        expect(metaBackend.peek(), 'meta was written despite the refusal, so the device now looks onboarded').toBeNull();
        expect(storageBackend.peek(), 'a vault blob was persisted despite the refusal').toBeNull();
        expect(sessionBackend.peek(), 'a session key was persisted despite the refusal').toBeNull();
        expect(onUnlocked).not.toHaveBeenCalled();

        // And the correct password still works afterwards: the failure cost the
        // user nothing but a retype.
        const res = await restore();
        expect(res.walletId).toBe('src');
    });

    it('refuses once a wallet already exists', async () => {
        await restore();
        await expect(restore()).rejects.toThrow(/already exists/);
    });

    it('requires all three passwords, and says which one is missing', async () => {
        await expect(restore({ password: '' })).rejects.toThrow(/password is required \(the password this device will unlock with\)/);
        await expect(restore({ backupPassword: '' })).rejects.toThrow(/backupPassword is required/);
        await expect(restore({ walletPassword: '' })).rejects.toThrow(/walletPassword is required/);
        await expect(restore({ fileContent: '' })).rejects.toThrow(/fileContent or pointer is required/);
        expect(metaBackend.peek(), 'a rejected argument check still onboarded the device').toBeNull();
    });

    it('restores from a backup POINTER through the injected resolver', async () => {
        // The QR lane. Same merge underneath; only the way the envelope is
        // fetched differs, and the resolver is injected so the test never
        // touches the network.
        const resolveBackupContent = vi.fn().mockResolvedValue(exported);
        const res = await dispatchPreHost('wallet.importBackup.fresh', {
            password: NEW_DEVICE_PASSWORD,
            backupPassword: BACKUP_PASSWORD,
            walletPassword: OLD_DEVICE_PASSWORD,
            pointer: { location: 'https://backups.example/a.json' },
        }, { ...deps, resolveBackupContent });

        expect(resolveBackupContent).toHaveBeenCalledTimes(1);
        expect(res.walletId).toBe('src');
        const vault = await openAs(NEW_DEVICE_PASSWORD);
        expect((await vault.wallets.list())).toHaveLength(1);
    });

    // §15.6 / §19.4. The BIP39 passphrase is captured once and stored on the
    // wallet record as `encryptedPassphrase`, sealed under the wallet's own
    // master key, so a restore has to move it the same way it moves the seed.
    //
    // Carrying the blob through verbatim looks correct and is not: the restore
    // mints a FRESH salt for the new seal, so nothing about the new master key
    // matches the old one. A verbatim passphrase would fail its GCM tag at the
    // first unlock, which reads to the user as a wallet that opens and then
    // derives somebody else's addresses.
    describe('a wallet carrying a stored BIP39 passphrase', () => {
        /** the record as it existed on the old device, kept to compare against */
        let sourceWallet;
        let passphraseExported;

        beforeEach(async () => {
            const sealed = await encryptWalletSeed({
                password: OLD_DEVICE_PASSWORD,
                seed: new TextEncoder().encode(MNEMONIC),
                kdfParams: KDF_PARAMS,
            });
            // Sealed under the wallet's OWN master key, the way the create /
            // import flow seals it. Derived here rather than passed as a
            // password so the test holds the same key the wallet does.
            const walletKey = cryptoLib.deriveMasterKey(OLD_DEVICE_PASSWORD, KDF_PARAMS);
            let encryptedPassphrase;
            try {
                encryptedPassphrase = await encryptWalletPassphrase({
                    masterKey: walletKey,
                    passphrase: PASSPHRASE,
                });
            } finally {
                walletKey.fill(0);
            }
            const vault = sourceVaultWith(sealed, (w) => {
                sourceWallet = { ...w, passphraseEnabled: true, encryptedPassphrase };
                return sourceWallet;
            });
            passphraseExported = (await exportBackupFile({
                vault,
                walletId: 'src',
                password: BACKUP_PASSWORD,
                kdfParams: KDF_PARAMS,
            })).fileContent;
        });

        /**
         * What this wallet's keys actually are, seen through the real signer.
         * An account xpub fixes every address under it, so two equal xpubs are
         * two wallets that produce the same addresses.
         */
        async function accountXpubOf(wallet, password) {
            const signer = new SoftwareSigner({
                id: 'probe',
                displayName: 'probe',
                chainRegistry: null,
                walletEncryption: {
                    encryptedSeed: wallet.encryptedSeed,
                    kdfParams: wallet.kdfParams,
                    format: wallet.format,
                    passphraseEnabled: wallet.passphraseEnabled,
                    encryptedPassphrase: wallet.encryptedPassphrase,
                    importedKeys: wallet.importedKeys,
                },
            });
            // No `bip39Passphrase` argument anywhere in this file: the point of
            // the whole change is that the password is the only secret left.
            await signer.unlock({ password });
            try {
                return await signer.getAccountXpub({ path: "m/84'/0'/0'" });
            } finally {
                signer.lock();
            }
        }

        it('restores under a DIFFERENT device password and still derives the same keys', async () => {
            const before = await accountXpubOf(sourceWallet, OLD_DEVICE_PASSWORD);

            await restore({ fileContent: passphraseExported });
            const vault = await openAs(NEW_DEVICE_PASSWORD);
            const [restored] = await vault.wallets.list();
            expect(restored.encryptedPassphrase,
                'the restore dropped the stored passphrase, so this wallet is back to asking for it')
                .toBeTruthy();

            const after = await accountXpubOf(restored, NEW_DEVICE_PASSWORD);
            expect(after,
                'the restored wallet derives different keys, so every address the user backed up is gone')
                .toBe(before);

            // The control. Without it an implementation that quietly dropped the
            // passphrase from the derivation would pass the line above by
            // matching a `before` computed the same broken way.
            const ignoringPassphrase = await accountXpubOf(
                { ...restored, passphraseEnabled: false, encryptedPassphrase: null },
                NEW_DEVICE_PASSWORD,
            );
            expect(ignoringPassphrase,
                'the same seed derives the same xpub with and without the passphrase, so the test '
                + 'cannot tell whether the passphrase was used at all')
                .not.toBe(after);
        });

        it('re-keys the passphrase blob instead of carrying it verbatim', async () => {
            await restore({ fileContent: passphraseExported });
            const vault = await openAs(NEW_DEVICE_PASSWORD);
            const [restored] = await vault.wallets.list();

            expect(restored.encryptedPassphrase,
                'the passphrase blob rode through unchanged; it is still sealed under the old '
                + "device's password and will fail its tag at the first unlock")
                .not.toBe(sourceWallet.encryptedPassphrase);

            const newKey = cryptoLib.deriveMasterKey(NEW_DEVICE_PASSWORD, restored.kdfParams);
            try {
                await expect(decryptWalletPassphrase({
                    masterKey: newKey,
                    encryptedPassphrase: sourceWallet.encryptedPassphrase,
                }), 'the blob that left the old device opens under the new key, so the two seals are '
                    + 'not actually distinct').rejects.toThrow();

                const bytes = await decryptWalletPassphrase({
                    masterKey: newKey,
                    encryptedPassphrase: restored.encryptedPassphrase,
                });
                try {
                    expect(new TextDecoder().decode(bytes) === PASSPHRASE,
                        'the re-keyed blob opens but does not hold the passphrase that went in')
                        .toBe(true);
                } finally {
                    bytes.fill(0);
                }
            } finally {
                newKey.fill(0);
            }
        });

        it('restores a pre-spec envelope and leaves that wallet awaiting its capture step', async () => {
            // An envelope exported before the passphrase was stored: the wallet
            // record inside it is at schemaVersion 2 and has no
            // `encryptedPassphrase` field at all. `put` validates against the
            // CURRENT version and never migrates, so without a migration on the
            // way out of the envelope this restore dies inside the vault.
            const sealed = await encryptWalletSeed({
                password: OLD_DEVICE_PASSWORD,
                seed: new TextEncoder().encode(MNEMONIC),
                kdfParams: KDF_PARAMS,
            });
            const preSpecVault = sourceVaultWith(sealed, (w) => {
                const legacy = { ...w, schemaVersion: 2, passphraseEnabled: true };
                delete legacy.encryptedPassphrase;
                return legacy;
            });
            const fileContent = (await exportBackupFile({
                vault: preSpecVault,
                walletId: 'src',
                password: BACKUP_PASSWORD,
                kdfParams: KDF_PARAMS,
            })).fileContent;

            const res = await restore({ fileContent });
            expect(res.walletId).toBe('src');

            const vault = await openAs(NEW_DEVICE_PASSWORD);
            const [restored] = await vault.wallets.list();
            // `list()` migrates on READ, so it would report v3 even for a v2
            // record that had somehow been written. The stored document is the
            // only place the distinction is visible, and the distinction is the
            // whole point: the record has to LAND migrated.
            expect(vault._doc.wallets[0].schemaVersion,
                'the wallet was stored at its backed-up version, so the migration ran on read '
                + 'rather than on the way in').toBe(3);
            expect(restored.encryptedPassphrase,
                'a wallet that never stored a passphrase came back with one')
                .toBeNull();
            // null with passphraseEnabled true is the legacy state, and it is
            // what routes this wallet into the one-time capture at next unlock.
            expect(restored.passphraseEnabled).toBe(true);
        });

        it('a wrong wallet password refuses before any write, passphrase or not', async () => {
            await expect(restore({ fileContent: passphraseExported, walletPassword: 'wrong' }))
                .rejects.toThrow(/Password of the wallet in this backup/);

            expect(metaBackend.peek(), 'meta was written despite the refusal').toBeNull();
            expect(storageBackend.peek(), 'a vault blob was persisted despite the refusal').toBeNull();
            expect(sessionBackend.peek(), 'a session key was persisted despite the refusal').toBeNull();
            expect(onUnlocked).not.toHaveBeenCalled();

            const res = await restore({ fileContent: passphraseExported });
            expect(res.walletId).toBe('src');
        });

        it('refuses a passphrase blob it cannot open, and names it', async () => {
            // A seed blob in the passphrase slot: same master key, but sealed
            // with no AAD. This is the swap the domain separator exists to
            // catch, and catching it loudly here is the difference between a
            // refused restore and a wallet that silently derives from the
            // mnemonic text as its own passphrase.
            const wallet = { ...sourceWallet, encryptedPassphrase: sourceWallet.encryptedSeed };
            let caught = null;
            try {
                await rekeyWalletRecord(wallet, {
                    walletPassword: OLD_DEVICE_PASSWORD,
                    devicePassword: NEW_DEVICE_PASSWORD,
                });
            } catch (e) {
                caught = e;
            }
            expect(caught, 'a passphrase blob that does not open was re-keyed anyway')
                .toBeInstanceOf(BackupSeedPasswordError);
            expect(caught.what).toBe('passphrase');
            expect(caught.message).toMatch(/passphrase stayed locked/);
        });

        it('counts the passphrase as key material in the early return', async () => {
            const opts = {
                walletPassword: OLD_DEVICE_PASSWORD,
                devicePassword: NEW_DEVICE_PASSWORD,
            };
            const bare = {
                kdfParams: KDF_PARAMS,
                encryptedSeed: '',
                importedKeys: [],
                encryptedPassphrase: null,
            };
            expect(await rekeyWalletRecord(bare, opts),
                'a record with nothing sealed claimed it re-keyed something').toBe(false);

            // The case the early return has to admit: no seed, no imported
            // keys, but a passphrase blob that is still sealed under the old
            // password. Bailing out here would leave it unopenable forever.
            const onlyPassphrase = {
                ...bare,
                encryptedPassphrase: sourceWallet.encryptedPassphrase,
            };
            expect(await rekeyWalletRecord(onlyPassphrase, opts),
                'a record whose only key material is the passphrase was skipped by the early return')
                .toBe(true);

            const newKey = cryptoLib.deriveMasterKey(NEW_DEVICE_PASSWORD, onlyPassphrase.kdfParams);
            try {
                const bytes = await decryptWalletPassphrase({
                    masterKey: newKey,
                    encryptedPassphrase: onlyPassphrase.encryptedPassphrase,
                });
                try {
                    expect(new TextDecoder().decode(bytes) === PASSPHRASE,
                        'the re-keyed passphrase does not open under the device password').toBe(true);
                } finally {
                    bytes.fill(0);
                }
            } finally {
                newKey.fill(0);
            }
        });
    });
});
