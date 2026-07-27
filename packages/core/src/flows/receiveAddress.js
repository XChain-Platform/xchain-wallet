// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// receiveAddress: §29.7. Derive and persist the next unused external
// address for a wallet/account/chain/addressType tuple. Each call
// advances the index: "fresh address per open of the Receive screen"
// per the spec's privacy posture.
//
// "Highest existing index" is computed from persisted Address records
// (addresses that have been handed out). This doesn't check on-chain
// usage; the UI layer can cross-reference SDK history if it wants to
// reuse a pre-generated-but-unfunded address.

import { createAddress } from '../schemas/address.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { unlockWallet } from './unlockWallet.js';
import { HardwareAddressMismatchError } from './verifyReceiveAddress.js';
import { defaultAddressTypeForWallet } from './_defaultAddressType.js';
import { indexSpaceSharedForWallet } from './_addressIndexSpace.js';

export class NoMatchingAccountError extends Error {
    constructor(walletId, accountIndex) {
        super(
            `receiveAddress: wallet "${walletId}" has no account at index ${accountIndex}`,
        );
        this.name = 'NoMatchingAccountError';
        this.walletId = walletId;
        this.accountIndex = accountIndex;
    }
}

/**
 * @typedef {Object} ReceiveAddressOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} [password]                required only when `signer` is omitted and the resolved signer is software
 * @property {string} [bip39Passphrase]
 * @property {import('../signers/Signer.js').Signer} [signer]   pre-supplied signer (SoftwareSigner from pool, or RemoteSigner for HW). Skips password when present.
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} [accountId]               preferred: pick the Account by id
 * @property {number} [accountIndex]            fallback: pick by BIP44 index (default 0). Ignored when `accountId` is supplied.
 * @property {string} [addressType]             defaults to descriptor.defaultAddressType
 * @property {string} [label]                   defaults to "<TICKER> Address #N+1" (e.g. "BTC Address #2")
 */

/**
 * @param {ReceiveAddressOpts} opts
 * @returns {Promise<import('../schemas/address.js').Address>}
 */
export async function receiveAddress({
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
    if (!vault) throw new Error('receiveAddress: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('receiveAddress: walletId is required');
    }
    if (!providedSigner && (typeof password !== 'string' || password.length === 0)) {
        throw new Error('receiveAddress: either `signer` or `password` is required');
    }
    if (!chainRegistry) throw new Error('receiveAddress: chainRegistry is required');
    if (!sdkRegistry) throw new Error('receiveAddress: sdkRegistry is required');
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('receiveAddress: chainId is required');
    }

    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) {
        throw new Error(`receiveAddress: unknown chain "${chainId}"`);
    }
    const type = addressType
        ?? await defaultAddressTypeForWallet(vault, walletId, descriptor);
    if (!descriptor.addressTypes.includes(type)) {
        throw new Error(
            `receiveAddress: addressType "${type}" not supported on ${chainId}`,
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

    // Find the highest external (change=0) index for this
    // (account, chain, network, addressType) combination. -1 means "no
    // addresses yet"; nextIndex starts at 0.
    //
    // A counterwallet-legacy wallet derives m/0'/C/I for EVERY address
    // type, so its types share one index space and the addressType filter
    // below must not apply: partitioning by type there would re-issue the
    // key already held at that index under another encoding.
    const sharedIndexSpace = await indexSpaceSharedForWallet(vault, walletId);
    const allAddresses = await vault.addresses.list();
    let highest = -1;
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

    const isHardware = signerKind === 'trezor' || signerKind === 'ledger';
    try {
        const [derived] = await signer.getAddresses({
            chainId,
            accountIndex: resolvedAccountIndex,
            change: 0,
            startIndex: nextIndex,
            count: 1,
            addressType: type,
        });
        if (isHardware) {
            // §17.6: a fresh HARDWARE receive address is confirmed on the
            // device's trusted screen before it is persisted, so a
            // compromised host/transport cannot silently substitute a
            // deposit address. The device physically displays the address
            // (verify:true); the returned value is cross-checked against the
            // silent derivation as a tripwire against an inconsistent
            // transport. Mismatch aborts without persisting.
            const [shown] = await signer.getAddresses({
                chainId,
                accountIndex: resolvedAccountIndex,
                change: 0,
                startIndex: nextIndex,
                count: 1,
                addressType: type,
                verify: true,
            });
            if (!shown || shown.address !== derived.address) {
                throw new HardwareAddressMismatchError({
                    expected: derived.address,
                    deviceAddress: shown?.address,
                    path: derived.path,
                });
            }
        }
        const record = createAddress({
            accountId: account.id,
            chain: descriptor.coin,
            network: descriptor.networkKind,
            source: addressSource,
            addressType: type,
            derivationPath: derived.path,
            address: derived.address,
            publicKey: derived.publicKey,
            label: label ?? `${tickerForCoin(descriptor.coin)} Address #${nextIndex + 1}`,
            signerId: signer.id,
        });
        await vault.addresses.put(record);
        return record;
    } finally {
        if (ownsSigner && typeof signer.lock === 'function') signer.lock();
    }
}
