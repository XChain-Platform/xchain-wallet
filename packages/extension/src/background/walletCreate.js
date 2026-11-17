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
// password, build a blank Vault, run the matching core flow, save kdfParams to
// the meta slot, and trigger the background's `onUnlocked` callback so
// the host listener attaches. Idempotence-guarded.
//
// Runs pre-host so a fresh install can onboard; the MessageHost's
// vault-backed handlers aren't registered until a session key exists.

import { crypto as cryptoLib, flows, registry, storage as storageLib } from '@xchain-wallet/core';
import { addHardwareWallet } from '@xchain-wallet/core/flows/hardwareWallet.js';
import {
    BALANCES_BATCH_MAX_ADDRESSES,
    readsFromBatchEntry,
    shapeFromReads,
} from '@xchain-wallet/core/flows/balances.js';
import { saveSigningSecret } from './signingSecretSession.js';
import { resolveBackupPointerContent } from './backupPointerResolver.js';

/**
 * Write the recovery-phrase reset record for the vault just committed, off the
 * reply path (operator ruling 2026-11-16). Copies the key before returning,
 * so the caller zeroes its own as usual; a failure costs only the backfill at
 * the next unlock.
 *
 * @param {{ storageBackend: any, metaBackend: any, onPhraseRecoveryReconcile?: (p: Promise<boolean>) => void }} deps
 * @param {Uint8Array} masterKey
 * @param {string} password
 * @param {Map<string, Uint8Array>} [knownWalletKeys]   wallet seal keys already derived (a restore's lent key)
 */
export function startPhraseRecoveryReconcile(deps, masterKey, password, knownWalletKeys) {
    const pending = flows.reconcilePhraseRecoveryDetached({
        storageBackend: deps.storageBackend,
        metaBackend: deps.metaBackend,
        vaultKey: masterKey,
        password,
        knownWalletKeys,
        onError: (err) => console.warn('[xchain] phrase recovery not written:', /** @type {any} */ (err)?.name || err),
    });
    deps.onPhraseRecoveryReconcile?.(pending);
    return pending;
}

// Read from the registry's bundled descriptors, so a new bundled chain reaches
// new wallets with no shell edit; the web shell imports this same binding.
export const DEFAULT_ACTIVE_CHAIN_IDS = registry.DEFAULT_ONBOARDING_CHAIN_IDS;

/**
 * @typedef {Object} WalletCreateDeps
 * @property {import('../storage/ChromeStorageBackend.js').ChromeStorageBackend} storageBackend
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} sessionBackend
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} [signingSecretBackend]   session slot for the cached password; lets ensureHost re-populate the SignerPool after a service-worker restart
 * @property {import('../storage/ChromeMetaBackend.js').ChromeMetaBackend} metaBackend
 * @property {import('@xchain-wallet/core').registry.ChainRegistry} chainRegistry
 * @property {import('@xchain-wallet/core').sdk.SDKRegistry} sdkRegistry
 * @property {import('@xchain-wallet/core').signers.SignerPool} [signerPool]   filled by the create and fresh-restore lanes while their keys are in scope
 * @property {() => Promise<void> | void} [onUnlocked]
 * @property {(opts: { walletId: string, password: string, bip39Passphrase: string, chainIds: string[], sdkRegistry: any }) => string} [startLabelSyncRestore]
 */

/**
 * Returns the mnemonic so a popup running the §19.2 seed-phrase display
 * ceremony can show it before the success transition.
 */
export function handleWalletCreateWithMnemonic(request, deps) {
    return withOnboardingLock(deps, () => createWithMnemonic(request, deps));
}

async function createWithMnemonic(request, deps) {
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
        walletMode,
    } = /** @type {any} */ (request);

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    let mnemonic;
    let pooled = false;
    try {
        const vault = new storageLib.Vault({
            backend: deps.storageBackend,
            masterKey,
            // One blob write at `vault.save()`: a service worker that dies
            // part-way leaves nothing behind instead of an unopenable blob.
            autoSave: false,
        });
        try {
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
                // The wallet seal shares the vault key because the password
                // and KDF params are identical for a fresh create.
                masterKey,
                walletMode,
            });
            await vault.save();
            mnemonic = result.mnemonic;
            if (deps.signerPool) {
                pooled = true;
                await deps.signerPool.populate({
                    vault,
                    password,
                    bip39Passphrase,
                    chainRegistry: deps.chainRegistry,
                    sdkRegistry: deps.sdkRegistry,
                    masterKey,
                    masterKeyKdfParams: kdfParams,
                });
            }
        } finally {
            // Vault kept its own copy of the key; close zeros that copy.
            vault.close();
        }

        await deps.metaBackend.save({ kdfParams });
        await deps.sessionBackend.save(masterKey);
        await saveSigningSecret(deps.signingSecretBackend, password);
        startPhraseRecoveryReconcile(deps, masterKey, password);
    } catch (err) {
        // A create that fails after pooling opens no session, so no unlocked
        // signer may stay behind in the background's pool.
        if (pooled) {
            try { deps.signerPool.lockAll(); } catch { /* best-effort */ }
        }
        if (isVaultConflict(err)) throw walletExistsError();
        await discardPartialWallet(deps);
        throw err;
    } finally {
        masterKey.fill(0);
    }
    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    return { mnemonic, walletName: name };
}

export function handleWalletImport(request, deps) {
    return withOnboardingLock(deps, () => importWallet(request, deps));
}

async function importWallet(request, deps) {
    const password = /** @type {any} */ (request)?.password;
    const mnemonic = /** @type {any} */ (request)?.mnemonic;
    const wif = /** @type {any} */ (request)?.wif;
    const importingWif = typeof wif === 'string' && wif.trim().length > 0;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.import: password is required');
    }
    if (!importingWif && (typeof mnemonic !== 'string' || mnemonic.trim().length === 0)) {
        throw new Error('wallet.import: recovery phrase or WIF private key is required');
    }
    await assertFreshVault(deps);
    const {
        name = 'Imported Wallet',
        bip39Passphrase = '',
        activeChainIds = DEFAULT_ACTIVE_CHAIN_IDS,
        origin,
        format,
        chainId,
        addressType,
        activeNetwork,
        walletMode,
    } = /** @type {any} */ (request);
    if (importingWif && (typeof chainId !== 'string' || chainId.length === 0)) {
        throw new Error('wallet.import: chainId is required for a WIF private key');
    }

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    let importedFormat;
    let walletId;
    let labelSyncToken = null;
    try {
        const vault = new storageLib.Vault({
            backend: deps.storageBackend,
            masterKey,
            // One blob write at `vault.save()`: a service worker that dies
            // part-way leaves nothing behind instead of an unopenable blob.
            autoSave: false,
        });
        try {
            await vault.open();
            const result = importingWif
                ? await flows.importSingleWif({
                    password,
                    wif: wif.trim(),
                    chainId,
                    addressType,
                    vault,
                    chainRegistry: deps.chainRegistry,
                    sdkRegistry: deps.sdkRegistry,
                    name,
                    kdfParams,
                    walletMode,
                })
                : await flows.importMnemonic({
                    password,
                    mnemonic,
                    vault,
                    chainRegistry: deps.chainRegistry,
                    sdkRegistry: deps.sdkRegistry,
                    activeChainIds,
                    name,
                    bip39Passphrase,
                    origin,
                    // The caller's pin, so a phrase both wordlists accept is not read as the other format.
                    format,
                    kdfParams,
                    // The network the caller asked to land on (demo mode asks
                    // for mainnet). Undefined keeps the flow's own inference
                    // from the first chain id.
                    activeNetwork,
                    walletMode,
                });
            await vault.save();
            importedFormat = result.format ?? result.wallet.format;
            walletId = result.wallet.id;
        } finally {
            // Vault kept its own copy of the key; close zeros that copy.
            vault.close();
        }

        await deps.metaBackend.save({ kdfParams });
        await deps.sessionBackend.save(masterKey);
        await saveSigningSecret(deps.signingSecretBackend, password);
        startPhraseRecoveryReconcile(deps, masterKey, password);
    } catch (err) {
        if (isVaultConflict(err)) throw walletExistsError();
        await discardPartialWallet(deps);
        throw err;
    } finally {
        masterKey.fill(0);
    }
    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    if (!importingWif && origin !== 'created' && typeof deps.startLabelSyncRestore === 'function') {
        labelSyncToken = deps.startLabelSyncRestore({
            walletId,
            password,
            bip39Passphrase,
            chainIds: typeof flows.labelSyncSearchChainIds === 'function'
                ? flows.labelSyncSearchChainIds(deps.chainRegistry, activeChainIds)
                : activeChainIds,
            sdkRegistry: deps.sdkRegistry,
        });
    }
    // `walletId` rides along for the same reason the host-registered
    // `wallet.import` returns a whole wallet record: a fresh-install caller may
    // have more to do with the wallet it just made. The pairing lane
    // imports the shared phrase here and then asks the host for that wallet's
    // pairing payload, addressed BY id; without it the lane dead-ended after
    // the wallet already existed.
    return { format: importedFormat, walletName: name, walletId, labelSyncToken };
}

/**
 * Run the §19.5.2 restore without letting it fail the import around it.
 * The flow already swallows explorer errors per chain; this guard covers
 * the rest (a vault write refused, a wallet record the flow cannot open)
 * and turns it into a `null` result the import screen reads as "nothing
 * restored" rather than "the import failed".
 *
 * @param {{ vault: any, walletId: string, password: string, bip39Passphrase: string, chainIds: string[], sdkRegistry: any }} opts
 */
export async function restoreLabelSyncBestEffort({ vault, walletId, password, bip39Passphrase, chainIds, sdkRegistry }) {
    if (typeof flows.restoreLabelSyncAfterImport !== 'function') return null;
    try {
        return await flows.restoreLabelSyncAfterImport({
            vault,
            walletId,
            password,
            bip39Passphrase,
            chainIds,
            sdkRegistry,
        });
    } catch (err) {
        console.error('[xchain-wallet/extension] label-sync restore skipped:', err);
        return null;
    }
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
export function handleWalletImportBackup(request, deps) {
    return withOnboardingLock(deps, () => importBackupFresh(request, deps));
}

async function importBackupFresh(request, deps) {
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
    // This call's own copy of the key the restored wallet is now sealed under.
    let deviceKey = null;
    let deviceKdfParams = null;
    let pooled = false;
    let result;
    try {
        const vault = new storageLib.Vault({
            backend: deps.storageBackend,
            masterKey,
            // One blob write at `vault.save()`: a service worker that dies
            // part-way leaves nothing behind instead of an unopenable blob.
            autoSave: false,
        });
        try {
            await vault.open();
            const common = {
                vault,
                password: backupPassword,
                walletPassword,
                devicePassword: password,
                mode: 'fresh',
                // Core zeroes the lent buffer when this returns, so keep a copy;
                // the outer finally zeroes it whether or not the restore succeeds.
                onDeviceKey: (key, params) => {
                    if (deviceKey) deviceKey.fill(0);
                    deviceKey = key.slice();
                    deviceKdfParams = params;
                },
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
            // Pool the restored wallet with the re-key's key while the vault is
            // open, so the host build need not re-derive it from the cached password.
            // Best-effort, as at unlock: on failure the host build re-pools as before.
            if (deps.signerPool && deps.chainRegistry && deps.sdkRegistry) {
                try {
                    pooled = true;
                    await deps.signerPool.populate({
                        vault,
                        password,
                        chainRegistry: deps.chainRegistry,
                        sdkRegistry: deps.sdkRegistry,
                        masterKey: deviceKey ?? masterKey,
                        masterKeyKdfParams: deviceKey ? deviceKdfParams : kdfParams,
                    });
                } catch { /* best-effort, see above */ }
            }
        } finally {
            // Vault kept its own copy of the key; close zeros that copy.
            vault.close();
        }

        await deps.metaBackend.save({ kdfParams });
        await deps.sessionBackend.save(masterKey);
        await saveSigningSecret(deps.signingSecretBackend, password);
        // The restored wallet was re-sealed under fresh params and its key lent
        // here, so the record needs no second derivation of it.
        startPhraseRecoveryReconcile(deps, masterKey, password,
            deviceKey && result?.walletId ? new Map([[result.walletId, deviceKey]]) : undefined);
    } catch (err) {
        // A restore that fails after pooling opens no session, so no unlocked
        // signer may stay behind in the background's pool.
        if (pooled) {
            try { deps.signerPool.lockAll(); } catch { /* best-effort */ }
        }
        if (isVaultConflict(err)) throw walletExistsError();
        await discardPartialWallet(deps);
        throw err;
    } finally {
        masterKey.fill(0);
        if (deviceKey) deviceKey.fill(0);
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
 * Fresh install, first wallet a hardware wallet (`wallet.create.hardware`).
 *
 * The connect flow reads the device's accounts first and asks for the
 * password last, on the standard Set Password page, so this lane receives both
 * at once: `{ password, name, device, accounts }`, the `addHardwareWallet`
 * input plus the password that seals the new vault. Same shape of work as
 * `wallet.create`: one blob write, then the kdf params, session key and
 * signing secret, with a failed save leaving the install fresh. A hardware
 * wallet has no seed, so nothing is pooled and no label-sync restore runs.
 *
 * @returns {Promise<{ walletId: string, walletName: string, signer: object | null, accounts: object[], addresses: object[] }>}
 */
export function handleWalletCreateHardware(request, deps) {
    return withOnboardingLock(deps, () => createHardware(request, deps));
}

async function createHardware(request, deps) {
    const req = /** @type {any} */ (request) ?? {};
    const password = req.password;
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('wallet.create.hardware: password is required');
    }
    await assertFreshVault(deps);
    const input = hardwareWalletInput(req);

    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    let result;
    try {
        const vault = new storageLib.Vault({
            backend: deps.storageBackend,
            masterKey,
            // One blob write at `vault.save()`, as wallet.create.
            autoSave: false,
        });
        try {
            await vault.open();
            await seedHardwareSettings(vault, deps.chainRegistry, input.accounts);
            result = await addHardwareWallet({ ...input, vault, chainRegistry: deps.chainRegistry });
            await vault.save();
        } finally {
            vault.close();
        }

        await deps.metaBackend.save({ kdfParams });
        await deps.sessionBackend.save(masterKey);
        await saveSigningSecret(deps.signingSecretBackend, password);
        startPhraseRecoveryReconcile(deps, masterKey, password);
    } catch (err) {
        if (isVaultConflict(err)) throw walletExistsError();
        await discardPartialWallet(deps);
        throw err;
    } finally {
        masterKey.fill(0);
    }
    if (typeof deps.onUnlocked === 'function') {
        await deps.onUnlocked();
    }
    return hardwareWalletResult(result);
}

/**
 * The request fields `addHardwareWallet` takes, and nothing else, so a caller
 * can never hand the flow its own vault or registry.
 *
 * @param {any} req
 * @returns {{ name: unknown, device: unknown, accounts: any[] }}
 */
export function hardwareWalletInput(req) {
    return {
        name: req?.name,
        device: req?.device,
        accounts: Array.isArray(req?.accounts) ? req.accounts : [],
    };
}

/**
 * What both hardware lanes answer: the new wallet's id and name, the signer
 * record (its id is what the renderer registers the device transport under),
 * and the accounts and addresses written.
 *
 * @param {{ wallet: { id: string, name: string }, signer?: object, accounts?: object[], addresses?: object[] }} r
 */
export function hardwareWalletResult(r) {
    return {
        walletId: r.wallet.id,
        walletName: r.wallet.name,
        signer: r.signer ?? null,
        accounts: r.accounts ?? [],
        addresses: r.addresses ?? [],
    };
}

/**
 * Settings for a fresh hardware vault: fee entries for the chains the device
 * accounts live on, and the network those accounts are on as the active one,
 * so the wallet opens on its own coins. Merges into settings already present.
 * Exported for the web shell's in-page twin of this lane.
 */
export async function seedHardwareSettings(vault, chainRegistry, accounts) {
    const has = (id) => typeof id === 'string' && typeof chainRegistry?.has === 'function' && chainRegistry.has(id);
    const chainIds = [...new Set(accounts.map((a) => a?.chainId).filter(has))];
    const seedIds = chainIds.length > 0 ? chainIds : DEFAULT_ACTIVE_CHAIN_IDS;
    const activeNetwork = chainRegistry?.descriptorFor?.(seedIds[0])?.networkKind;
    await flows.ensureSettings(vault, chainRegistry, seedIds, activeNetwork ? { activeNetwork } : {});
}

/**
 * Most addresses one `wallet.hardware.balances` call reads per network. It is
 * the explorer's batch size, so every network costs exactly one balance read
 * whatever the row count; a longer list is refused rather than split.
 */
export const HARDWARE_BALANCES_MAX_PER_CHAIN = BALANCES_BATCH_MAX_ADDRESSES;

let sharedPriceOracle = null;
function defaultPriceOracle() {
    if (sharedPriceOracle) return sharedPriceOracle;
    if (typeof globalThis.fetch !== 'function' || typeof flows.createPriceOracle !== 'function') return null;
    sharedPriceOracle = flows.createPriceOracle({ fetch: globalThis.fetch.bind(globalThis) });
    return sharedPriceOracle;
}

/**
 * `wallet.hardware.balances`: the coin balance and fiat value of each account
 * the connect flow found on a device. Pre-host on purpose: on a fresh install
 * the accounts step comes before any vault exists.
 *
 * @param {{ items?: Array<{ chainId: string, address: string }> }} request
 * @param {{ chainRegistry?: any, sdkRegistry?: any, priceOracle?: any, readSettings?: () => Promise<any> | any }} deps
 *   `readSettings` returns the open vault's settings (or null), so a user who
 *   turned price data off gets no fiat lookup; `priceOracle` is injectable for tests
 */
export async function handleHardwareWalletBalances(request, deps = {}) {
    let settings = null;
    if (typeof deps.readSettings === 'function') {
        try { settings = await deps.readSettings(); } catch { settings = null; }
    }
    return readHardwareWalletBalances({
        items: /** @type {any} */ (request)?.items,
        chainRegistry: deps.chainRegistry,
        sdkRegistry: deps.sdkRegistry,
        priceOracle: 'priceOracle' in deps ? deps.priceOracle : defaultPriceOracle(),
        settings,
    });
}

/**
 * One balance read per network (the explorer batch route) and one price read
 * for all networks, whatever the row count. No per-address fallback: a network
 * whose explorer has no batch route reports its rows unavailable.
 *
 * @returns {Promise<Array<{ chainId: string, address: string, balance: string | null,
 *   quantity: string | null, divisibility: number, fiat: number | null, currency: string, error: string | null }>>}
 *   `balance` is whole coins as a decimal string, `quantity` the same in atomic
 *   units; `fiat` is null when price data is off or has no price for the network
 */
export async function readHardwareWalletBalances({ items, chainRegistry, sdkRegistry, priceOracle, settings } = {}) {
    if (!Array.isArray(items)) {
        throw new Error('wallet.hardware.balances: items must be an array');
    }
    /** @type {Map<string, Set<string>>} */
    const byChain = new Map();
    const rows = items.map((item) => {
        const chainId = item?.chainId;
        const address = item?.address;
        if (typeof chainId !== 'string' || !chainId || typeof address !== 'string' || !address) {
            throw new Error('wallet.hardware.balances: every item needs a chainId and an address');
        }
        if (!byChain.has(chainId)) byChain.set(chainId, new Set());
        byChain.get(chainId).add(address);
        return { chainId, address };
    });
    for (const [chainId, addresses] of byChain) {
        if (addresses.size > HARDWARE_BALANCES_MAX_PER_CHAIN) {
            throw Object.assign(
                new Error(`wallet.hardware.balances: at most ${HARDWARE_BALANCES_MAX_PER_CHAIN} addresses per network (${chainId} has ${addresses.size})`),
                { code: 'HW_BALANCES_TOO_MANY' },
            );
        }
    }

    const key = (chainId, address) => `${chainId}\u0000${address}`;
    /** @type {Map<string, { quantity: string | null, error: string | null }>} */
    const reads = new Map();
    const pricesRead = nativeFiatPrices({ chainIds: [...byChain.keys()], priceOracle, settings });
    await Promise.all([...byChain.entries()].map(async ([chainId, addressSet]) => {
        const addresses = [...addressSet];
        const fail = (message) => {
            for (const address of addresses) reads.set(key(chainId, address), { quantity: null, error: message });
        };
        let sdk = null;
        try { sdk = sdkRegistry?.get?.(chainId) ?? null; } catch { sdk = null; }
        if (!sdk || typeof sdk.getBalancesBatch !== 'function') {
            fail('balance service unavailable');
            return;
        }
        const descriptor = chainRegistry?.descriptorFor?.(chainId) ?? null;
        const nativeTicker = descriptor?.nativeTicker || descriptor?.coin || chainId;
        let resp;
        try {
            resp = await sdk.getBalancesBatch(addresses);
        } catch (e) {
            fail(e?.message ? String(e.message) : String(e));
            return;
        }
        for (const address of addresses) {
            const slot = resp && typeof resp === 'object' && Object.prototype.hasOwnProperty.call(resp, address)
                ? resp[address]
                : null;
            try {
                const shape = shapeFromReads({ ...readsFromBatchEntry(slot, address), nativeTicker, address });
                reads.set(key(chainId, address), shape.native
                    ? { quantity: String(shape.native.quantity), error: null }
                    : { quantity: null, error: String(shape.unavailableReason || 'balance unavailable') });
            } catch (e) {
                reads.set(key(chainId, address), { quantity: null, error: e?.message ? String(e.message) : String(e) });
            }
        }
    }));
    const { currency, prices } = await pricesRead;

    return rows.map(({ chainId, address }) => {
        const read = reads.get(key(chainId, address)) ?? { quantity: null, error: 'balance unavailable' };
        const balance = read.quantity == null ? null : coinsFromAtomic(read.quantity, NATIVE_DIVISIBILITY);
        const price = prices?.[chainId]?.priceFiat;
        const fiat = balance != null && typeof price === 'number' && Number.isFinite(price)
            ? Math.round(Number(balance) * price * 100) / 100
            : null;
        return {
            chainId,
            address,
            balance,
            quantity: read.quantity,
            divisibility: NATIVE_DIVISIBILITY,
            fiat,
            currency,
            error: read.error,
        };
    });
}

// The explorer's native coin balance is always read at 8 decimals (balances.js).
const NATIVE_DIVISIBILITY = 8;

/** Atomic units to a whole-coin decimal string, trailing zeros dropped. */
function coinsFromAtomic(quantity, decimals) {
    let amount;
    try { amount = BigInt(quantity); } catch { return null; }
    const scale = 10n ** BigInt(decimals);
    const whole = amount / scale;
    const fraction = String(amount % scale).padStart(decimals, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * One price read for every network, behind the same privacy switch as
 * `prices.native`. A failure or a switched-off source leaves fiat empty
 * rather than failing the balances.
 */
async function nativeFiatPrices({ chainIds, priceOracle, settings }) {
    const currency = typeof settings?.fiatCurrency === 'string' && settings.fiatCurrency
        ? settings.fiatCurrency
        : 'USD';
    if (settings?.privacy?.priceDataEnabled === false) return { currency, prices: {} };
    if (!priceOracle || typeof priceOracle.getNativePrices !== 'function' || chainIds.length === 0) {
        return { currency, prices: {} };
    }
    try {
        const r = await priceOracle.getNativePrices({ chainIds, fiatCurrency: currency });
        return { currency, prices: r?.prices ?? {} };
    } catch {
        return { currency, prices: {} };
    }
}

/** Tail of the onboarding queue per install, keyed by its storage backend. */
const onboardingQueues = new WeakMap();

/**
 * Run one create / import / fresh-restore at a time per install. Two windows
 * (or a create beside an import) that start at once both meet an empty vault
 * at `assertFreshVault`; run in order, the second meets the first one's
 * wallet and refuses with WalletExistsError instead of racing it to the blob
 * and then clearing the winner's blob and kdfParams in its own cleanup.
 *
 * @template T
 * @param {{ storageBackend?: object, metaBackend?: object }} deps
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
async function withOnboardingLock(deps, run) {
    const key = deps?.storageBackend ?? deps?.metaBackend;
    if (!key || typeof key !== 'object') return run();
    const prior = onboardingQueues.get(key) ?? Promise.resolve();
    let release = () => {};
    const tail = prior.then(() => new Promise((resolve) => { release = resolve; }));
    onboardingQueues.set(key, tail);
    await prior;
    try {
        return await run();
    } finally {
        release();
        if (onboardingQueues.get(key) === tail) onboardingQueues.delete(key);
    }
}

function walletExistsError() {
    return Object.assign(
        new Error('A wallet already exists. Unlock or reset first.'),
        { name: 'WalletExistsError' },
    );
}

/**
 * A conditional save on a vault this lane opened empty refuses only because
 * another writer (a second process on the same file) stored a wallet first.
 * That blob is the other writer's, so the lane reports WalletExistsError and
 * clears nothing.
 */
function isVaultConflict(err) {
    return err?.name === 'VaultConflictError';
}

/**
 * Remove what a failed create / import / fresh-restore wrote. These lanes write
 * the blob once, at their save, so a kdfParams, session or signing-secret save
 * that is refused after it leaves an encrypted blob the unlock path cannot
 * open and every onboarding lane refuses to replace. Callers
 * reach this only under the onboarding lock, after `assertFreshVault` proved
 * the install held nothing and with no conditional-save conflict, so it never
 * discards a wallet that was already there or that another writer stored. A clear that fails too is
 * left for the original error to report.
 *
 * @param {{ storageBackend: { clear?: () => Promise<void> }, metaBackend: { clear?: () => Promise<void> } }} deps
 */
async function discardPartialWallet(deps) {
    for (const backend of [deps.storageBackend, deps.metaBackend]) {
        try {
            if (typeof backend?.clear === 'function') await backend.clear();
        } catch {
            // The failure being reported is the first one.
        }
    }
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
    if (await deps.metaBackend.load()) throw walletExistsError();
    if (await deps.storageBackend.load()) throw walletExistsError();
}
