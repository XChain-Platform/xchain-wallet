// Pre-host wallet.create + wallet.import handlers — §15.3 / §15.4.
//
// Mirror of the web shell's `createWalletLocal` / `importMnemonicLocal`
// from hostBridge.js: derive a fresh master key from the user's
// password, build a blank Vault, run the core flow, save kdfParams to
// the meta slot, and trigger the background's `onUnlocked` callback so
// the host listener attaches. Idempotence-guarded.
//
// Runs pre-host so a fresh install can onboard — the MessageHost's
// vault-backed handlers aren't registered until a session key exists.

import { crypto as cryptoLib, flows, storage as storageLib } from '@xchain-wallet/core';

const DEFAULT_ACTIVE_CHAIN_IDS = [
    'bitcoin-mainnet',
    'dogecoin-mainnet',
    'litecoin-mainnet',
];

/**
 * @typedef {Object} WalletCreateDeps
 * @property {import('../storage/ChromeStorageBackend.js').ChromeStorageBackend} storageBackend
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} sessionBackend
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
    } finally {
        masterKey.fill(0);
    }

    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    // Re-run create to fetch the mnemonic? No — createWallet already
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

        await deps.metaBackend.save({ kdfParams });
        await deps.sessionBackend.save(masterKey);
    } finally {
        masterKey.fill(0);
    }
    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    return { format, walletName: name };
}

async function assertFreshVault(deps) {
    if (await deps.metaBackend.load()) {
        throw Object.assign(
            new Error('A wallet already exists — unlock or reset first.'),
            { name: 'WalletExistsError' },
        );
    }
    if (await deps.storageBackend.load()) {
        throw Object.assign(
            new Error('A wallet already exists — unlock or reset first.'),
            { name: 'WalletExistsError' },
        );
    }
}
