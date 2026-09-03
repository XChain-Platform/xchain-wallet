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
    calibrateKdfParams,
    encryptWalletSeed,
    encryptWalletPassphrase,
    COUNTERWALLET_DEFAULT_ADDRESS_TYPE,
} from '../crypto/index.js';
import { createWallet as createWalletRecord } from '../schemas/wallet.js';
import { createAccount } from '../schemas/account.js';
import { createAddress } from '../schemas/address.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { ensureSettings } from './seedSettings.js';
import { unlockWalletRecord } from './unlockWallet.js';

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
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string[]} activeChainIds
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
    vault,
    chainRegistry,
    sdkRegistry,
    activeChainIds,
    activeNetwork,
}) {
    // 1. Pick KDF params; shells/tests override to skip calibration.
    const effectiveKdfParams = kdfParams ?? calibrateKdfParams();

    // 2. Encrypt the mnemonic bytes.
    const mnemonicBytes = new TextEncoder().encode(mnemonic);
    let encryptedSeed;
    let storedKdfParams;
    try {
        const enc = await encryptWalletSeed({
            password,
            seed: mnemonicBytes,
            kdfParams: effectiveKdfParams,
        });
        encryptedSeed = enc.encryptedSeed;
        storedKdfParams = enc.kdfParams;
    } finally {
        mnemonicBytes.fill(0);
    }

    // 3. Build (do not yet persist) the Wallet record. It is not put
    //    until step 7, once it carries its final shape.
    const walletRecord = createWalletRecord({
        name,
        origin,
        format,
        passphraseEnabled,
        encryptedSeed,
        kdfParams: storedKdfParams,
    });

    // 4. Build & persist the first Account. `validateAccount` checks
    //    only that walletId is a non-empty string, no foreign-key
    //    lookup against the vault, so this is safe before the wallet
    //    itself is stored.
    const account = createAccount({
        walletId: walletRecord.id,
        name: accountName,
        index: 0,
    });
    await vault.accounts.put(account);

    // 5. Unlock the in-memory wallet record via the shared primitive
    //    so address derivation uses the exact same path as a
    //    subsequent unlock. No duplicate signer logic, and this is
    //    also where the master key needed to seal a 25th-word
    //    passphrase (step 6) comes from.
    const signer = await unlockWalletRecord({
        wallet: walletRecord,
        password,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
    });

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

        // 7. Persist the Wallet record, now in its final shape. One
        //    put instead of two: there is no window in which the
        //    record exists without its passphrase already sealed.
        await vault.wallets.put(walletRecord);

        // 8. First address per active chain.
        const addresses = [];
        for (const chainId of activeChainIds) {
            const descriptor = chainRegistry.get(chainId);
            // A restored Counterwallet wallet opens on the legacy address
            // its old wallet showed first - that is where the user's
            // balances are - not on the chain's modern default.
            const addressType = format === 'counterwallet-legacy'
                ? COUNTERWALLET_DEFAULT_ADDRESS_TYPE
                : descriptor.defaultAddressType;
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
            await vault.addresses.put(record);
            addresses.push({ chainId, address: record });
        }

        // 9. Seed per-chain Settings entries (fees + ADS) for any
        //    active chain not already configured. Idempotent: a user's
        //    customized fee strategy on an earlier wallet is preserved
        //    if they create a second wallet in the same vault.
        await ensureSettings(vault, chainRegistry, activeChainIds, { activeNetwork });

        return { wallet: walletRecord, account, addresses };
    } finally {
        signer.lock();
    }
}
