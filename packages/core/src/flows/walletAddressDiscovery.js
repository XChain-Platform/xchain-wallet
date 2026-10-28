// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Used-address discovery for a restored wallet (§15.4).
//
// A restore writes address 0 per chain. Funds an older install received at a
// later receive index, or that a send returned to a change index, sit at keys
// the wallet holds but has not written down, so the balance reads short. This
// flow walks the receive (0) and change (1) branches of every account on each
// chain the wallet already uses, at the address types the wallet already holds
// there, and writes every used address it finds as an ordinary address record.
//
// Derivation goes through the wallet's own unlocked signer, so the paths are
// exactly the ones the wallet derives for receive and change addresses (BIP39
// purpose paths, or m/0'/C/I for a FreeWallet wallet). Nothing is derived
// anywhere else.
//
// Usage is read through the explorer's batch route: one request answers 20
// addresses with their token ledger and their native-coin figures. An explorer
// without the route is read per address, in order, through the same SDK whose
// network policy applies the shared rate limiter. A reply the flow does not
// recognise stops that chain's scan as failed: counting it as unused would
// close the gap early and leave funds hidden behind a "done".

import { createAddress } from '../schemas/address.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import {
    BALANCES_BATCH_MAX_ADDRESSES,
    BATCH_FEATURE_BALANCES,
    isBatchShape,
    isBatchUnsupported,
    isBatchUnsupportedError,
    rememberBatchUnsupported,
} from './balances.js';
import { branchOf } from './changeAddress.js';

/** BIP44 standard gap limit: this many unused addresses in a row end a branch. */
export const DISCOVERY_GAP_LIMIT = 20;

/**
 * Longest wait for one window's usage read. An explorer that never answers
 * (a blocked host, a transport stuck in backoff) fails the chain with the
 * retry message instead of leaving the check running forever.
 */
export const DISCOVERY_READ_TIMEOUT_MS = 30000;

const RECEIVE_BRANCH = 0;
const CHANGE_BRANCH = 1;
const HD_SOURCES = new Set(['hd', 'trezor', 'ledger']);

/** An explorer answer the flow cannot read as used or unused. */
export class UnrecognizedExplorerReplyError extends Error {
    constructor(address, reason) {
        super(`Explorer reply for ${address} is not readable: ${reason}`);
        this.name = 'UnrecognizedExplorerReplyError';
        this.address = address;
    }
}

function isAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0;
    return typeof value === 'string' && /^\+?\d+(?:\.\d+)?$/.test(value.trim());
}

function isPositiveAmount(value) {
    if (value === null || value === undefined) return false;
    return Number(value) > 0;
}

/**
 * Has this address been used, from its `/balances/` (token ledger) and
 * `/address/` (native coin) bodies? Throws UnrecognizedExplorerReplyError for
 * any body it cannot read, including a native figure the explorer could not
 * source (`tracker_available: false`): an address whose coin history is
 * unknown is not an unused address.
 *
 * @param {string} address
 * @param {{ balResp: unknown, addrResp: unknown }} reads
 * @returns {boolean}
 */
export function addressUsedFromReads(address, { balResp, addrResp }) {
    if (!addrResp || typeof addrResp !== 'object' || Array.isArray(addrResp)) {
        throw new UnrecognizedExplorerReplyError(address, 'no address body');
    }
    if (addrResp.tracker_available !== true) {
        throw new UnrecognizedExplorerReplyError(address, 'coin balance unavailable');
    }
    const balances = addrResp.balances;
    if (!balances || typeof balances !== 'object' || !isAmount(balances.confirmed)) {
        throw new UnrecognizedExplorerReplyError(address, 'no coin balance');
    }
    for (const field of ['pending', 'received']) {
        if (balances[field] != null && !isAmount(balances[field])) {
            throw new UnrecognizedExplorerReplyError(address, `unreadable ${field} figure`);
        }
    }
    if (!balResp || typeof balResp !== 'object' || !Array.isArray(balResp.data)) {
        throw new UnrecognizedExplorerReplyError(address, 'no token ledger');
    }
    const utxos = addrResp.utxos && typeof addrResp.utxos === 'object' ? addrResp.utxos : {};
    return isPositiveAmount(balances.received)
        || isPositiveAmount(balances.confirmed)
        || isPositiveAmount(balances.pending)
        || isPositiveAmount(utxos.confirmed)
        || isPositiveAmount(utxos.pending)
        || balResp.data.length > 0;
}

function asError(e) {
    return e instanceof Error ? e : new Error(String(e));
}

async function perAddressUsage(sdk, addresses) {
    const used = [];
    // In order, one address at a time: the SDK's network policy spaces these
    // under the shared explorer budget, and a failure stops the walk at once.
    for (const address of addresses) {
        const balResp = await sdk.getBalances(address);
        const addrResp = await sdk.getAddress(address);
        used.push(addressUsedFromReads(address, { balResp, addrResp }));
    }
    return used;
}

/**
 * Used or unused for each address, in order. Throws on any failure or any
 * reply it cannot read.
 *
 * @param {any} sdk
 * @param {string[]} addresses   at most BALANCES_BATCH_MAX_ADDRESSES
 * @returns {Promise<boolean[]>}
 */
export async function readAddressUsage(sdk, addresses) {
    if (!sdk) throw new Error('readAddressUsage: no explorer for this chain');
    const canBatch = typeof sdk.getBalancesBatch === 'function'
        && !isBatchUnsupported(sdk, BATCH_FEATURE_BALANCES);
    if (!canBatch) return perAddressUsage(sdk, addresses);
    let resp;
    try {
        resp = await sdk.getBalancesBatch(addresses);
    } catch (e) {
        if (!isBatchUnsupportedError(e)) throw asError(e);
        rememberBatchUnsupported(sdk, BATCH_FEATURE_BALANCES);
        return perAddressUsage(sdk, addresses);
    }
    if (!isBatchShape(resp, addresses[0])) {
        rememberBatchUnsupported(sdk, BATCH_FEATURE_BALANCES);
        return perAddressUsage(sdk, addresses);
    }
    return addresses.map((address) => {
        const entry = resp[address];
        if (!entry || typeof entry !== 'object') {
            throw new UnrecognizedExplorerReplyError(address, 'missing from the batch reply');
        }
        if (entry.error) {
            const err = new Error(String(entry.error?.error || entry.error));
            if (typeof entry.error?.code === 'string') err.code = entry.error.code;
            throw err;
        }
        return addressUsedFromReads(address, { balResp: entry.balances, addrResp: entry.address });
    });
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const err = new Error('Address discovery cancelled.');
    err.name = 'AbortError';
    throw err;
}

/**
 * @typedef {Object} DiscoveryChainResult
 * @property {string} chainId
 * @property {'complete' | 'failed'} status
 * @property {number} found        new address records written on this chain
 * @property {string | null} error
 */

/**
 * @typedef {Object} DiscoverWalletAddressesOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {import('../signers/Signer.js').Signer} signer    the wallet's unlocked software signer
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {'mainnet' | 'testnet' | 'regtest'} [activeNetwork]  only chains on this network are read
 * @property {number} [gapLimit]                default {@link DISCOVERY_GAP_LIMIT}
 * @property {number} [readTimeoutMs]           default {@link DISCOVERY_READ_TIMEOUT_MS}
 * @property {(event: { phase: 'chain-start' | 'chain-complete' | 'chain-failed', chainId: string, found?: number, error?: string }) => void} [onProgress]
 * @property {AbortSignal} [signal]
 */

/**
 * Scan the wallet's chains for used addresses and write each one found.
 *
 * @param {DiscoverWalletAddressesOpts} opts
 * @returns {Promise<{ found: number, chains: DiscoveryChainResult[] }>}
 */
export async function discoverWalletAddresses({
    vault,
    walletId,
    signer,
    chainRegistry,
    sdkRegistry,
    activeNetwork,
    gapLimit = DISCOVERY_GAP_LIMIT,
    readTimeoutMs = DISCOVERY_READ_TIMEOUT_MS,
    onProgress = () => {},
    signal,
}) {
    if (!vault) throw new Error('discoverWalletAddresses: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('discoverWalletAddresses: walletId is required');
    }
    if (!signer || typeof signer.getAddresses !== 'function') {
        throw new Error('discoverWalletAddresses: an unlocked signer is required');
    }
    if (!chainRegistry) throw new Error('discoverWalletAddresses: chainRegistry is required');
    if (!sdkRegistry) throw new Error('discoverWalletAddresses: sdkRegistry is required');
    if (!Number.isInteger(gapLimit) || gapLimit < 1 || gapLimit > 200) {
        throw new Error('discoverWalletAddresses: gapLimit must be an integer in [1, 200]');
    }
    if (!Number.isInteger(readTimeoutMs) || readTimeoutMs < 1) {
        throw new Error('discoverWalletAddresses: readTimeoutMs must be a positive integer');
    }

    const plan = await discoveryPlan({ vault, walletId, chainRegistry, activeNetwork });
    if (!plan) return { found: 0, chains: [] };
    const { scopes, knownAddresses, changeCounts, accountById } = plan;

    /** @type {DiscoveryChainResult[]} */
    const chains = [];
    let found = 0;
    for (const [chainId, byAccount] of scopes) {
        throwIfAborted(signal);
        const descriptor = chainRegistry.descriptorFor(chainId);
        const sdk = sdkRegistry.get(chainId);
        const ticker = tickerForCoin(descriptor.coin);
        let chainFound = 0;
        safeCallback(onProgress, { phase: 'chain-start', chainId });
        try {
            for (const [accountId, types] of byAccount) {
                const account = accountById.get(accountId);
                for (const addressType of types) {
                    for (const branch of [RECEIVE_BRANCH, CHANGE_BRANCH]) {
                        const records = await scanBranch({
                            chainId, account, addressType, branch, signer, sdk,
                            gapLimit, readTimeoutMs, knownAddresses, signal,
                        });
                        for (const derived of records) {
                            const countKey = `${chainId}|${account.id}`;
                            let label;
                            if (branch === CHANGE_BRANCH) {
                                const n = (changeCounts.get(countKey) ?? 0) + 1;
                                changeCounts.set(countKey, n);
                                label = `${ticker} Change #${n}`;
                            } else {
                                label = `${ticker} Address #${derived.index + 1}`;
                            }
                            await vault.addresses.put(createAddress({
                                accountId: account.id,
                                chain: descriptor.coin,
                                network: descriptor.networkKind,
                                source: signer.kind === 'software' ? 'hd' : signer.kind,
                                addressType,
                                derivationPath: derived.path,
                                address: derived.address,
                                publicKey: derived.publicKey,
                                label,
                                ...(branch === CHANGE_BRANCH ? { role: 'change' } : {}),
                                signerId: signer.id,
                            }));
                            knownAddresses.add(`${chainId}|${derived.address}`);
                            chainFound += 1;
                        }
                    }
                }
            }
            found += chainFound;
            chains.push({ chainId, status: 'complete', found: chainFound, error: null });
            safeCallback(onProgress, { phase: 'chain-complete', chainId, found: chainFound });
        } catch (e) {
            if (e?.name === 'AbortError') throw e;
            const error = e?.message ? String(e.message) : String(e);
            found += chainFound;
            chains.push({ chainId, status: 'failed', found: chainFound, error });
            safeCallback(onProgress, { phase: 'chain-failed', chainId, found: chainFound, error });
        }
    }
    return { found, chains };
}

/**
 * The chains, accounts and address types a scan of this wallet reads, or null
 * for a wallet that is never scanned. A demo wallet's addresses never go to an
 * explorer, and an imported-key wallet has no branches to walk.
 */
async function discoveryPlan({ vault, walletId, chainRegistry, activeNetwork }) {
    const wallet = await vault.wallets.get(walletId);
    if (!wallet || wallet.origin === 'demo' || wallet.format === 'wif-only') return null;
    const accounts = await vault.accounts.findBy('walletId', walletId);
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    // Every chain, account and address type the wallet already derives on.
    const scopes = new Map();
    const knownAddresses = new Set();
    const changeCounts = new Map();
    for (const a of await vault.addresses.list()) {
        const account = a.accountId ? accountById.get(a.accountId) : null;
        if (!account || !HD_SOURCES.has(a.source)) continue;
        const chainId = chainRegistry.chainIdFor(a.chain, a.network);
        if (!chainId) continue;
        const descriptor = chainRegistry.descriptorFor(chainId);
        if (!descriptor) continue;
        if (activeNetwork && descriptor.networkKind !== activeNetwork) continue;
        knownAddresses.add(`${chainId}|${a.address}`);
        const parsed = branchOf(a.derivationPath);
        if (parsed?.branch === String(CHANGE_BRANCH)) {
            const key = `${chainId}|${account.id}`;
            changeCounts.set(key, (changeCounts.get(key) ?? 0) + 1);
        }
        if (!descriptor.addressTypes.includes(a.addressType)) continue;
        if (!scopes.has(chainId)) scopes.set(chainId, new Map());
        const byAccount = scopes.get(chainId);
        if (!byAccount.has(account.id)) byAccount.set(account.id, new Set());
        byAccount.get(account.id).add(a.addressType);
    }
    return { scopes, knownAddresses, changeCounts, accountById };
}

/**
 * The chain ids a scan of this wallet reads, in scan order.
 *
 * @param {{ vault: any, walletId: string, chainRegistry: any, activeNetwork?: string }} opts
 * @returns {Promise<string[]>}
 */
export async function discoveryChainIds(opts) {
    const plan = await discoveryPlan(opts);
    return plan ? [...plan.scopes.keys()] : [];
}

// Walk one branch in windows of 20 until `gapLimit` addresses in a row are
// neither used on chain nor already held. Returns the used addresses the
// wallet does not hold yet, in index order.
async function scanBranch({
    chainId, account, addressType, branch, signer, sdk, gapLimit, readTimeoutMs, knownAddresses, signal,
}) {
    const fresh = [];
    let unusedRun = 0;
    for (let start = 0; unusedRun < gapLimit; start += BALANCES_BATCH_MAX_ADDRESSES) {
        throwIfAborted(signal);
        const derived = await signer.getAddresses({
            chainId,
            accountIndex: account.index,
            change: branch,
            startIndex: start,
            count: BALANCES_BATCH_MAX_ADDRESSES,
            addressType,
        });
        if (!Array.isArray(derived) || derived.length !== BALANCES_BATCH_MAX_ADDRESSES) {
            throw new Error('The signer did not derive the requested addresses.');
        }
        for (const d of derived) {
            // A signer that answered on another branch would write a receive
            // address as change or the reverse.
            const parsed = branchOf(d?.path);
            if (!d?.address || !d?.publicKey || !parsed || parsed.branch !== String(branch)) {
                throw new Error('The signer derived an address outside the requested branch.');
            }
        }
        const used = await withTimeout(
            readAddressUsage(sdk, derived.map((d) => d.address)),
            readTimeoutMs,
        );
        throwIfAborted(signal);
        for (let i = 0; i < derived.length && unusedRun < gapLimit; i++) {
            const held = knownAddresses.has(`${chainId}|${derived[i].address}`);
            if (used[i] || held) {
                unusedRun = 0;
                if (used[i] && !held) fresh.push(derived[i]);
            } else {
                unusedRun += 1;
            }
        }
    }
    return fresh;
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`The explorer did not answer within ${Math.round(ms / 1000)} seconds.`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function safeCallback(fn, event) {
    if (typeof fn !== 'function') return;
    try { fn(event); } catch { /* a progress listener never stops the scan */ }
}
