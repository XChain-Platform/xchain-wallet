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
    isValidCounterwalletMnemonic,
    zeroDerivedKey,
} from '../crypto/index.js';
import { InvalidMnemonicError, normalizeMnemonic } from './importMnemonic.js';

export const DEFAULT_DRY_RUN_GAP = 10;
// Dispenser branch (change=2) is contiguous and short; deriving a few
// addresses is enough to confirm the branch restores (§16).
export const DEFAULT_DRY_RUN_DISPENSER_GAP = 5;

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
 * @property {Array<{ index: number, expected: string | null, derived: string, match: boolean }>} [dispenserComparisons]   change=2 branch, present only when scanDispenserBranch is set (§16)
 * @property {DryRunDerivedAddress[]} [dispenserDerived]   change=2 derived addresses, present only when scanDispenserBranch is set
 */

/**
 * @typedef {Object} DryRunRestoreResult
 * @property {boolean} overallMatch               true iff every comparison with an existing record matched
 * @property {DryRunChainMatch[]} perChain
 */

/**
 * @typedef {Object} DryRunRestoreOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId                    current wallet whose addresses we compare against
 * @property {string} mnemonic
 * @property {'bip39' | 'counterwallet-legacy'} [format]   default 'bip39'
 * @property {string} [bip39Passphrase]           ignored for counterwallet-legacy
 * @property {string[]} [activeChainIds]          default: every descriptor in the registry
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {number} [gapLimit]                  per-chain address count; default 10
 * @property {number} [accountIndex]              default 0
 * @property {0 | 1 | 2} [change]                 default 0; 1 change, 2 dispenser (§16)
 * @property {boolean} [scanDispenserBranch]      also compare the change=2 dispenser branch (§16); default false
 * @property {number} [dispenserGapLimit]         dispenser-branch address count; default 5
 */

/**
 * @param {DryRunRestoreOpts} opts
 * @returns {Promise<DryRunRestoreResult>}
 */
export async function dryRunRestore({
    vault,
    walletId,
    mnemonic,
    format = 'bip39',
    bip39Passphrase = '',
    activeChainIds,
    chainRegistry,
    sdkRegistry,
    gapLimit = DEFAULT_DRY_RUN_GAP,
    accountIndex = 0,
    change = 0,
    scanDispenserBranch = false,
    dispenserGapLimit = DEFAULT_DRY_RUN_DISPENSER_GAP,
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
        if (!isValidCounterwalletMnemonic(normalized)) {
            throw new InvalidMnemonicError('counterwallet-legacy', ['word not in Counterwallet wordlist']);
        }
        seed = counterwalletMnemonicToSeedBytes(normalized);
    } else {
        throw new Error(`dryRunRestore: unsupported format "${format}"`);
    }

    try {
        // Seed → HD root. One root, many paths. Freshly derived private
        // keys are zeroed inside the per-path loop.
        const hdRoot = hdKeyFromSeed(seed);

        const allAddresses = await vault.addresses.list();
        const chainIds = activeChainIds ?? chainRegistry.supportedChains().map((d) => d.id);

        /** @type {DryRunChainMatch[]} */
        const perChain = [];
        let overallMatch = true;

        // Derive `count` addresses on one change branch and compare each
        // against the wallet's persisted records. Shared by the primary
        // (change=0) pass and the optional dispenser (change=2) pass.
        const deriveAndCompare = (chainId, descriptor, sdk, addressType, branchChange, count) => {
            const derived = /** @type {DryRunDerivedAddress[]} */ ([]);
            for (let index = 0; index < count; index++) {
                const path = chainRegistry.derivationPathFor(
                    chainId,
                    addressType,
                    accountIndex,
                    branchChange,
                    index,
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

            const comparisons = [];
            let matchedCount = 0;
            let divergentCount = 0;
            let missingCount = 0;
            for (const entry of derived) {
                const existing = allAddresses.find(
                    (a) =>
                        a.derivationPath === entry.path &&
                        a.chain === descriptor.coin &&
                        a.network === descriptor.networkKind,
                );
                const expected = existing ? existing.address : null;
                const match = expected !== null && expected === entry.address;
                if (!existing) missingCount += 1;
                else if (match) matchedCount += 1;
                else divergentCount += 1;
                comparisons.push({
                    index: entry.index,
                    expected,
                    derived: entry.address,
                    match,
                });
            }
            return { derived, comparisons, matchedCount, divergentCount, missingCount };
        };

        for (const chainId of chainIds) {
            const descriptor = chainRegistry.get(chainId);
            if (!descriptor) {
                throw new Error(`dryRunRestore: unknown chainId "${chainId}"`);
            }
            const addressType = descriptor.defaultAddressType;
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

            // §16: optionally confirm the dispenser branch restores too.
            // Its divergences also fail the overall match, but its matches
            // do NOT feed the "seed corresponds to wallet" heuristic below
            // (that stays anchored on the primary branch).
            if (scanDispenserBranch) {
                const disp = deriveAndCompare(chainId, descriptor, sdk, addressType, 2, dispenserGapLimit);
                if (disp.divergentCount > 0) overallMatch = false;
                chainMatch.dispenserDerived = disp.derived;
                chainMatch.dispenserComparisons = disp.comparisons;
            }

            perChain.push(chainMatch);
        }

        // If the wallet has addresses but NONE matched, the seed does
        // not correspond to this wallet, so flip overallMatch to false.
        const anyWalletAddressExists = allAddresses.some(
            (a) => a.derivationPath !== null,
        );
        const anyMatch = perChain.some((c) => c.matchedCount > 0);
        if (anyWalletAddressExists && !anyMatch) overallMatch = false;

        return { overallMatch, perChain };
    } finally {
        seed.fill(0);
    }
}
