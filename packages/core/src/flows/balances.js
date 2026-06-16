// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Balance / history read helpers — §10.3 wallet consumers. Thin
// wrappers over `sdk.getBalances` / `sdk.getHistory`, plus a wallet-
// scoped aggregator that groups the caller's persisted addresses by
// chain and fetches in parallel.
//
// The aggregator returns partial results — a fetch error on one address
// does NOT fail the whole operation. The per-address entry surfaces
// `error` instead of `balances`, so UIs can render retry affordances
// for the failing rows.

/**
 * @typedef {Object} AddressBalancesEntry
 * @property {string} address
 * @property {string} addressType
 * @property {string | null} derivationPath
 * @property {string} label
 * @property {unknown | null} balances        raw SDK response, or null on failure
 * @property {string | null} error            human-readable failure reason, or null on success
 */

/**
 * @typedef {Object} AddressBalancesOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} address
 * @property {object} [opts]                  passed through to `sdk.getBalances`
 */

/**
 * Single-address balance read. Direct pass-through to the SDK.
 *
 * @param {AddressBalancesOpts} params
 * @returns {Promise<unknown>}
 */
export async function addressBalances({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('addressBalances: sdkRegistry is required');
    if (!chainId) throw new Error('addressBalances: chainId is required');
    if (!address) throw new Error('addressBalances: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getBalances(address, opts);
}

/**
 * @typedef {Object} AddressHistoryOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} address
 * @property {object} [opts]                  passed through to `sdk.getHistory`
 */

/**
 * Single-address history read. Defaults `type: 'address'`; the SDK's
 * `/history/{query}/{type}` endpoint also supports other `type`s
 * (`'recent'`, etc.) — callers who want those drop to the SDK directly.
 *
 * @param {AddressHistoryOpts} params
 * @returns {Promise<unknown>}
 */
export async function addressHistory({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('addressHistory: sdkRegistry is required');
    if (!chainId) throw new Error('addressHistory: chainId is required');
    if (!address) throw new Error('addressHistory: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getHistory(address, 'address', opts);
}

/**
 * @typedef {Object} WalletBalancesOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} [chainId]               optional filter — only fetch for this chain
 * @property {'mainnet' | 'testnet' | 'regtest'} [activeNetwork]  optional filter — skip chains whose `networkKind` doesn't match; the host wrapper threads this from `settings.activeNetwork` so a user on mainnet generates zero requests against testnet / regtest chains
 * @property {object} [opts]                  passed through to each `sdk.getBalances`
 */

/**
 * Aggregate balances for every HD / imported address owned by a wallet,
 * grouped by chainId. Fetches are parallelized per chain.
 *
 * Partial results: a fetch failure on one address yields that entry
 * with `balances: null, error: <message>`; other entries are unaffected.
 *
 * @param {WalletBalancesOpts} params
 * @returns {Promise<Record<string, AddressBalancesEntry[]>>}
 */
export async function walletBalances({
    vault,
    walletId,
    accountId,
    chainRegistry,
    sdkRegistry,
    chainId,
    activeNetwork,
    opts,
}) {
    if (!vault) throw new Error('walletBalances: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('walletBalances: walletId is required');
    }
    if (!chainRegistry) throw new Error('walletBalances: chainRegistry is required');
    if (!sdkRegistry) throw new Error('walletBalances: sdkRegistry is required');

    // 1. Resolve which Account ids belong to this wallet. If `accountId`
    //    is supplied, restrict to that one (and validate that it really
    //    belongs to the wallet — silently dropping a mismatch would
    //    return wallet-wide totals when the caller asked for one
    //    account).
    const accounts = await vault.accounts.findBy('walletId', walletId);
    let scopedAccountIds;
    if (typeof accountId === 'string' && accountId.length > 0) {
        if (!accounts.some((a) => a.id === accountId)) {
            throw new Error(`walletBalances: account "${accountId}" does not belong to wallet "${walletId}"`);
        }
        scopedAccountIds = new Set([accountId]);
    } else {
        scopedAccountIds = new Set(accounts.map((a) => a.id));
    }
    const accountIds = scopedAccountIds;
    if (accountIds.size === 0) {
        // No accounts for this walletId — nothing to fetch.
        return {};
    }

    // 2. Group this wallet's addresses by chainId (coin + networkKind
    //    → descriptor id). Unknown chains are skipped. When `activeNetwork`
    //    is supplied, chains on a different network are skipped at the
    //    grouping site so no SDK fan-out fires for them — this is the
    //    chokepoint that enforces "switch to mainnet, stop querying
    //    testnet entirely."
    /** @type {Record<string, import('../schemas/address.js').Address[]>} */
    const byChain = {};
    const allAddrs = await vault.addresses.list();
    for (const a of allAddrs) {
        if (!a.accountId || !accountIds.has(a.accountId)) continue;
        const cid = chainRegistry.chainIdFor(a.chain, a.network);
        if (!cid) continue;
        if (chainId && cid !== chainId) continue;
        if (activeNetwork) {
            const descriptor = chainRegistry.descriptorFor(cid);
            if (!descriptor || descriptor.networkKind !== activeNetwork) continue;
        }
        if (!byChain[cid]) byChain[cid] = [];
        byChain[cid].push(a);
    }

    // 3. Fetch balances per address, in parallel per chain. Per-address
    //    failures are captured as entries with `error` set.
    /** @type {Record<string, AddressBalancesEntry[]>} */
    const result = {};
    await Promise.all(
        Object.entries(byChain).map(async ([cid, addrs]) => {
            const sdk = sdkRegistry.get(cid);
            const entries = await Promise.all(
                addrs.map(async (addr) => {
                    /** @type {AddressBalancesEntry} */
                    const base = {
                        address: addr.address,
                        addressType: addr.addressType,
                        derivationPath: addr.derivationPath,
                        label: addr.label,
                        balances: null,
                        error: null,
                    };
                    try {
                        base.balances = await sdk.getBalances(addr.address, opts);
                    } catch (e) {
                        base.error = e && e.message ? String(e.message) : String(e);
                    }
                    return base;
                }),
            );
            result[cid] = entries;
        }),
    );
    return result;
}
