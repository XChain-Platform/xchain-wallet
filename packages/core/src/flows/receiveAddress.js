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
// address for a wallet/account/chain/addressType tuple. Ordinary calls
// advance to the lowest free index for the Receive screen's privacy
// posture; advanced callers can request one specific free index.
//
// "Unused" means not held by a persisted Address record and not reported
// as funded on-chain. The scan takes the LOWEST unheld, unfunded index so
// a deleted empty record can be recovered without offering a funded
// receive address a second time.

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

export class DerivationIndexAlreadyHeldError extends Error {
    constructor(derivationIndex) {
        super(`Derivation index ${derivationIndex} is already held by this account.`);
        this.name = 'DerivationIndexAlreadyHeldError';
        this.derivationIndex = derivationIndex;
    }
}

const MAX_DERIVATION_INDEX = 0x7fffffff;

async function addressEverFunded(sdk, address) {
    if (!sdk?.explorer || typeof sdk.explorer.getHistory !== 'function') return null;
    let history;
    try {
        history = await sdk.explorer.getHistory(address, 'address', { limit: 1 });
    } catch {
        return null;
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
 * @property {number} [derivationIndex]         advanced: derive this external index instead of the lowest unheld index
 * @property {string} [label]                   defaults to "<TICKER> Address #N+1" (e.g. "BTC Address #2")
 */

/**
 * Calls on one vault take turns. Each call reads the held indexes, picks the
 * lowest free one and writes the record, so two in flight (a double tap, the
 * Receive screen beside the Add addresses dialog) would both pick the same
 * index and store the same address twice. A failed call never blocks the next.
 *
 * @param {ReceiveAddressOpts} opts
 * @returns {Promise<import('../schemas/address.js').Address>}
 */
export function receiveAddress(opts) {
    const vault = opts?.vault;
    if (vault === null || typeof vault !== 'object') return deriveReceiveAddress(opts);
    const previous = receiveQueues.get(vault) ?? Promise.resolve();
    const run = previous.then(() => deriveReceiveAddress(opts));
    receiveQueues.set(vault, run.catch(() => {}));
    return run;
}

/** Tail of each vault's receive-address queue. */
const receiveQueues = new WeakMap();

async function deriveReceiveAddress({
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
    derivationIndex,
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
    if (derivationIndex !== undefined && (
        !Number.isInteger(derivationIndex)
        || derivationIndex < 0
        || derivationIndex > MAX_DERIVATION_INDEX
    )) {
        throw new RangeError(
            `Derivation index must be a whole number from 0 to ${MAX_DERIVATION_INDEX}.`,
        );
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

    let walletFormat;
    let walletOrigin;
    try {
        const walletRecord = await vault.wallets?.get(walletId);
        walletFormat = walletRecord?.format;
        walletOrigin = walletRecord?.origin;
    } catch {
        walletFormat = undefined;
    }
    // A demo wallet's addresses never go to an explorer: the demo now lands
    // on mainnet, so the "ever funded?" probe would hand a throwaway address
    // to a public mainnet explorer. Unknown funding takes the fresh frontier.
    const probeFunding = walletOrigin !== 'demo';
    if (walletFormat === 'wif-only') {
        throw new Error('receiveAddress: imported-key wallets cannot rotate receive addresses');
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

    // Collect the external (change=0) indices held for this
    // (account, chain, network, addressType) combination. A missing index
    // is reusable only when its derived address has no on-chain history.
    //
    // A counterwallet-legacy wallet derives m/0'/C/I for EVERY address
    // type, so its types share one index space and the addressType filter
    // below must not apply: partitioning by type there would re-issue the
    // key already held at that index under another encoding.
    const sharedIndexSpace = await indexSpaceSharedForWallet(vault, walletId);
    const allAddresses = await vault.addresses.list();
    const held = new Set();
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
        if (Number.isInteger(idx) && idx >= 0) {
            held.add(idx);
            if (idx > highest) highest = idx;
        }
    }
    if (derivationIndex !== undefined && held.has(derivationIndex)) {
        throw new DerivationIndexAlreadyHeldError(derivationIndex);
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

    const isHardware = signerKind === 'trezor' || signerKind === 'ledger';
    try {
        let targetIndex = derivationIndex;
        let derived;
        if (targetIndex === undefined) {
            const sdk = sdkRegistry.get(chainId);
            for (let index = 0; index <= MAX_DERIVATION_INDEX; index += 1) {
                if (held.has(index)) continue;
                const [candidate] = await signer.getAddresses({
                    chainId,
                    accountIndex: resolvedAccountIndex,
                    change: 0,
                    startIndex: index,
                    count: 1,
                    addressType: type,
                });
                const funded = probeFunding
                    ? await addressEverFunded(sdk, candidate.address)
                    : null;
                // An unreadable explorer cannot prove a deleted interior
                // gap safe. The first index beyond every held record is
                // still the normal fresh frontier and remains available
                // offline.
                if (funded === false || (funded === null && index > highest)) {
                    targetIndex = index;
                    derived = candidate;
                    break;
                }
            }
        }
        if (targetIndex === undefined || targetIndex > MAX_DERIVATION_INDEX) {
            throw new RangeError('No receive-address derivation indexes remain.');
        }
        if (!derived) {
            [derived] = await signer.getAddresses({
                chainId,
                accountIndex: resolvedAccountIndex,
                change: 0,
                startIndex: targetIndex,
                count: 1,
                addressType: type,
            });
        }
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
                startIndex: targetIndex,
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
            label: label ?? `${tickerForCoin(descriptor.coin)} Address #${targetIndex + 1}`,
            signerId: signer.id,
        });
        await vault.addresses.put(record);
        return record;
    } finally {
        if (ownsSigner && typeof signer.lock === 'function') signer.lock();
    }
}
