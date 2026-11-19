// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Internal: "encrypt mnemonic + persist wallet + derive initial
// addresses" pipeline shared by createWallet (fresh BIP39) and
// importMnemonic (user-supplied BIP39 or Counterwallet).
//
// Not exported from the flows barrel. Flow modules import it directly.

import {
    calibrateKdfParamsAsync,
    copyMasterKey,
    deriveMasterKeyAsync,
    encryptWalletSeed,
    encryptWalletPassphrase,
    makeFreshKdfParams,
} from '../crypto/index.js';
import { createWallet as createWalletRecord } from '../schemas/wallet.js';
import { createAccount } from '../schemas/account.js';
import { createAddress } from '../schemas/address.js';
import { createDefaultSettings, inflateSettings } from '../schemas/settings.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { seedSettingsForChains } from './seedSettings.js';
import { serializeSettingsWrites } from './settings.js';
import { unlockWalletRecord } from './unlockWallet.js';
import { defaultAddressTypeForFormat } from './_defaultAddressType.js';

// The same phrase (and passphrase) imported twice derives the same addresses.
// A second wallet over the same keys would double-count every balance and
// make the picker list two wallets that are one. Refusing is deliberate over
// silently reusing the first: nothing is written, and the user is told which
// wallet already holds it.
export class DuplicateWalletError extends Error {
    constructor(walletName) {
        super(`This recovery phrase is already in this app as "${walletName}".`);
        this.name = 'DuplicateWalletError';
        this.walletName = walletName;
    }
}

/**
 * Name of the stored HD wallet that already owns one of `derived`, or null.
 * Compares the first address per chain, which is fixed by phrase and passphrase.
 */
async function existingWalletNameFor(vault, derived) {
    const stored = await vault.addresses.list();
    for (const { address } of derived) {
        const match = stored.find((existing) => sameHdAddress(existing, address));
        if (!match) continue;
        const account = await vault.accounts.get(match.accountId);
        const wallet = account ? await vault.wallets.get(account.walletId) : null;
        return wallet?.name || 'another wallet';
    }
    return null;
}

function sameHdAddress(existing, candidate) {
    return existing.source === 'hd'
        && existing.address === candidate.address
        && existing.chain === candidate.chain
        && existing.network === candidate.network;
}

function existingWalletNameInDocument(document, derived) {
    for (const { address } of derived) {
        const match = document.addresses.find((existing) => sameHdAddress(existing, address));
        if (!match) continue;
        const account = document.accounts.find((record) => record.id === match.accountId);
        const wallet = account
            ? document.wallets.find((record) => record.id === account.walletId)
            : null;
        return wallet?.name || 'another wallet';
    }
    return null;
}

// Whether two settings values are the same. The vault stores settings sparsely
// and reads them back without the null overrides and in its own key order, so
// a record read after a write differs from the object that was written by
// exactly those two things, which are not part of the value.
function sameValue(left, right) {
    if (left === right) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
        return (left ?? null) === (right ?? null);
    }
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left)) {
        return left.length === right.length && left.every((item, i) => sameValue(item, right[i]));
    }
    const set = (value) => Object.keys(value).filter((key) => value[key] !== null && value[key] !== undefined);
    const leftKeys = set(left);
    const rightKeys = set(right);
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

function walletGraphEntries({
    document, vault, walletRecord, account, addresses,
    chainRegistry, activeChainIds, activeNetwork,
}) {
    const duplicateOf = existingWalletNameInDocument(document, addresses);
    if (duplicateOf !== null) throw new DuplicateWalletError(duplicateOf);
    if (document.wallets.some((record) => record.id === walletRecord.id)) {
        throw new Error(`persistHdWallet: wallet "${walletRecord.id}" already exists; refusing to overwrite its stored secret`);
    }
    if (document.accounts.some((record) => record.id === account.id)) {
        throw new Error(`persistHdWallet: account id collision "${account.id}"`);
    }
    for (const { address } of addresses) {
        if (document.addresses.some((record) => record.id === address.id)) {
            throw new Error(`persistHdWallet: address id collision "${address.id}"`);
        }
    }
    const existingSettings = document.settings ? inflateSettings(document.settings) : null;
    let currentSettings = existingSettings ?? createDefaultSettings();
    if (!existingSettings && activeNetwork) {
        currentSettings = { ...currentSettings, activeNetwork };
    }
    const seededSettings = seedSettingsForChains(currentSettings, chainRegistry, activeChainIds);
    return [
        ...(!sameValue(existingSettings, seededSettings)
            ? [{ store: vault.settings, record: seededSettings }]
            : []),
        { store: vault.wallets, record: walletRecord },
        { store: vault.accounts, record: account },
        ...addresses.map(({ address }) => ({ store: vault.addresses, record: address })),
    ];
}

export function settingsSeedDelta(before, seeded, chainIds) {
    const added = (path) => chainIds.flatMap((chainId) => {
        const oldValue = path(before)?.[chainId];
        const seededValue = path(seeded)?.[chainId];
        return oldValue === undefined && seededValue !== undefined
            ? [[chainId, seededValue]]
            : [];
    });
    return {
        created: before === null,
        seeded,
        fees: added((settings) => settings?.fees),
    };
}

function removeUnchangedSeedEntries(source, entries) {
    const next = { ...(source ?? {}) };
    for (const [chainId, seededValue] of entries) {
        if (sameValue(next[chainId], seededValue)) delete next[chainId];
    }
    return next;
}

export async function rollbackSettingsSeed(vault, delta) {
    if (!delta) return;
    await serializeSettingsWrites(vault, async () => {
        const current = await vault.settings.get();
        if (!current) return;
        if (delta.created && sameValue(current, delta.seeded)
            && typeof vault.settings.clear === 'function') {
            await vault.settings.clear();
            return;
        }
        const next = {
            ...current,
            fees: removeUnchangedSeedEntries(current.fees, delta.fees),
        };
        if (!sameValue(next, current)) await vault.settings.put(next);
    });
}

/**
 * @typedef {Object} PersistOpts
 * @property {string} mnemonic                      already normalized + validated
 * @property {'bip39' | 'counterwallet-legacy'} format
 * @property {'created' | 'imported-mnemonic' | 'imported-wif' | 'imported-xchain-backup' | 'imported-freewallet'} origin
 * @property {boolean} passphraseEnabled
 * @property {string} [bip39Passphrase]
 * @property {string} password
 * @property {string} name
 * @property {string} accountName
 * @property {string} [initialAddressLabel]         default '<TICKER> Address #1' per chain (e.g. 'BTC Address #1'); an explicit value is used as-is for every chain
 * @property {import('../crypto/kdf.js').KdfParams} [kdfParams]
 * @property {Uint8Array} [masterKey]                    key the caller already derived from `password` under `kdfParams` (the vault key at onboarding); requires `kdfParams`. Copied on receipt, never zeroed here: the caller zeroes its own
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string[]} activeChainIds
 * @property {'full' | 'watcher' | 'signer'} [walletMode]   §20: this wallet's mode, chosen at create, import or pair; default `full`
 * @property {'mainnet' | 'testnet' | 'regtest'} [activeNetwork]   optional. Passed to `ensureSettings` so a fresh wallet's settings record is created with this network selected. Existing settings (e.g. second wallet created in an already-configured vault) preserve their stored value. Defaults: caller should pass an inferred value (typically the networkKind of activeChainIds[0]) so the wallet lands on the network its chains are on.
 */

/**
 * @param {PersistOpts} opts
 */
export async function persistHdWallet({
    mnemonic,
    format,
    origin,
    passphraseEnabled,
    bip39Passphrase = '',
    password,
    name,
    accountName,
    initialAddressLabel,
    kdfParams,
    masterKey: suppliedMasterKey,
    vault,
    chainRegistry,
    sdkRegistry,
    activeChainIds,
    activeNetwork,
    walletMode,
}) {
    // A supplied key belongs to the params it was derived with; calibrating
    // fresh ones beside it would seal a seed no password opens.
    if (suppliedMasterKey !== undefined && kdfParams === undefined) {
        throw new Error('persistHdWallet: a supplied masterKey needs the kdfParams it was derived with');
    }
    // 1. Pick KDF params; shells/tests override to skip calibration. The timed
    // probe only tunes above the supported floor, so a probe failure uses a
    // freshly salted set of the existing minimum parameters.
    let effectiveKdfParams = kdfParams;
    if (effectiveKdfParams === undefined) {
        try {
            effectiveKdfParams = await calibrateKdfParamsAsync();
        } catch {
            effectiveKdfParams = makeFreshKdfParams();
        }
    }
    // Derive once (or copy the caller's key for these same params) and hand
    // it to the encrypt (step 2) and the unlock (step 5); each copies it, and
    // this flow zeroes its own.
    const masterKey = suppliedMasterKey === undefined
        ? await deriveMasterKeyAsync(password, effectiveKdfParams)
        : copyMasterKey(suppliedMasterKey);
    let walletRecord;
    let account;
    let signer;

    let setupFailed = false;
    let setupError;
    try {
        // 2. Encrypt the mnemonic bytes.
        const mnemonicBytes = new TextEncoder().encode(mnemonic);
        let encryptedSeed;
        let storedKdfParams;
        try {
            const enc = await encryptWalletSeed({
                password,
                seed: mnemonicBytes,
                kdfParams: effectiveKdfParams,
                masterKey,
            });
            encryptedSeed = enc.encryptedSeed;
            storedKdfParams = enc.kdfParams;
        } finally {
            mnemonicBytes.fill(0);
        }

        // 3. Build (do not yet persist) the Wallet record. It is not put
        //    until step 7, once it carries its final shape.
        walletRecord = createWalletRecord({
            name,
            origin,
            format,
            passphraseEnabled,
            encryptedSeed,
            kdfParams: storedKdfParams,
            walletMode,
        });

        // A create or import adds a wallet; it never replaces one. A stored
        // record under the same id is refused before any write, so an
        // existing encrypted seed cannot be clobbered.
        if (await vault.wallets.get(walletRecord.id)) {
            throw new Error(`persistHdWallet: wallet "${walletRecord.id}" already exists; refusing to overwrite its stored secret`);
        }
        // 4. Build the first Account. Persistence waits until the wallet
        //    and every initial address are ready.
        account = createAccount({
            walletId: walletRecord.id,
            name: accountName,
            index: 0,
        });
        if (await vault.accounts.get(account.id)) {
            throw new Error(`persistHdWallet: account id collision "${account.id}"`);
        }

        // 5. Unlock the in-memory wallet record via the shared primitive
        //    so address derivation uses the exact same path as a
        //    subsequent unlock. No duplicate signer logic, and this is
        //    also where the master key needed to seal a 25th-word
        //    passphrase (step 6) comes from: the signer keeps its own
        //    session copy, zeroed at lock().
        signer = await unlockWalletRecord({
            wallet: walletRecord,
            password,
            masterKey,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
    } catch (error) {
        setupFailed = true;
        setupError = error;
    } finally {
        masterKey.fill(0);
    }
    if (setupFailed) throw setupError;

    try {
        // 6. Seal the BIP39 passphrase under this wallet's own master
        //    key, once, at capture time (§15.6). Only a non-empty
        //    passphrase on a passphrase-enabled wallet is sealed; a
        //    wallet with none keeps encryptedPassphrase null.
        if (passphraseEnabled && bip39Passphrase.length > 0) {
            walletRecord.encryptedPassphrase = await encryptWalletPassphrase({
                masterKey: signer.getMasterKey(),
                passphrase: bip39Passphrase,
            });
        }

        // 7. Build the first address per active chain before any wallet
        //    records are persisted.
        const addresses = [];
        for (const chainId of activeChainIds) {
            const descriptor = chainRegistry.get(chainId);
            // A restored Counterwallet wallet opens on the legacy address
            // its old wallet showed first - that is where the user's
            // balances are - not on the chain's modern default.
            const addressType = defaultAddressTypeForFormat(descriptor, format);
            const [derived] = await signer.getAddresses({
                chainId,
                accountIndex: 0,
                change: 0,
                startIndex: 0,
                count: 1,
                addressType,
            });
            const record = createAddress({
                accountId: account.id,
                chain: descriptor.coin,
                network: descriptor.networkKind,
                source: 'hd',
                addressType,
                derivationPath: derived.path,
                address: derived.address,
                publicKey: derived.publicKey,
                label: initialAddressLabel ?? `${tickerForCoin(descriptor.coin)} Address #1`,
                signerId: signer.id,
            });
            if (await vault.addresses.get(record.id)) {
                throw new Error(`persistHdWallet: address id collision "${record.id}"`);
            }
            addresses.push({ chainId, address: record });
        }

        const duplicateOf = await existingWalletNameFor(vault, addresses);
        if (duplicateOf !== null) throw new DuplicateWalletError(duplicateOf);

        // 8. Recheck every precondition and persist settings plus the complete
        //    wallet graph in one queued document save. The settings queue keeps
        //    this read-modify-write ordered with settings patches, while the
        //    guarded builder also reruns against a conflict-reloaded document.
        await serializeSettingsWrites(vault, () => vault.putManyGuarded((document) => walletGraphEntries({
            document,
            vault,
            walletRecord,
            account,
            addresses,
            chainRegistry,
            activeChainIds,
            activeNetwork,
        })));

        return { wallet: walletRecord, account, addresses };
    } finally {
        signer.lock();
    }
}
