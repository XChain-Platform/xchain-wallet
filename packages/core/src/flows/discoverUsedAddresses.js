// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Gap-limit address scan (§15.4): "restore from seed" completeness.
//
// After an import, the wallet knows the seed but not which addresses
// the user has actually used. This flow walks each chain's default
// derivation path starting at index 0, asks the explorer "has this
// been seen on-chain?", and stops after `gapLimit` consecutive unused
// addresses (BIP44 standard is 20).
//
// ---------- Judgment calls documented in one place ----------
//
// Partial-result semantics: a chain's probe can fail mid-scan (explorer
// transiently unreachable, auth error, timeout). In that case the flow
// returns what was discovered up to the failure, marks
// `{ incomplete: true, error }`, and continues to the NEXT chain.
// Callers can resume by re-calling with `startIndex = lastScannedIndex + 1`.
//
// Progress reporting: synchronous `onProgress(event)`, same pattern
// createWallet + submitAction use. Events: `chain-start`, `scan-progress`
// (per-address), `chain-complete`, `chain-failed`. Callbacks that throw
// are isolated from the scan.
//
// Timeouts: two tiers. `perQueryTimeoutMs` bounds a single explorer
// call; exceeded → that address counts as "unknown" and CANNOT be used
// to reset the gap counter (conservative: don't let a flaky response
// mask a used address). `chainTimeoutMs` bounds the whole per-chain
// scan; exceeded → the chain result is `incomplete`.
//
// Persistence: the flow DOES NOT write to the vault. It returns a
// discovery report. Callers decide what to do with the result:
// persist via receiveAddress, present a review screen, drop, whatever.
// This keeps the flow composable across the "dry-run restore" (§19.6)
// and "real restore" paths.
//
// Multiple address types: only the descriptor's `defaultAddressType`
// by default. Opt-in to scanning every supported type via
// `addressTypes: 'all'`. Users who had BIP49 addresses from an older
// FreeWallet flow, for example, supply `addressTypes: 'all'` during
// their first migration scan.

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

export const DEFAULT_GAP_LIMIT = 20;
// Dispenser branch (change=2) is contiguous from index 0 and typically
// short; a smaller gap is ample and bounds restore work (§16).
export const DEFAULT_DISPENSER_GAP_LIMIT = 5;
export const DEFAULT_PER_QUERY_TIMEOUT_MS = 5000;
export const DEFAULT_CHAIN_TIMEOUT_MS = 60000;

/**
 * @typedef {Object} DiscoveredAddress
 * @property {number} index
 * @property {string} path
 * @property {string} addressType
 * @property {string} address
 * @property {string} publicKey
 * @property {boolean} used
 * @property {boolean} unknown     true if the used-check errored / timed out
 */

/**
 * @typedef {Object} DiscoveredChain
 * @property {string} chainId
 * @property {string} addressType
 * @property {DiscoveredAddress[]} addresses
 * @property {number} highestUsedIndex        -1 if no used address was found
 * @property {number} scannedCount            total addresses queried
 * @property {boolean} incomplete
 * @property {string | null} error
 */

/**
 * @typedef {(event: { phase: 'chain-start'|'scan-progress'|'chain-complete'|'chain-failed', chainId: string, addressType?: string, index?: number, data?: unknown, error?: string }) => void} DiscoverProgressCallback
 */

/**
 * @typedef {(sdk: import('../sdk/SDKRegistry.js').XChainSDKLike, address: string) => Promise<{ used: boolean }>} IsUsedProbe
 */

/**
 * @typedef {Object} DiscoverUsedAddressesOpts
 * @property {string} mnemonic
 * @property {'bip39' | 'counterwallet-legacy'} [format]        default 'bip39'
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string[]} [chainIds]            default: every registered chain
 * @property {'default' | 'all' | string[]} [addressTypes]  default 'default'
 * @property {number} [accountIndex]          default 0
 * @property {0 | 1 | 2} [change]             default 0; 1 change, 2 dispenser (§16)
 * @property {number} [gapLimit]              default {@link DEFAULT_GAP_LIMIT}
 * @property {number} [startIndex]            default 0 (for resume semantics)
 * @property {number} [perQueryTimeoutMs]     default {@link DEFAULT_PER_QUERY_TIMEOUT_MS}
 * @property {number} [chainTimeoutMs]        default {@link DEFAULT_CHAIN_TIMEOUT_MS}
 * @property {IsUsedProbe} [isUsedProbe]      default uses `sdk.explorer.getHistory(address, 'address')`
 * @property {DiscoverProgressCallback} [onProgress]
 */

/**
 * @typedef {Object} DiscoverUsedAddressesResult
 * @property {DiscoveredChain[]} perChain
 * @property {number} totalUsedFound
 */

/**
 * @param {DiscoverUsedAddressesOpts} opts
 * @returns {Promise<DiscoverUsedAddressesResult>}
 */
export async function discoverUsedAddresses(opts) {
    const {
        mnemonic,
        format = 'bip39',
        bip39Passphrase = '',
        chainRegistry,
        sdkRegistry,
        chainIds,
        addressTypes = 'default',
        accountIndex = 0,
        change = 0,
        gapLimit = DEFAULT_GAP_LIMIT,
        startIndex = 0,
        perQueryTimeoutMs = DEFAULT_PER_QUERY_TIMEOUT_MS,
        chainTimeoutMs = DEFAULT_CHAIN_TIMEOUT_MS,
        isUsedProbe = defaultIsUsedProbe,
        onProgress = () => {},
    } = opts;

    if (typeof mnemonic !== 'string' || !mnemonic.length) {
        throw new Error('discoverUsedAddresses: mnemonic is required');
    }
    if (!chainRegistry) throw new Error('discoverUsedAddresses: chainRegistry is required');
    if (!sdkRegistry) throw new Error('discoverUsedAddresses: sdkRegistry is required');
    if (!Number.isInteger(gapLimit) || gapLimit < 1 || gapLimit > 200) {
        throw new Error('discoverUsedAddresses: gapLimit must be an integer in [1, 200]');
    }

    // Seed derivation, mirrors dryRunRestore.
    const normalized = normalizeMnemonic(mnemonic);
    let seed;
    if (format === 'bip39') {
        if (!isValidBip39Mnemonic(normalized)) {
            throw new InvalidMnemonicError('bip39', ['checksum or word-list validation failed']);
        }
        seed = await bip39MnemonicToSeed(normalized, bip39Passphrase);
    } else if (format === 'counterwallet-legacy') {
        if (bip39Passphrase.length > 0) {
            throw new Error(
                'discoverUsedAddresses: counterwallet-legacy does not support a BIP39 passphrase',
            );
        }
        if (!isValidCounterwalletMnemonic(normalized)) {
            throw new InvalidMnemonicError('counterwallet-legacy', ['word not in Counterwallet wordlist']);
        }
        seed = counterwalletMnemonicToSeedBytes(normalized);
    } else {
        throw new Error(`discoverUsedAddresses: unsupported format "${format}"`);
    }

    try {
        const hdRoot = hdKeyFromSeed(seed);
        const chains = chainIds ?? chainRegistry.supportedChains().map((d) => d.id);

        /** @type {DiscoveredChain[]} */
        const perChain = [];
        let totalUsedFound = 0;

        for (const chainId of chains) {
            const descriptor = chainRegistry.get(chainId);
            if (!descriptor) {
                throw new Error(`discoverUsedAddresses: unknown chain "${chainId}"`);
            }
            const types = resolveAddressTypes(descriptor, addressTypes);
            for (const addressType of types) {
                let chainResult;
                try {
                    chainResult = await scanChainType({
                        chainId,
                        descriptor,
                        addressType,
                        chainRegistry,
                        sdkRegistry,
                        hdRoot,
                        accountIndex,
                        change,
                        startIndex,
                        gapLimit,
                        perQueryTimeoutMs,
                        chainTimeoutMs,
                        isUsedProbe,
                        onProgress,
                    });
                } catch (e) {
                    // Type-level failure (e.g. SDK doesn't support this
                    // address type, derivation returned no path, etc.).
                    // Record an incomplete result for this type and move
                    // on so other (chain × type) combos still scan.
                    const error = e && e.message ? String(e.message) : String(e);
                    chainResult = {
                        chainId,
                        addressType,
                        addresses: [],
                        highestUsedIndex: -1,
                        scannedCount: 0,
                        incomplete: true,
                        error,
                    };
                    safeCallback(onProgress, { phase: 'chain-failed', chainId, addressType, error });
                }
                perChain.push(chainResult);
                totalUsedFound += chainResult.addresses.filter((a) => a.used).length;
            }
        }

        return { perChain, totalUsedFound };
    } finally {
        seed.fill(0);
    }
}

/**
 * @returns {Promise<DiscoveredChain>}
 */
async function scanChainType({
    chainId,
    descriptor,
    addressType,
    chainRegistry,
    sdkRegistry,
    hdRoot,
    accountIndex,
    change,
    startIndex,
    gapLimit,
    perQueryTimeoutMs,
    chainTimeoutMs,
    isUsedProbe,
    onProgress,
}) {
    const sdk = sdkRegistry.get(chainId);
    safeCallback(onProgress, { phase: 'chain-start', chainId, addressType });

    /** @type {DiscoveredAddress[]} */
    const addresses = [];
    let highestUsedIndex = -1;
    let consecutiveUnused = 0;
    let scannedCount = 0;
    /** @type {string | null} */
    let error = null;
    let incomplete = false;
    const chainDeadline = Date.now() + chainTimeoutMs;

    for (let index = startIndex; ; index++) {
        if (Date.now() > chainDeadline) {
            incomplete = true;
            error = `chain scan exceeded ${chainTimeoutMs}ms`;
            break;
        }
        const path = chainRegistry.derivationPathFor(
            chainId,
            addressType,
            accountIndex,
            change,
            index,
        );
        if (!path) {
            error = `no derivation path for ${chainId}/${addressType}`;
            incomplete = true;
            break;
        }
        const dk = derive(hdRoot, path);
        let address;
        let publicKey;
        try {
            publicKey = dk.publicKeyHex;
            address = sdk.wallet.deriveAddress(publicKey, { type: addressType });
        } finally {
            zeroDerivedKey(dk);
        }

        let used = false;
        let unknown = false;
        try {
            const probeResult = await runWithTimeout(
                () => isUsedProbe(sdk, address),
                perQueryTimeoutMs,
            );
            used = !!probeResult?.used;
        } catch (e) {
            unknown = true;
            // A single probe failure doesn't fail the whole chain:
            // record the address as `unknown` (doesn't reset gap count
            // but doesn't advance it either, so gap-limit stop is
            // conservative). If the failures are persistent the
            // chainTimeoutMs will still bound the work.
            if (!error) error = `probe failed for index ${index}: ${e?.message ?? e}`;
        }
        scannedCount += 1;

        addresses.push({ index, path, addressType, address, publicKey, used, unknown });

        if (used) {
            highestUsedIndex = index;
            consecutiveUnused = 0;
        } else if (!unknown) {
            consecutiveUnused += 1;
        }
        // `unknown` addresses hold the position without advancing or
        // resetting; conservative.

        safeCallback(onProgress, {
            phase: 'scan-progress',
            chainId,
            addressType,
            index,
            data: { used, unknown, consecutiveUnused },
        });

        if (consecutiveUnused >= gapLimit) break;
    }

    if (incomplete) {
        safeCallback(onProgress, { phase: 'chain-failed', chainId, addressType, error });
    } else {
        safeCallback(onProgress, {
            phase: 'chain-complete',
            chainId,
            addressType,
            data: { highestUsedIndex, scannedCount },
        });
    }

    return {
        chainId,
        addressType,
        addresses,
        highestUsedIndex,
        scannedCount,
        incomplete,
        // Preserve a non-fatal error even when the scan completed: a
        // caller that sees `error != null && incomplete === false` knows
        // individual probes hiccuped but the gap-limit was still reached.
        error,
    };
}

function resolveAddressTypes(descriptor, addressTypes) {
    if (addressTypes === 'default') return [descriptor.defaultAddressType];
    if (addressTypes === 'all') return descriptor.addressTypes.slice();
    if (Array.isArray(addressTypes)) {
        for (const t of addressTypes) {
            if (!descriptor.addressTypes.includes(t)) {
                throw new Error(
                    `discoverUsedAddresses: addressType "${t}" not supported on ${descriptor.id}`,
                );
            }
        }
        return addressTypes.slice();
    }
    throw new Error('discoverUsedAddresses: addressTypes must be "default", "all", or string[]');
}

function safeCallback(fn, event) {
    if (typeof fn !== 'function') return;
    try { fn(event); } catch { /* caller bugs do not derail the scan */ }
}

function runWithTimeout(fn, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error(`probe timed out after ${timeoutMs}ms`));
            }
        }, timeoutMs);
        Promise.resolve()
            .then(fn)
            .then((v) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve(v);
                }
            })
            .catch((e) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(e);
                }
            });
    });
}

/** @type {IsUsedProbe} */
async function defaultIsUsedProbe(sdk, address) {
    // Explorer's getHistory returns per-address activity. Empty → unused.
    // Missing endpoint or 4xx → we let runWithTimeout's reject path
    // handle it; don't swallow here.
    if (!sdk.explorer || typeof sdk.explorer.getHistory !== 'function') {
        throw new Error('isUsedProbe: sdk.explorer.getHistory not available');
    }
    const history = await sdk.explorer.getHistory(address, 'address', { limit: 1 });
    if (Array.isArray(history)) return { used: history.length > 0 };
    // Explorer may return a wrapper object; defensively inspect common
    // shapes: { data: [] }, { count: N }, or a bare number.
    if (history && typeof history === 'object') {
        if (Array.isArray(history.data)) return { used: history.data.length > 0 };
        if (typeof history.count === 'number') return { used: history.count > 0 };
    }
    if (typeof history === 'number') return { used: history > 0 };
    return { used: false };
}
