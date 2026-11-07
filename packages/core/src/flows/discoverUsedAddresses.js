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
// call; exceeded → that address counts as "unknown" and CANNOT reset
// the gap counter (conservative: don't let a flaky response
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
// their first migration scan. Legacy formats count one gap across all
// requested encodings because those encodings share the same key index.

import {
    bip39MnemonicToSeed,
    counterwalletMnemonicToSeedBytes,
    hdKeyFromSeed,
    isValidBip39Mnemonic,
    validateCounterwalletMnemonic,
} from '../crypto/index.js';
import { InvalidMnemonicError, normalizeMnemonic } from './importMnemonic.js';
import { indexSpaceSharedAcrossTypes } from './_addressIndexSpace.js';
import { defaultAddressTypeForFormat } from './_defaultAddressType.js';
import {
    scanChainType,
    scanSharedChainTypes,
} from './addressDiscovery/usedAddressScan.js';

export const DEFAULT_GAP_LIMIT = 20;
export const DEFAULT_PER_QUERY_TIMEOUT_MS = 5000;
export const DEFAULT_CHAIN_TIMEOUT_MS = 60000;
const MAX_DERIVATION_INDEX = 0x7fffffff;
const MAX_TIMEOUT_MS = 0x7fffffff;

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
 * @property {'bip39' | 'counterwallet-legacy'} format         must match the wallet format
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string[]} [chainIds]            default: every registered chain
 * @property {'default' | 'all' | string[]} [addressTypes]  default 'default'
 * @property {number} [accountIndex]          default 0
 * @property {0 | 1} [change]                default 0; BIP44 branch (0 external, 1 internal change) (§16)
 * @property {number} [gapLimit]              default {@link DEFAULT_GAP_LIMIT}
 * @property {number} [startIndex]            default 0 (for resume semantics)
 * @property {number} [perQueryTimeoutMs]     default {@link DEFAULT_PER_QUERY_TIMEOUT_MS}
 * @property {number} [chainTimeoutMs]        default {@link DEFAULT_CHAIN_TIMEOUT_MS}
 * @property {IsUsedProbe} [isUsedProbe]      default uses `sdk.explorer.getHistory(address, 'address')`
 * @property {DiscoverProgressCallback} [onProgress]
 * @property {AbortSignal} [signal]            cancels the scan with an AbortError
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
    if (!opts || typeof opts !== 'object') {
        throw new Error('discoverUsedAddresses: options are required');
    }
    const {
        mnemonic,
        format,
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
        signal,
    } = opts;

    if (typeof mnemonic !== 'string' || !mnemonic.trim().length) {
        throw new Error('discoverUsedAddresses: mnemonic is required');
    }
    if (!chainRegistry) throw new Error('discoverUsedAddresses: chainRegistry is required');
    if (!sdkRegistry) throw new Error('discoverUsedAddresses: sdkRegistry is required');
    if (typeof bip39Passphrase !== 'string') {
        throw new Error('discoverUsedAddresses: bip39Passphrase must be a string');
    }
    if (chainIds !== undefined && (
        !Array.isArray(chainIds)
        || chainIds.length === 0
        || chainIds.some((id) => typeof id !== 'string' || id.length === 0)
    )) {
        throw new Error('discoverUsedAddresses: chainIds must be a non-empty string array');
    }
    if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > MAX_DERIVATION_INDEX) {
        throw new Error(`discoverUsedAddresses: accountIndex must be an integer in [0, ${MAX_DERIVATION_INDEX}]`);
    }
    if (change !== 0 && change !== 1) {
        throw new Error('discoverUsedAddresses: change must be 0 or 1');
    }
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > MAX_DERIVATION_INDEX) {
        throw new Error(`discoverUsedAddresses: startIndex must be an integer in [0, ${MAX_DERIVATION_INDEX}]`);
    }
    if (!Number.isInteger(gapLimit) || gapLimit < 1 || gapLimit > 200) {
        throw new Error('discoverUsedAddresses: gapLimit must be an integer in [1, 200]');
    }
    if (!Number.isInteger(perQueryTimeoutMs)
        || perQueryTimeoutMs < 1
        || perQueryTimeoutMs > MAX_TIMEOUT_MS) {
        throw new Error(`discoverUsedAddresses: perQueryTimeoutMs must be an integer in [1, ${MAX_TIMEOUT_MS}]`);
    }
    if (!Number.isInteger(chainTimeoutMs)
        || chainTimeoutMs < 1
        || chainTimeoutMs > MAX_TIMEOUT_MS) {
        throw new Error(`discoverUsedAddresses: chainTimeoutMs must be an integer in [1, ${MAX_TIMEOUT_MS}]`);
    }
    if (typeof isUsedProbe !== 'function') {
        throw new Error('discoverUsedAddresses: isUsedProbe must be a function');
    }
    if (typeof onProgress !== 'function') {
        throw new Error('discoverUsedAddresses: onProgress must be a function');
    }
    // Require the caller to preserve the wallet's seed derivation format.
    if (format === undefined) {
        throw new Error('discoverUsedAddresses: format is required ("bip39" or "counterwallet-legacy")');
    }
    throwIfAborted(signal);

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
        const validation = validateCounterwalletMnemonic(normalized);
        if (!validation.ok) {
            throw new InvalidMnemonicError('counterwallet-legacy', validation.errors);
        }
        seed = counterwalletMnemonicToSeedBytes(normalized);
    } else {
        throw new Error(`discoverUsedAddresses: unsupported format "${format}"`);
    }

    try {
        throwIfAborted(signal);
        const hdRoot = hdKeyFromSeed(seed);
        const chains = chainIds ?? chainRegistry.supportedChains().map((d) => d.id);

        /** @type {DiscoveredChain[]} */
        const perChain = [];
        let totalUsedFound = 0;

        for (const chainId of chains) {
            throwIfAborted(signal);
            const descriptor = chainRegistry.get(chainId);
            if (!descriptor) {
                throw new Error(`discoverUsedAddresses: unknown chain "${chainId}"`);
            }
            const types = resolveAddressTypes(descriptor, addressTypes, format);
            if (types.length > 1 && indexSpaceSharedAcrossTypes(format)) {
                const shared = await scanSharedTypesSafely({
                    chainId, descriptor, addressTypes: types, format, chainRegistry,
                    sdkRegistry, hdRoot, accountIndex, change, startIndex, gapLimit,
                    perQueryTimeoutMs, chainTimeoutMs, isUsedProbe, onProgress, signal,
                });
                perChain.push(...shared);
                totalUsedFound += countUsed(shared);
                continue;
            }
            for (const addressType of types) {
                let chainResult;
                try {
                    chainResult = await scanChainType({
                        chainId,
                        descriptor,
                        addressType,
                        format,
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
                        signal,
                    });
                } catch (e) {
                    if (signal?.aborted) throw e;
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

async function scanSharedTypesSafely(opts) {
    try {
        return await scanSharedChainTypes(opts);
    } catch (error) {
        if (opts.signal?.aborted) throw error;
        const message = error?.message ? String(error.message) : String(error);
        return opts.addressTypes.map((addressType) => {
            safeCallback(opts.onProgress, {
                phase: 'chain-failed', chainId: opts.chainId, addressType, error: message,
            });
            return {
                chainId: opts.chainId, addressType, addresses: [], highestUsedIndex: -1,
                scannedCount: 0, incomplete: true, error: message,
            };
        });
    }
}

function countUsed(results) {
    return results.reduce((total, result) => (
        total + result.addresses.filter((address) => address.used).length
    ), 0);
}

function resolveAddressTypes(descriptor, addressTypes, format) {
    if (addressTypes === 'default') {
        // A legacy wallet's own default is the address type Counterwallet
        // showed first; scanning the chain's modern default would miss
        // every address the user actually funded.
        return [defaultAddressTypeForFormat(descriptor, format)];
    }
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


function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError(signal);
}

function abortError(signal) {
    if (signal?.reason?.name === 'AbortError') return signal.reason;
    const message = typeof signal?.reason === 'string'
        ? signal.reason
        : 'Address discovery cancelled.';
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
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
