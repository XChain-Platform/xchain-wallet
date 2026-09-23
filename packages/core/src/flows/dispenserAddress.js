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
// "Next index" fills the lowest change=0 index across ALL roles that has
// no persisted Address record AND was never funded on-chain, so it never
// collides with a receive address. This is NOT the same rule as
// receiveAddress.js's plain lowest-missing-index reuse: a dispenser
// address can hold real escrowed value, so a gap left by a deleted
// dispenser that the chain shows was actually used stays permanently
// skipped, the same way the highest-index-plus-one scan this replaces
// already treated every gap, rather than being handed to a second
// dispenser that a buyer or explorer may still have on record.
//
// Structurally a twin of receiveAddress.js; the differences are the role
// tag, the default label, and this funded-gap check.

import { createAddress } from '../schemas/address.js';
import { NoMatchingAccountError } from './receiveAddress.js';
import { unlockWallet } from './unlockWallet.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { defaultAddressTypeForWallet } from './_defaultAddressType.js';
import { indexSpaceSharedForWallet } from './_addressIndexSpace.js';

/**
 * Whether the chain shows any history at all for `address`, i.e. it was
 * funded at some point even if its balance is zero now. Missing explorer
 * support or a probe failure fails CLOSED: without an answer the flow
 * cannot prove the gap is safe, so it is treated as used and the index
 * range grows past it instead of risking a dispenser address that was
 * already issued once before.
 *
 * @param {import('../sdk/SDKRegistry.js').XChainSDKLike} sdk
 * @param {string} address
 * @returns {Promise<boolean>}
 */
async function addressEverFunded(sdk, address) {
    if (!sdk || !sdk.explorer || typeof sdk.explorer.getHistory !== 'function') return true;
    let history;
    try {
        history = await sdk.explorer.getHistory(address, 'address', { limit: 1 });
    } catch {
        return true;
    }
    if (Array.isArray(history)) return history.length > 0;
    if (history && typeof history === 'object') {
        if (Array.isArray(history.data)) return history.data.length > 0;
        if (typeof history.count === 'number') return history.count > 0;
    }
    if (typeof history === 'number') return history > 0;
    return false;
}

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
    // (account, chain, network, addressType) tuple. Accumulators:
    //   held           -> every change=0 index across ALL roles that has a
    //                     persisted record right now.
    //   highest        -> the max of `held` (-1 if none); a dispenser
    //                     never allocates past its own index space, so
    //                     nothing beyond `highest` needs a gap check.
    //   dispenserCount -> how many of those are already dispensers, used
    //                     only for the human "Dispenser #N" default label.
    // A counterwallet-legacy wallet derives m/0'/C/I for EVERY address
    // type, so its types share one index space and the addressType filter
    // below must not apply. Partitioning by type there would hand the
    // dispenser the key already in use as a personal receive address -
    // the exact collision the "never collides" note above rules out.
    const sharedIndexSpace = await indexSpaceSharedForWallet(vault, walletId);
    const allAddresses = await vault.addresses.list();
    const held = new Set();
    let highest = -1;
    let dispenserCount = 0;
    for (const a of allAddresses) {
        if (a.accountId !== account.id) continue;
        if (a.chain !== descriptor.coin) continue;
        if (a.network !== descriptor.networkKind) continue;
        if (!sharedIndexSpace && a.addressType !== type) continue;
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
        if (Number.isInteger(idx) && idx >= 0) {
            held.add(idx);
            if (idx > highest) highest = idx;
        }
    }

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
        // Fill the lowest gap below `highest` whose address the chain has
        // never funded; a gap the chain shows was actually used stays
        // skipped, same as `held`, so the range grows past it instead.
        const sdk = sdkRegistry.get(chainId);
        let nextIndex = null;
        let candidate = null;
        for (let i = 0; i < highest; i += 1) {
            if (held.has(i)) continue;
            const [gapAddress] = await signer.getAddresses({
                chainId,
                accountIndex: resolvedAccountIndex,
                change: 0,
                startIndex: i,
                count: 1,
                addressType: type,
            });
            if (!(await addressEverFunded(sdk, gapAddress.address))) {
                nextIndex = i;
                candidate = gapAddress;
                break;
            }
        }
        if (nextIndex === null) nextIndex = highest + 1;

        const [derived] = candidate ? [candidate] : await signer.getAddresses({
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
