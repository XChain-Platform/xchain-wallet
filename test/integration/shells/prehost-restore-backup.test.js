// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : restoring an encrypted backup onto a FRESH install.
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
//      the  re-key seen from the fresh-install side, and it is what lets
//      the lane offer a free password choice at all.
//   3. A wrong wallet password leaves the install FRESH - no meta, no vault
//      blob, no session - so the user can simply try again. A half-onboarded
//      device that cannot be re-onboarded is worse than a refusal.
//   4. It refuses outright once a wallet exists, so this lane can never be the
//      way an existing vault gets clobbered.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

import { dispatchPreHost, PRE_HOST_MESSAGE_TYPES } from '../../../packages/extension/src/background/sessionMeta.js';
import { exportBackupFile } from '../../../packages/core/src/flows/backupFile.js';
import {
    encryptWalletSeed,
    decryptWalletSeed,
} from '../../../packages/core/src/crypto/walletBlob.js';
import { storage as storageLib, crypto as cryptoLib } from '../../../packages/core/src/index.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { createAccount } from '../../../packages/core/src/schemas/account.js';
import { createAddress } from '../../../packages/core/src/schemas/address.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OLD_DEVICE_PASSWORD = 'the-lost-devices-password';
const NEW_DEVICE_PASSWORD = 'the-new-devices-password';
const BACKUP_PASSWORD = 'backup-file-password';

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
function sourceVaultWith(sealed) {
    const wallet = {
        ...createWallet({
            name: 'Wallet From The Old Phone',
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: sealed.encryptedSeed,
            kdfParams: sealed.kdfParams,
        }),
        id: 'src',
    };
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

describe('integration/shells/pre-host fresh-install backup restore ', () => {
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
        // The fresh-install half of . Without the re-key the user would
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
        // : the refusal names the FIELD on the restore screen ("Password
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
});
