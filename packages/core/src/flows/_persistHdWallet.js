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
import { tickerForCoin } from '../registry/coinTicker.js';
import { ensureSettingsNow } from './seedSettings.js';
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
        const match = stored.find((existing) => existing.source === 'hd'
            && existing.address === address.address
            && existing.chain === address.chain
            && existing.network === address.network);
        if (!match) continue;
        const account = await vault.accounts.get(match.accountId);
        const wallet = account ? await vault.wallets.get(account.walletId) : null;
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
    let settingsSeed = null;
    let accountPutAttempted = false;
    let walletPutAttempted = false;
    let settingsPutAttempted = false;
    const addressPutIds = [];
    const rollback = async (error) => {
        const rollbackErrors = [];
        if (settingsPutAttempted) {
            try {
                await rollbackSettingsSeed(vault, settingsSeed);
            } catch (e) {
                rollbackErrors.push(e);
            }
        }
        for (const id of addressPutIds.reverse()) {
            try { await vault.addresses.delete(id); } catch (e) { rollbackErrors.push(e); }
        }
        if (walletPutAttempted && walletRecord) {
            try { await vault.wallets.delete(walletRecord.id); } catch (e) { rollbackErrors.push(e); }
        }
        if (accountPutAttempted && account) {
            try { await vault.accounts.delete(account.id); } catch (e) { rollbackErrors.push(e); }
        }
        if (rollbackErrors.length > 0) {
            throw new AggregateError(
                [error, ...rollbackErrors],
                'persistHdWallet: persistence and rollback failed',
                { cause: error },
            );
        }
        throw error;
    };

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
    if (setupFailed) await rollback(setupError);

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

        // 8. Seed per-chain Settings entries (fees + ADS) for any
        //    active chain not already configured. Idempotent: a user's
        //    customized fee strategy on an earlier wallet is preserved
        //    if they create a second wallet in the same vault. This runs
        //    before wallet records so a settings failure cannot leave an
        //    incomplete wallet behind; rollback restores the prior settings.
        settingsPutAttempted = true;
        await serializeSettingsWrites(vault, async () => {
            await ensureSettingsNow(
                vault,
                chainRegistry,
                activeChainIds,
                { activeNetwork },
                ({ before, seeded }) => {
                    settingsSeed = settingsSeedDelta(before, seeded, activeChainIds);
                },
            );
        });

        // 9. Persist the complete wallet graph. Every generated id is new,
        //    so removing these records restores the pre-call graph if a
        //    collection write fails after mutating the in-memory vault.
        //    A failure here is undone by rollback() in the catch below.
        walletPutAttempted = true;
        await vault.wallets.put(walletRecord);
        accountPutAttempted = true;
        await vault.accounts.put(account);
        for (const { address } of addresses) {
            addressPutIds.push(address.id);
            await vault.addresses.put(address);
        }

        return { wallet: walletRecord, account, addresses };
    } catch (error) {
        await rollback(error);
    } finally {
        signer.lock();
    }
}
