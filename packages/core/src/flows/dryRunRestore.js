// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Dry-run restore (§19.6). Derives the first N addresses per active
// chain from a caller-supplied mnemonic (+ optional BIP39 passphrase)
// and compares them against the current wallet's persisted addresses.
// Nothing persists. Seed material is zeroed on exit.
//
// Use cases per spec:
//   - Verify a paper backup without a destructive restore.
//   - Test a newly generated seed before deleting the old wallet.
//   - Sanity-check a restore before committing.
//
// This flow is FORMAT-AWARE (BIP39 vs Counterwallet). The caller picks
// a format up-front (matching how the user entered their words on the
// "Test your backup" screen); we do NOT auto-detect, because the same
// 12 words can be valid BIP39 AND valid Counterwallet in pathological
// cases and silently choosing one would mask a mismatch.

import {
    bip39MnemonicToSeed,
    counterwalletMnemonicToSeedBytes,
    derive,
    hdKeyFromSeed,
    isValidBip39Mnemonic,
    validateCounterwalletMnemonic,
    zeroDerivedKey,
} from '../crypto/index.js';
import { defaultAddressTypeForFormat } from './_defaultAddressType.js';
import { isUnknownAddressTypeError } from './sdkAddressTypes.js';
import { InvalidMnemonicError, normalizeMnemonic } from './importMnemonic.js';

export const DEFAULT_DRY_RUN_GAP = 10;

/**
 * @typedef {Object} DryRunDerivedAddress
 * @property {number} index
 * @property {string} path
 * @property {string} addressType
 * @property {string} address
 * @property {string} publicKey
 */

/**
 * @typedef {Object} DryRunChainMatch
 * @property {string} chainId
 * @property {string} addressType
 * @property {DryRunDerivedAddress[]} derived
 * @property {Array<{ index: number, expected: string | null, derived: string, match: boolean }>} comparisons
 * @property {number} matchedCount               matches across indices where current wallet has an address
 * @property {number} divergentCount             same indices, different address (this is the "red X" signal)
 * @property {number} missingCount               derived something but current wallet has nothing at this (path, type)
 */

/**
 * @typedef {Object} DryRunRestoreResult
 * @property {boolean} overallMatch               true iff at least one comparison matched and none diverged
 * @property {DryRunChainMatch[]} perChain
 */

/**
 * @typedef {Object} DryRunRestoreOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId                    current wallet whose addresses we compare against
 * @property {string} mnemonic
 * @property {'bip39' | 'counterwallet-legacy'} [format]   defaults to the stored wallet format
 * @property {string} [bip39Passphrase]           ignored for counterwallet-legacy
 * @property {string[]} [activeChainIds]          default: every descriptor in the registry
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {number} [gapLimit]                  per-chain address count; default 10
 * @property {number} [accountIndex]              default 0
 * @property {0 | 1} [change]                     default 0; BIP44 branch (0 external, 1 internal change) (§16)
 */

function deriveStoredType(entry, record, sdk) {
    if (record.addressType === entry.addressType) return entry.address;
    try {
        return sdk.wallet.deriveAddress(entry.publicKey, { type: record.addressType });
    } catch (err) {
        if (isUnknownAddressTypeError(err)) return null;
        throw err;
    }
}

function compareDerivedAddresses(derived, walletAddresses, descriptor, sdk) {
    const comparisons = [];
    let matchedCount = 0;
    let divergentCount = 0;
    let missingCount = 0;
    for (const entry of derived) {
        const existing = walletAddresses.filter(
            (address) =>
                address.derivationPath === entry.path &&
                address.chain === descriptor.coin &&
                address.network === descriptor.networkKind,
        );
        const checked = existing.flatMap((record) => {
            const address = deriveStoredType(entry, record, sdk);
            return address === null ? [] : [{ record, derived: address }];
        });
        const mismatch = checked.find(({ record, derived: address }) => record.address !== address);
        const reported = mismatch ?? checked.find(({ record }) => (
            record.addressType === entry.addressType
        )) ?? checked[0];
        const expected = reported?.record.address ?? null;
        const derivedAddress = reported?.derived ?? entry.address;
        const match = checked.length > 0 && !mismatch;
        if (checked.length === 0) missingCount += 1;
        else if (match) matchedCount += 1;
        else divergentCount += 1;
        comparisons.push({
            index: entry.index,
            expected,
            derived: derivedAddress,
            match,
        });
    }
    return { derived, comparisons, matchedCount, divergentCount, missingCount };
}

/**
 * @param {DryRunRestoreOpts} opts
 * @returns {Promise<DryRunRestoreResult>}
 */
export async function dryRunRestore({
    vault,
    walletId,
    mnemonic,
    format,
    bip39Passphrase = '',
    activeChainIds,
    chainRegistry,
    sdkRegistry,
    gapLimit = DEFAULT_DRY_RUN_GAP,
    accountIndex = 0,
    change = 0,
}) {
    if (!vault) throw new Error('dryRunRestore: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('dryRunRestore: walletId is required');
    }
    if (typeof mnemonic !== 'string' || mnemonic.length === 0) {
        throw new Error('dryRunRestore: mnemonic is required');
    }
    if (!chainRegistry) throw new Error('dryRunRestore: chainRegistry is required');
    if (!sdkRegistry) throw new Error('dryRunRestore: sdkRegistry is required');
    const wallet = await vault.wallets?.get?.(walletId);
    if (!wallet) throw new Error(`dryRunRestore: wallet "${walletId}" was not found`);
    if (wallet.format !== 'bip39' && wallet.format !== 'counterwallet-legacy') {
        throw new Error(`dryRunRestore: unsupported stored format "${wallet.format}"`);
    }
    if (format !== undefined && format !== wallet.format) {
        throw new Error('dryRunRestore: requested format does not match the wallet format');
    }
    format = wallet.format;
    if (format === 'counterwallet-legacy' && bip39Passphrase.length > 0) {
        throw new Error(
            'dryRunRestore: counterwallet-legacy wallets do not support a BIP39 passphrase',
        );
    }
    if (!Number.isInteger(gapLimit) || gapLimit < 1 || gapLimit > 1000) {
        throw new Error('dryRunRestore: gapLimit must be a positive integer ≤ 1000');
    }

    const normalized = normalizeMnemonic(mnemonic);
    let seed;
    if (format === 'bip39') {
        if (!isValidBip39Mnemonic(normalized)) {
            throw new InvalidMnemonicError('bip39', ['checksum or word-list validation failed']);
        }
        seed = await bip39MnemonicToSeed(normalized, bip39Passphrase);
    } else if (format === 'counterwallet-legacy') {
        const validation = validateCounterwalletMnemonic(normalized);
        if (!validation.ok) {
            throw new InvalidMnemonicError('counterwallet-legacy', validation.errors);
        }
        seed = counterwalletMnemonicToSeedBytes(normalized);
    } else {
        throw new Error(`dryRunRestore: unsupported format "${format}"`);
    }

    try {
        // Seed → HD root. One root, many paths. Freshly derived private
        // keys are zeroed inside the per-path loop.
        const hdRoot = hdKeyFromSeed(seed);

        const accounts = await vault.accounts.findBy('walletId', walletId);
        const accountIds = new Set(accounts.map((account) => account.id));
        const walletAddresses = (await vault.addresses.list()).filter(
            (address) => accountIds.has(address.accountId),
        );
        const chainIds = activeChainIds ?? chainRegistry.supportedChains().map((d) => d.id);

        /** @type {DryRunChainMatch[]} */
        const perChain = [];
        let overallMatch = true;

        // Derive `count` addresses on one change branch and compare each
        // against the wallet's persisted records. Dispensers are ordinary
        // external (change=0) addresses, so the primary pass already
        // covers them; there is no separate dispenser pass.
        const deriveAndCompare = (chainId, descriptor, sdk, addressType, branchChange, count) => {
            const derived = /** @type {DryRunDerivedAddress[]} */ ([]);
            for (let index = 0; index < count; index++) {
                const path = chainRegistry.derivationPathFor(
                    chainId,
                    addressType,
                    accountIndex,
                    branchChange,
                    index,
                    { format },
                );
                if (!path) {
                    throw new Error(
                        `dryRunRestore: no derivation path for ${chainId}/${addressType}`,
                    );
                }
                const dk = derive(hdRoot, path);
                try {
                    const addr = sdk.wallet.deriveAddress(dk.publicKeyHex, { type: addressType });
                    derived.push({
                        index,
                        path,
                        addressType,
                        address: addr,
                        publicKey: dk.publicKeyHex,
                    });
                } finally {
                    zeroDerivedKey(dk);
                }
            }

            return compareDerivedAddresses(derived, walletAddresses, descriptor, sdk);
        };

        for (const chainId of chainIds) {
            const descriptor = chainRegistry.get(chainId);
            if (!descriptor) {
                throw new Error(`dryRunRestore: unknown chainId "${chainId}"`);
            }
            const addressType = defaultAddressTypeForFormat(descriptor, format);
            const sdk = sdkRegistry.get(chainId);

            const main = deriveAndCompare(chainId, descriptor, sdk, addressType, change, gapLimit);
            if (main.divergentCount > 0) overallMatch = false;

            /** @type {DryRunChainMatch} */
            const chainMatch = {
                chainId,
                addressType,
                derived: main.derived,
                comparisons: main.comparisons,
                matchedCount: main.matchedCount,
                divergentCount: main.divergentCount,
                missingCount: main.missingCount,
            };

            perChain.push(chainMatch);
        }

        // A backup check must never pass without evidence from at least
        // one persisted address belonging to the selected wallet.
        const anyMatch = perChain.some((c) => c.matchedCount > 0);
        if (!anyMatch) overallMatch = false;

        return { overallMatch, perChain };
    } finally {
        seed.fill(0);
    }
}
