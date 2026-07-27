// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// dispenserAddress (§16). Derive and persist the address that will host
// a new dispenser for a wallet/account/chain/addressType tuple.
//
// A dispenser address is just a standard external (change=0) address
// tagged with role 'dispenser'. It draws from the SAME contiguous index
// space as the account's personal receive addresses (receiveAddress.js),
// not a separate branch. This is a deliberate change from the original
// design, which quarantined dispensers on change=2: keeping every
// user-facing address on the BIP44 external chain means a seed-only
// restore into ANY BIP44 wallet rediscovers them and their funds
// (§15.4 external pass). The trade-off is that dispenser-ness is now
// local metadata (the `role` tag and label), not encoded in the path, so
// a seed-only restore cannot tell which external addresses were
// dispensers.
//
// Allocation is CONTIGUOUS: "next index" is one past the highest
// persisted change=0 index for the tuple across ALL roles, so it never
// collides with a receive address and never leaves a gap.
//
// Structurally a twin of receiveAddress.js; the only differences are the
// role tag and the default label.

import { createAddress } from '../schemas/address.js';
import { NoMatchingAccountError } from './receiveAddress.js';
import { unlockWallet } from './unlockWallet.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { defaultAddressTypeForWallet } from './_defaultAddressType.js';

/**
 * @typedef {Object} DispenserAddressOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} [password]                required only when `signer` is omitted and the resolved signer is software
 * @property {string} [bip39Passphrase]
 * @property {import('../signers/Signer.js').Signer} [signer]   pre-supplied signer (SoftwareSigner from pool, or RemoteSigner for HW). Skips password when present.
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} [accountId]               preferred, pick the Account by id
 * @property {number} [accountIndex]            fallback, pick by BIP44 index (default 0). Ignored when `accountId` is supplied.
 * @property {string} [addressType]             defaults to descriptor.defaultAddressType
 * @property {string} [label]                   defaults to "<TICKER> Dispenser #N+1" (e.g. "BTC Dispenser #2")
 */

/**
 * @param {DispenserAddressOpts} opts
 * @returns {Promise<import('../schemas/address.js').Address>}
 */
export async function dispenserAddress({
    vault,
    walletId,
    password,
    bip39Passphrase,
    signer: providedSigner,
    chainRegistry,
    sdkRegistry,
    chainId,
    accountId,
    accountIndex = 0,
    addressType,
    label,
}) {
    if (!vault) throw new Error('dispenserAddress: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('dispenserAddress: walletId is required');
    }
    if (!providedSigner && (typeof password !== 'string' || password.length === 0)) {
        throw new Error('dispenserAddress: either `signer` or `password` is required');
    }
    if (!chainRegistry) throw new Error('dispenserAddress: chainRegistry is required');
    if (!sdkRegistry) throw new Error('dispenserAddress: sdkRegistry is required');
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('dispenserAddress: chainId is required');
    }

    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) {
        throw new Error(`dispenserAddress: unknown chain "${chainId}"`);
    }
    const type = addressType
        ?? await defaultAddressTypeForWallet(vault, walletId, descriptor);
    if (!descriptor.addressTypes.includes(type)) {
        throw new Error(
            `dispenserAddress: addressType "${type}" not supported on ${chainId}`,
        );
    }

    // Find the matching Account. Prefer `accountId` when supplied; fall
    // back to (walletId, index) lookup so legacy callers still work.
    const accounts = await vault.accounts.findBy('walletId', walletId);
    let account;
    let resolvedAccountIndex;
    if (typeof accountId === 'string' && accountId.length > 0) {
        account = accounts.find((a) => a.id === accountId);
        if (!account) throw new NoMatchingAccountError(walletId, accountId);
        resolvedAccountIndex = account.index;
    } else {
        account = accounts.find((a) => a.index === accountIndex);
        if (!account) throw new NoMatchingAccountError(walletId, accountIndex);
        resolvedAccountIndex = accountIndex;
    }

    // Scan the account's external (change=0) addresses for this
    // (account, chain, network, addressType) tuple. Two accumulators:
    //   highest        -> the max change=0 index across ALL roles (-1 if
    //                     none); nextIndex is one past it, so a dispenser
    //                     never collides with a personal receive index.
    //   dispenserCount -> how many of those are already dispensers, used
    //                     only for the human "Dispenser #N" default label.
    const allAddresses = await vault.addresses.list();
    let highest = -1;
    let dispenserCount = 0;
    for (const a of allAddresses) {
        if (a.accountId !== account.id) continue;
        if (a.chain !== descriptor.coin) continue;
        if (a.network !== descriptor.networkKind) continue;
        if (a.addressType !== type) continue;
        // Count every HD-derived address regardless of signer kind:
        // software ('hd') and hardware ('trezor'/'ledger') share one
        // external index space per account, so a Trezor account keeps
        // allocating index+1 instead of colliding at 0. imported-wif /
        // watch-only have a null derivationPath and drop out below.
        if (a.source !== 'hd' && a.source !== 'trezor' && a.source !== 'ledger') continue;
        if (typeof a.derivationPath !== 'string') continue;
        const parts = a.derivationPath.split('/');
        // BIP44-style path: m / purpose' / coin' / account' / change / index
        if (parts.length < 2) continue;
        const change = parts[parts.length - 2];
        if (change !== '0') continue;
        if (a.role === 'dispenser') dispenserCount += 1;
        const idx = Number(parts[parts.length - 1]);
        if (Number.isFinite(idx) && idx > highest) highest = idx;
    }
    const nextIndex = highest + 1;

    const signer = providedSigner
        ? providedSigner
        : await unlockWallet({
            vault,
            walletId,
            password,
            bip39Passphrase,
            chainRegistry,
            sdkRegistry,
        });
    const ownsSigner = !providedSigner;
    const signerKind = signer.kind;
    const addressSource = signerKind === 'software' ? 'hd' : signerKind;

    try {
        const [derived] = await signer.getAddresses({
            chainId,
            accountIndex: resolvedAccountIndex,
            change: 0,
            startIndex: nextIndex,
            count: 1,
            addressType: type,
        });
        const record = createAddress({
            accountId: account.id,
            chain: descriptor.coin,
            network: descriptor.networkKind,
            source: addressSource,
            addressType: type,
            derivationPath: derived.path,
            address: derived.address,
            publicKey: derived.publicKey,
            label: label ?? `${tickerForCoin(descriptor.coin)} Dispenser #${dispenserCount + 1}`,
            role: 'dispenser',
            signerId: signer.id,
        });
        await vault.addresses.put(record);
        return record;
    } finally {
        if (ownsSigner && typeof signer.lock === 'function') signer.lock();
    }
}
