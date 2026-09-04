// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pre-host wallet.create + wallet.import handlers. §15.3 / §15.4.
//
// Mirror of the web shell's `createWalletLocal` / `importMnemonicLocal`
// from hostBridge.js: derive a fresh master key from the user's
// password, build a blank Vault, run the core flow, save kdfParams to
// the meta slot, and trigger the background's `onUnlocked` callback so
// the host listener attaches. Idempotence-guarded.
//
// Runs pre-host so a fresh install can onboard; the MessageHost's
// vault-backed handlers aren't registered until a session key exists.

import { crypto as cryptoLib, flows, storage as storageLib } from '@xchain-wallet/core';
import { saveSigningSecret } from './signingSecretSession.js';
import { resolveBackupPointerContent } from './backupPointerResolver.js';

export const DEFAULT_ACTIVE_CHAIN_IDS = [
    'bitcoin-mainnet',
    'dogecoin-mainnet',
    'litecoin-mainnet',
];

/**
 * @typedef {Object} WalletCreateDeps
 * @property {import('../storage/ChromeStorageBackend.js').ChromeStorageBackend} storageBackend
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} sessionBackend
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} [signingSecretBackend]   session slot for the cached password; lets ensureHost re-populate the SignerPool after a service-worker restart
 * @property {import('../storage/ChromeMetaBackend.js').ChromeMetaBackend} metaBackend
 * @property {import('@xchain-wallet/core').registry.ChainRegistry} chainRegistry
 * @property {import('@xchain-wallet/core').sdk.SDKRegistry} sdkRegistry
 * @property {() => Promise<void> | void} [onUnlocked]
 */

export async function handleWalletCreate(request, deps) {
    const password = /** @type {any} */ (request)?.password;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.create: password is required');
    }
    await assertFreshVault(deps);
    const {
        name = 'Main Wallet',
        strengthBits = 128,
        bip39Passphrase = '',
        activeChainIds = DEFAULT_ACTIVE_CHAIN_IDS,
    } = /** @type {any} */ (request);

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    try {
        const vault = new storageLib.Vault({
            backend: deps.storageBackend,
            masterKey,
        });
        await vault.open();
        const result = await flows.createWallet({
            password,
            vault,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            activeChainIds,
            name,
            strengthBits,
            bip39Passphrase,
            kdfParams,
        });
        await vault.save();
        vault.close();

        await deps.metaBackend.save({ kdfParams });
        await deps.sessionBackend.save(masterKey);
        await saveSigningSecret(deps.signingSecretBackend, password);
    } finally {
        masterKey.fill(0);
    }

    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    // Re-run create to fetch the mnemonic? No: createWallet already
    // returned it above. Need to capture it before this final step.
    return { created: true };
}

/**
 * Two-phase version: returns the mnemonic. Popups that want the
 * §19.2 seed-phrase display ceremony call this instead and show the
 * mnemonic before the success transition.
 */
export async function handleWalletCreateWithMnemonic(request, deps) {
    const password = /** @type {any} */ (request)?.password;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.create: password is required');
    }
    await assertFreshVault(deps);
    const {
        name = 'Main Wallet',
        strengthBits = 128,
        bip39Passphrase = '',
        activeChainIds = DEFAULT_ACTIVE_CHAIN_IDS,
    } = /** @type {any} */ (request);

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    let mnemonic;
    try {
        const vault = new storageLib.Vault({
            backend: deps.storageBackend,
            masterKey,
        });
        await vault.open();
        const result = await flows.createWallet({
            password,
            vault,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            activeChainIds,
            name,
            strengthBits,
            bip39Passphrase,
            kdfParams,
        });
        await vault.save();
        vault.close();
        mnemonic = result.mnemonic;

        await deps.metaBackend.save({ kdfParams });
        await deps.sessionBackend.save(masterKey);
        await saveSigningSecret(deps.signingSecretBackend, password);
    } finally {
        masterKey.fill(0);
    }
    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    return { mnemonic, walletName: name };
}

export async function handleWalletImport(request, deps) {
    const password = /** @type {any} */ (request)?.password;
    const mnemonic = /** @type {any} */ (request)?.mnemonic;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.import: password is required');
    }
    if (typeof mnemonic !== 'string' || mnemonic.trim().length === 0) {
        throw new Error('wallet.import: mnemonic is required');
    }
    await assertFreshVault(deps);
    const {
        name = 'Imported Wallet',
        bip39Passphrase = '',
        activeChainIds = DEFAULT_ACTIVE_CHAIN_IDS,
    } = /** @type {any} */ (request);

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    let format;
    let walletId;
    try {
        const vault = new storageLib.Vault({
            backend: deps.storageBackend,
            masterKey,
        });
        await vault.open();
        const result = await flows.importMnemonic({
            password,
            mnemonic,
            vault,
            chainRegistry: deps.chainRegistry,
            sdkRegistry: deps.sdkRegistry,
            activeChainIds,
            name,
            bip39Passphrase,
            kdfParams,
        });
        await vault.save();
        vault.close();
        format = result.format;
        walletId = result.wallet.id;

        await deps.metaBackend.save({ kdfParams });
        await deps.sessionBackend.save(masterKey);
        await saveSigningSecret(deps.signingSecretBackend, password);
    } finally {
        masterKey.fill(0);
    }
    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    // `walletId` rides along for the same reason the host-registered
    // `wallet.import` returns a whole wallet record: a fresh-install caller may
    // have more to do with the wallet it just made. The pairing lane
    // imports the shared phrase here and then asks the host for that wallet's
    // pairing payload, addressed BY id; without it the lane dead-ended after
    // the wallet already existed.
    return { format, walletName: name, walletId };
}

/**
 * Restore an encrypted §19.4 backup onto a FRESH install.
 *
 * The shipping `wallet.importBackup` is host-registered, and the host is only
 * built once a vault exists - so on a device with no wallet the restore lane
 * had nothing to talk to. This is its pre-host twin: it creates the vault
 * under the new device password first, then runs the same core merge.
 *
 * Three secrets arrive, and they are three different things:
 *
 *   password         the password THIS device will unlock with from now on
 *   backupPassword   opens the backup file's envelope
 *   walletPassword   opens the backed-up wallet's own seed / imported keys
 *
 * The user may choose a genuinely new `password` precisely because
 * `importBackupFile` re-keys the restored seal onto it. Before that re-key
 * existed, a free choice here produced a wallet that unlocked and then could
 * not sign.
 *
 * `mode` is fixed to 'fresh': the vault was empty a line ago, so there is
 * nothing to re-mint ids against, and the backup's own settings are adopted
 * (the restoring user's network / fee choices ARE the ones being restored).
 */
export async function handleWalletImportBackup(request, deps) {
    const req = /** @type {any} */ (request) ?? {};
    const password = req.password;
    const backupPassword = req.backupPassword;
    const walletPassword = req.walletPassword;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.importBackup.fresh: password is required (the password this device will unlock with)');
    }
    if (typeof backupPassword !== 'string' || backupPassword.length === 0) {
        throw new Error('wallet.importBackup.fresh: backupPassword is required (it opens the backup file)');
    }
    if (typeof walletPassword !== 'string' || walletPassword.length === 0) {
        throw new Error("wallet.importBackup.fresh: walletPassword is required (it opens the backed-up wallet's seed)");
    }
    const hasContent = typeof req.fileContent === 'string' && req.fileContent.trim().length > 0;
    const hasPointer = req.pointer != null;
    if (!hasContent && !hasPointer) {
        throw new Error('wallet.importBackup.fresh: fileContent or pointer is required');
    }
    await assertFreshVault(deps);

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    let result;
    try {
        const vault = new storageLib.Vault({
            backend: deps.storageBackend,
            masterKey,
        });
        await vault.open();
        const common = {
            vault,
            password: backupPassword,
            walletPassword,
            devicePassword: password,
            mode: 'fresh',
        };
        // A failed restore must leave NOTHING behind: the vault is only saved
        // and the session only opened once the merge has actually succeeded,
        // so a wrong wallet password throws with the install still fresh and
        // the user able to try again rather than half-onboarded.
        result = hasPointer
            ? await flows.restoreFromBackupPointer({
                ...common,
                pointer: req.pointer,
                resolveBackupContent: deps.resolveBackupContent ?? resolveBackupPointerContent,
            })
            : await flows.importBackupFile({ ...common, fileContent: req.fileContent });
        await vault.save();
        vault.close();

        await deps.metaBackend.save({ kdfParams });
        await deps.sessionBackend.save(masterKey);
        await saveSigningSecret(deps.signingSecretBackend, password);
    } finally {
        masterKey.fill(0);
    }
    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    return {
        walletId: result.walletId,
        walletName: result.payload?.wallet?.name,
        writes: result.writes,
        skipped: result.skipped,
        rekeyed: result.rekeyed,
    };
}

/**
 * Refuse a create / import / fresh-restore onto an install that already holds
 * a wallet. Exported because the web shell runs these three lanes in-page
 * rather than through `dispatchPreHost`, and a second copy of the guard drifts
 * on both halves that matter: the error NAME shared routes branch on, and the
 * storage-blob arm (a meta-less blob is the state a route would otherwise meet
 * as an opaque AEAD failure from `Vault.open`).
 *
 * @param {{ metaBackend: { load: () => Promise<any> }, storageBackend: { load: () => Promise<any> } }} deps
 */
export async function assertFreshVault(deps) {
    if (await deps.metaBackend.load()) {
        throw Object.assign(
            new Error('A wallet already exists. Unlock or reset first.'),
            { name: 'WalletExistsError' },
        );
    }
    if (await deps.storageBackend.load()) {
        throw Object.assign(
            new Error('A wallet already exists. Unlock or reset first.'),
            { name: 'WalletExistsError' },
        );
    }
}
