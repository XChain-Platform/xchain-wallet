// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Balance / history read helpers (§10.3 wallet consumers). Thin
// wrappers over `sdk.getBalances` / `sdk.getHistory`, plus a wallet-
// scoped aggregator that groups the caller's persisted addresses by
// chain and fetches in parallel.
//
// The aggregator returns partial results: a fetch error on one address
// does NOT fail the whole operation. The per-address entry surfaces
// `error` instead of `balances`, so UIs can render retry affordances
// for the failing rows.

import { tickerForCoin } from '../registry/coinTicker.js';
import { importedAddressIdsFor } from './_importedAddressIds.js';

// D-6: the explorer `/balances/` endpoint is the XChain TOKEN ledger only; it
// never carries the chain's NATIVE coin (BTC/LTC/DOGE) balance, which lives at
// `/address/` (sourced from the utxo-tracker). The wallet UI (BalanceList /
// HomeTabs) reads `balances.native` and `balances.tokens`, so the aggregator
// below builds BOTH: `native` from `/address/` (getAddress) and `tokens` from
// `/balances/` (getBalances). Without this a funded wallet shows "No coins yet".

// `/address/` returns balances.confirmed as a plain decimal string; convert to
// a base-unit (satoshi) integer string at 8-decimal native scale, BigInt-exact.
function nativeFromAddress(addrResp, nativeTicker) {
    const confirmed = addrResp && addrResp.balances && addrResp.balances.confirmed;
    if (confirmed == null || !nativeTicker) return null;
    const m = /^(\d+)(?:\.(\d+))?$/.exec(String(confirmed).trim());
    if (!m) return null;
    const frac = (m[2] || '').slice(0, 8).padEnd(8, '0');
    const sats = (BigInt(m[1]) * 100000000n + BigInt(frac)).toString();
    return { tick: nativeTicker, quantity: sats, divisibility: 8 };
}

// `/balances/` returns { data: [...token rows], total }. Map the rows to the
// { tick, quantity, divisibility, displayName, imageUrl } shape the UI expects,
// tolerant of column-name variants. A native-only address yields [].
// D-14: the explorer row carries the token's scale as `decimals` (its `amount`
// is already at that scale, i.e. whole units when decimals=0), NOT `divisibility`.
// Read both names and default to 0 (no scaling) when absent, matching the sibling
// flows (listOwnedTokens/tokenInfo). The old hardcoded default of 8 scaled every
// token balance down by 1e8 (99 XCHAIN shown as 0.00000099).
export function tokensFromBalances(balResp) {
    const rows = balResp && Array.isArray(balResp.data) ? balResp.data : [];
    return rows
        .map((r) => ({
            tick: r.tick,
            quantity: String(r.quantity != null ? r.quantity : (r.amount != null ? r.amount : '0')),
            divisibility: Number(r.divisibility ?? r.decimals ?? 0),
            displayName: r.displayName || r.display_name || r.tick,
            imageUrl: r.imageUrl || r.image || null,
        }))
        .filter((t) => t.tick);
}

// D-6: fetch the { native, tokens } shape for ONE address: the TOKEN ledger
// (/balances/) and the NATIVE coin (/address/) together. Both reads run in
// parallel and degrade independently (native survives a token-endpoint hiccup
// and vice versa). Throws only when BOTH reads fail, so the caller can surface
// a single error. Shared by addressBalances (single-address, Send preview +
// Max) and walletBalances (Home aggregator) so the two never diverge.
async function fetchAddressShape({ sdk, address, nativeTicker, opts }) {
    const [balResp, addrResp] = await Promise.all([
        sdk.getBalances(address, opts).catch((e) => (e instanceof Error ? e : new Error(String(e)))),
        sdk.getAddress(address).catch((e) => (e instanceof Error ? e : new Error(String(e)))),
    ]);
    const balOk = !(balResp instanceof Error);
    const addrOk = !(addrResp instanceof Error);
    if (!balOk && !addrOk) {
        throw balResp instanceof Error ? balResp : new Error(String(balResp));
    }
    // D-152: degrading independently is right; degrading SILENTLY is not. A
    // failed token read used to return `tokens: []`, which is byte-identical to
    // "this address holds no tokens" - so a hiccup on one endpoint presented as
    // a confident empty wallet: no rows on Home, and an asset picker that says
    // "Nothing matches" for a token the address is holding. `unavailable` names
    // which half is missing so a surface can say "could not read" instead of
    // "you have none". Nothing reads the field yet except the surfaces that
    // choose to; every existing consumer of `.native` / `.tokens` is unchanged.
    const unavailable = [
        ...(balOk ? [] : ['tokens']),
        ...(addrOk ? [] : ['native']),
    ];
    return {
        native: addrOk ? nativeFromAddress(addrResp, nativeTicker) : null,
        tokens: balOk ? tokensFromBalances(balResp) : [],
        ...(unavailable.length > 0 ? {
            unavailable,
            unavailableReason: String(
                (balOk ? addrResp : balResp)?.message || 'balance read failed',
            ),
        } : {}),
    };
}

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
 * @property {import('../registry/index.js').ChainRegistry} [chainRegistry]  resolves the chain's native ticker; when absent the native side degrades to null
 * @property {string} chainId
 * @property {string} address
 * @property {object} [opts]                  passed through to `sdk.getBalances`
 */

/**
 * Single-address balance read. Returns the `{ native, tokens }` shape the
 * simulator / Send preview / Max button expect (via `balancesFromSdk`), NOT
 * the raw explorer `/balances/` token-ledger list. D-6: the token ledger omits
 * the chain's native coin, which lives at `/address/`; a raw pass-through left
 * the Send form showing "0 BTC available" and disabled Max on a funded wallet.
 *
 * @param {AddressBalancesOpts} params
 * @returns {Promise<unknown>}
 */
export async function addressBalances({ sdkRegistry, chainRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('addressBalances: sdkRegistry is required');
    if (!chainId) throw new Error('addressBalances: chainId is required');
    if (!address) throw new Error('addressBalances: address is required');
    const sdk = sdkRegistry.get(chainId);
    const descriptor = chainRegistry ? chainRegistry.descriptorFor(chainId) : null;
    const nativeTicker = tickerForCoin(descriptor && descriptor.coin);
    return fetchAddressShape({ sdk, address, nativeTicker, opts });
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
 * (`'recent'`, etc.); callers who want those drop to the SDK directly.
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
 * @typedef {Object} IndexerWatermarkResult
 * @property {string} chainId
 * @property {number | null} watermark   latest block index the indexer has
 *                                        processed for this chain, or null when
 *                                        the explorer can't report it
 */

/**
 * Latest indexed block for a chain (§28.3 "Indexed" timeline stage). Reads
 * the explorer's `/status` report and pulls `last_block` for this chain's
 * coin: the highest block index the indexer has processed. The History view
 * compares it against a row's `blockIndex` to decide whether the row's action
 * has been fully indexed vs still being ingested.
 *
 * Never throws for a reachable-but-unhelpful response: a missing field or a
 * status call the SDK doesn't support degrades to `watermark: null` so the
 * timeline falls back to its confirmed-implies-indexed heuristic rather than
 * showing a perpetually-pending row.
 *
 * @param {{ sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry, chainId: string }} params
 * @returns {Promise<IndexerWatermarkResult>}
 */
export async function indexerWatermark({ sdkRegistry, chainId }) {
    if (!sdkRegistry) throw new Error('indexerWatermark: sdkRegistry is required');
    if (!chainId) throw new Error('indexerWatermark: chainId is required');
    const sdk = sdkRegistry.get(chainId);
    if (!sdk || typeof sdk.getStatus !== 'function') {
        return { chainId, watermark: null };
    }
    const status = await sdk.getStatus();
    const lastBlock = status && typeof status === 'object' ? status.last_block : null;
    if (!lastBlock || typeof lastBlock !== 'object') {
        return { chainId, watermark: null };
    }
    // `/status` keys last_block by coin prefix (BTC / RBTC / TDOGE / …).
    // Prefer this chain's own prefix from the explorer client; if it isn't
    // reachable, fall back to the highest processed block across every coin
    // the explorer serves, which is a safe lower bound for our coin.
    const coinPrefix = sdk.explorer && typeof sdk.explorer.coin === 'string'
        ? sdk.explorer.coin
        : null;
    // Guard against null/undefined explicitly: Number(null) is 0, which is
    // finite, so a coin the explorer reports as `null` (status unavailable)
    // must not be mistaken for a watermark of block 0.
    const own = coinPrefix ? lastBlock[coinPrefix] : undefined;
    if (own != null && Number.isFinite(Number(own))) {
        return { chainId, watermark: Number(own) };
    }
    const values = Object.values(lastBlock)
        .filter((v) => v != null)
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n));
    return { chainId, watermark: values.length ? Math.max(...values) : null };
}

/**
 * PC-42: the block time of a chain's latest indexed block.
 *
 * This is the quantity every timestamp-gated protocol change is measured
 * against (the indexer compares a flag-day against the timestamp of the block
 * an action lands in), so it - not the local clock - is what the wallet must
 * consult before offering a field that only activates at a flag day. A wallet
 * whose clock runs fast would otherwise emit just before activation, and the
 * indexer accepts such an action while silently dropping the field.
 *
 * Reads the same `/status` report as `indexerWatermark`, whose `last_block_time`
 * is keyed by coin prefix. Never throws: any gap returns `blockTime: null`,
 * which every caller must treat as "not active" (fail-closed).
 *
 * @param {{ sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry, chainId: string }} params
 * @returns {Promise<{ chainId: string, blockTime: number | null }>}
 */
export async function chainTipBlockTime({ sdkRegistry, chainId }) {
    if (!sdkRegistry) throw new Error('chainTipBlockTime: sdkRegistry is required');
    if (!chainId) throw new Error('chainTipBlockTime: chainId is required');
    let sdk;
    try { sdk = sdkRegistry.get(chainId); } catch { return { chainId, blockTime: null }; }
    if (!sdk || typeof sdk.getStatus !== 'function') return { chainId, blockTime: null };
    let status;
    try { status = await sdk.getStatus(); } catch { return { chainId, blockTime: null }; }
    const times = status && typeof status === 'object' ? status.last_block_time : null;
    if (!times || typeof times !== 'object') return { chainId, blockTime: null };
    const coinPrefix = sdk.explorer && typeof sdk.explorer.coin === 'string'
        ? sdk.explorer.coin
        : null;
    // Only this chain's own coin will do. indexerWatermark can fall back to the
    // max across coins because a higher block index is a safe lower bound for
    // "has been indexed"; here a sibling chain's timestamp would be a claim
    // about a DIFFERENT chain's flag-day progress, so no fallback.
    const own = coinPrefix ? times[coinPrefix] : undefined;
    if (own == null || !Number.isFinite(Number(own))) return { chainId, blockTime: null };
    return { chainId, blockTime: Number(own) };
}

/**
 * @typedef {Object} WalletBalancesOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} [chainId]               optional filter; only fetch for this chain
 * @property {'mainnet' | 'testnet' | 'regtest'} [activeNetwork]  optional filter; skips chains whose `networkKind` doesn't match. The host wrapper threads this from `settings.activeNetwork` so a user on mainnet generates zero requests against testnet / regtest chains
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
    //    belongs to the wallet (silently dropping a mismatch would
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

    // Imported-WIF addresses hang off the WALLET, not an account, so the
    // account filter below cannot see them (D-66). They are included even
    // when the caller scoped to one account - AddressList always passes an
    // accountId, and it is the surface that must show them.
    const importedIds = await importedAddressIdsFor(vault, walletId);

    if (accountIds.size === 0 && importedIds.size === 0) {
        // No accounts and no imported keys for this walletId; nothing to fetch.
        return {};
    }

    // 2. Group this wallet's addresses by chainId (coin + networkKind
    //    → descriptor id). Unknown chains are skipped. When `activeNetwork`
    //    is supplied, chains on a different network are skipped at the
    //    grouping site so no SDK fan-out fires for them; this is the
    //    chokepoint that enforces "switch to mainnet, stop querying
    //    testnet entirely."
    /** @type {Record<string, import('../schemas/address.js').Address[]>} */
    const byChain = {};
    const allAddrs = await vault.addresses.list();
    for (const a of allAddrs) {
        const owned = a.accountId
            ? accountIds.has(a.accountId)
            : importedIds.has(a.id);
        if (!owned) continue;
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
            const descriptor = chainRegistry.descriptorFor(cid);
            const nativeTicker = tickerForCoin(descriptor && descriptor.coin);
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
                    // D-6: fetch the TOKEN ledger (/balances/) and the NATIVE coin
                    // balance (/address/) together (shared with addressBalances via
                    // fetchAddressShape), and hand the UI the { native, tokens } shape
                    // it reads. Either call failing alone still yields a partial result;
                    // only a double failure (the helper throws) surfaces `error`.
                    try {
                        base.balances = await fetchAddressShape({
                            sdk, address: addr.address, nativeTicker, opts,
                        });
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
