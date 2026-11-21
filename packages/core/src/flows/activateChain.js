// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// activateChain: §48.3 / G149. Adds an additional chain to an existing
// wallet at runtime. Two operations, both idempotent:
//
//   1. Seed `settings.fees[chainId]`
//      via the existing `seedSettingsForChains` helper. After this the
//      chain shows up in `bridge.getActiveChains` and in surfaces that
//      key off `settings.fees`.
//
//   2. For every existing account in the wallet, derive the first address
//      on the new chain and persist it. Mirrors the address loop inside
//      `_persistHdWallet` / `createAccount`. Skipped for accounts that
//      already have an address on this chain (re-running is a no-op), and
//      for accounts whose addresses another signer holds (see
//      ./addressCustody/accountCustody.js).
//
// Callers: Settings → Developer options → Test Networks (Add Network, and a
// custom network's page), and a hardware wallet's Accounts tab and Add
// account, whose Add network fills one network into one existing account
// (`accountId`) through the app open on the device. A developer activating bitcoin-regtest / dogecoin-regtest
// / litecoin-regtest at runtime can drive the local regtest
// stack from a wallet that was created against mainnets. Nothing in the
// flow restricts the chainId to regtest descriptors; when the
// custom chain registry lands (§9.7) it can use the same primitive.
//
// Hardware-signer handling: §17.4 lists HW-derived addresses as the
// signer's responsibility (derived against a SignerRecord rather than the
// wallet's seed). Hardware activation works the same as software, but the
// caller MUST pass a connected RemoteSigner as `signer`: a HW-only wallet
// has no seed in the vault to unlock, and deriving the new chain's first
// address round-trips to the device. The resulting addresses carry
// source 'trezor'/'ledger' and the signer's id, exactly like createAccount.

import { createAddress } from '../schemas/address.js';
import { addressSourceForSignerKind } from '../schemas/constants.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { unlockWalletRecord, WalletNotFoundError } from './unlockWallet.js';
import { seedSettingsForChains } from './seedSettings.js';
import { serializeSettingsWrites } from './settings.js';
import { defaultAddressTypeForFormat } from './_defaultAddressType.js';
import { hardwareNetworkSupport, hardwareWalletRecord, isHardwareWallet } from './hardwareWallet.js';
import { recordLedgerIdentities } from './registerSigner.js';
import { isWrongAppError } from '../signers/hardwareSession.js';
import { accountCustody, signerOwnsCustody } from './addressCustody/accountCustody.js';

/**
 * @typedef {Object} ActivateChainOpts
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} [accountId]                                  only this account of the wallet (a hardware wallet's Add network fills the network into one existing account); every account when absent
 * @property {string} [password]                                   required when no pre-unlocked signer is supplied
 * @property {string} [bip39Passphrase]
 * @property {import('../signers/Signer.js').Signer} [signer]      pre-unlocked signer: software from the pool, or a connected RemoteSigner for hardware (required for HW-only wallets, which have no seed to unlock)
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 */

/**
 * @typedef {Object} ActivateChainResult
 * @property {string} chainId
 * @property {Array<{ accountId: string, address: import('../schemas/address.js').Address }>} addresses   newly persisted addresses (skipped accounts are absent)
 * @property {number} skippedAccounts                              count of accounts that already had an address on chainId
 * @property {Array<{ accountId: string, name: string }>} skippedAccountDetails   accounts that already had an address on chainId
 * @property {Array<{ accountId: string, name: string }>} [custodySkippedAccountDetails]   accounts held on another signer (a device account under the seed, the seed's accounts under a device, another device), left without an address
 * @property {'no-device' | 'unsupported-network' | 'wrong-app'} [hardwareSkipped]   set only for a hardware wallet whose address step was skipped: no device signer was supplied, the device cannot sign this chain, or (a Ledger) another app is open than the chain needs, so the network waits for that app and Try again
 */

/**
 * @param {ActivateChainOpts} opts
 * @returns {Promise<ActivateChainResult>}
 */
export async function activateChain({
    walletId,
    chainId,
    accountId,
    password,
    bip39Passphrase = '',
    signer: providedSigner,
    vault,
    chainRegistry,
    sdkRegistry,
}) {
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('activateChain: walletId is required');
    }
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('activateChain: chainId is required');
    }
    if (!chainRegistry?.has(chainId)) {
        throw new Error(`activateChain: unknown chain "${chainId}"`);
    }
    // A hardware wallet needs no password: it either has its device signer
    // here or skips the address step (no seed to fall back on).
    if (!providedSigner && (typeof password !== 'string' || password.length === 0)
        && !(await hardwareWalletRecord(vault, walletId))) {
        throw new Error('activateChain: either `signer` or `password` is required');
    }
    if (!vault) throw new Error('activateChain: vault is required');
    if (!sdkRegistry) throw new Error('activateChain: sdkRegistry is required');

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    const walletAccounts = await vault.accounts.findBy('walletId', walletId);
    const scoped = typeof accountId === 'string' && accountId.length > 0;
    if (scoped && !walletAccounts.some((a) => a.id === accountId)) {
        throw new Error(`activateChain: account "${accountId}" does not belong to wallet "${walletId}"`);
    }

    // Seed settings first. Even if the address-derivation step fails
    // (signer rejected, etc.) the user still ends up with the chain
    // visible in pickers, which is the worse half of being half-active.
    // Using the existing primitive keeps this idempotent.
    await serializeSettingsWrites(vault, async () => {
        const settings = (await vault.settings.get()) ?? null;
        if (!settings) {
            throw new Error('activateChain: settings record missing (wallet not fully provisioned)');
        }
        const seeded = seedSettingsForChains(settings, chainRegistry, [chainId]);
        if (seeded !== settings) await vault.settings.put(seeded);
    });

    // The account keeps its own number: the address derives at its index.
    const accounts = scoped ? walletAccounts.filter((a) => a.id === accountId) : walletAccounts;
    if (accounts.length === 0) {
        return { chainId, addresses: [], skippedAccounts: 0, skippedAccountDetails: [] };
    }

    // A hardware wallet derives only through its device, and only on a chain
    // the device signs. Without a device signer, or on a chain it cannot
    // sign, the chain is still activated (settings above) and the address
    // step is skipped, with the reason in `hardwareSkipped`.
    if (isHardwareWallet(wallet)) {
        let reason = null;
        if (!providedSigner || providedSigner.kind === 'software') {
            reason = 'no-device';
        } else if (!hardwareNetworkSupport(providedSigner.kind, chainId).supported) {
            reason = 'unsupported-network';
        }
        if (reason) {
            return {
                chainId, addresses: [], skippedAccounts: 0, skippedAccountDetails: [], hardwareSkipped: reason,
            };
        }
    }

    const signer = providedSigner
        ? providedSigner
        : await unlockWalletRecord({
            wallet,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
    const ownsSigner = !providedSigner;

    // Address.source tracks the signer kind: software seeds produce 'hd'
    // addresses; hardware devices produce 'trezor'/'ledger' addresses tied
    // to their SignerRecord by signerId. For hardware the device must be
    // connected so signer.getAddresses can derive the new chain's address.
    const descriptor = chainRegistry.get(chainId);
    const addressType = defaultAddressTypeForFormat(descriptor, wallet?.format);
    const allAddresses = await vault.addresses.list();
    // A Ledger answers only the coin of the app that is open. Another app is
    // a wait for that app (the connect step's line and Try again), never a
    // failure, so it comes back as `hardwareSkipped: 'wrong-app'`.
    const perAppDevice = isHardwareWallet(wallet) && signer.kind === 'ledger';
    let waitingForApp = false;

    try {
        const addressSource = addressSourceForSignerKind(signer.kind);
        const created = [];
        let skipped = 0;
        const skippedAccountDetails = [];
        const custodySkippedAccountDetails = [];
        for (const account of accounts) {
            const accountAddrs = allAddresses.filter((a) => a.accountId === account.id);
            const alreadyHasOnChain = accountAddrs.some(
                (a) => a.chain === descriptor.coin && a.network === descriptor.networkKind,
            );
            if (alreadyHasOnChain) {
                skipped += 1;
                skippedAccountDetails.push({ accountId: account.id, name: account.name || '' });
                continue;
            }
            // One signer serves every account, but a seed wallet may also hold
            // device accounts; derive only where this signer holds the keys.
            if (!signerOwnsCustody(signer, accountCustody(account.id, allAddresses))) {
                custodySkippedAccountDetails.push({ accountId: account.id, name: account.name || '' });
                continue;
            }
            let derived;
            try {
                [derived] = await signer.getAddresses({
                    chainId,
                    accountIndex: account.index,
                    change: 0,
                    startIndex: 0,
                    count: 1,
                    addressType,
                });
            } catch (error) {
                if (!perAppDevice || !isWrongAppError(error)) throw error;
                waitingForApp = true;
                break;
            }
            const record = createAddress({
                accountId: account.id,
                chain: descriptor.coin,
                network: descriptor.networkKind,
                source: addressSource,
                addressType,
                derivationPath: derived.path,
                address: derived.address,
                publicKey: derived.publicKey,
                label: `${tickerForCoin(descriptor.coin)} Address #1`,
                signerId: signer.id,
            });
            await vault.addresses.put(record);
            created.push({ accountId: account.id, address: record });
        }
        // The first read of this network on a Ledger records its identity,
        // which every later read and sign on it is checked against.
        if (perAppDevice && created.length) {
            await recordLedgerIdentities(vault, signer.id, created.map(({ address }) => ({
                chainId,
                accountIndex: accounts.find((a) => a.id === address.accountId)?.index,
                derivationPath: address.derivationPath,
                publicKey: address.publicKey,
            })));
        }
        return {
            chainId,
            addresses: created,
            skippedAccounts: skipped,
            skippedAccountDetails,
            custodySkippedAccountDetails,
            ...(waitingForApp ? { hardwareSkipped: 'wrong-app' } : {}),
        };
    } finally {
        if (ownsSigner && typeof signer.lock === 'function') signer.lock();
    }
}
