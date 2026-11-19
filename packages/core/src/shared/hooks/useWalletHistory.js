// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What Home's value chart replays balances and prices tokens from, read in
// batches for every address the wallet holds on each chain it values:
//
//   token history   POST /history, up to 20 addresses a call, one merged page
//                   newest first, each action carrying its per-address
//                   balance effects in base units (every action type counts)
//   coin history    POST /native_history, up to 20 addresses a call, the
//                   UTXO tracker's transactions with each address's net
//   token prices    GET /price_history on the chain's mainnet explorer, every
//                   held token and the coin in one call (50 assets at most)
//
// Reads follow the address batches and the pages, never the addresses, the
// rows or the chart's points: a wallet with 1 to 20 addresses on a chain
// makes one call per route per page, 21 to 40 makes two. Each walk is bounded
// below by the oldest time a chart range needs, and the reads are held per
// wallet, account and network: a later refresh asks only for what is newer
// than the newest change held, and a wider range only for the stretch older
// than the oldest one.
//
// The tracker can still be backfilling an address it was just asked about.
// Until it says the address is complete the chart says history is loading,
// draws what is known (a coin holds flat before its oldest known change), and
// the next refresh reads the coin's history whole again rather than only the
// newer part, since the backfill adds older transactions.

import { useEffect, useMemo, useState } from 'react';
import { defaultRegistry } from '../../registry/index.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { fetchPriceHistory, PRICE_HISTORY_ASSETS_MAX } from '../../flows/priceLookup.js';
import { WALLET_HISTORY_BATCH_MAX, WALLET_HISTORY_PAGE_LIMIT } from '../../flows/walletValueReads.js';
import { DAY_MS, HOUR_MS } from '../utils/portfolioValueHistory.js';

/** Pages one walk reads per address batch before it stops and holds flat. */
export const WALLET_HISTORY_MAX_PAGES = 40;
/** Native rows per address per page. */
export const NATIVE_HISTORY_PAGE_LIMIT = 200;
/** How far back the first load reads: the default 1W range and a margin. */
export const WALLET_HISTORY_DEFAULT_SPAN_MS = 7 * DAY_MS + 2 * HOUR_MS;
/** A held price series is asked for again after this long. */
export const PRICE_HISTORY_TTL_MS = 5 * 60 * 1000;
/** A failed history read is not asked again for this long. */
export const HISTORY_FAILURE_TTL_MS = 5 * 60 * 1000;

/**
 * @typedef {object} ChainState
 * @property {string} addressesKey
 * @property {Map<string, { ms: number, effects: any[] }>} actions
 * @property {Map<string, { ms: number, nets: Record<string, string> }>} txs
 * @property {number | null} tokenSinceMs      the token walks cover back to here
 * @property {number | null} nativeSinceMs     the coin walks cover back to here
 * @property {bigint | null} newestIndex       the newest action_index held
 * @property {number | null} newestHeight
 * @property {number | null} oldestHeight
 * @property {number | null} tokenFailedAt     when the token reads last failed (they rest a TTL)
 * @property {number | null} nativeFailedAt    when the coin reads last failed
 * @property {number | null} reorgCount
 * @property {number | null} historyFromHeight
 * @property {boolean} backfilling
 * @property {number | null} tokenTruncatedAtMs
 * @property {number | null} nativeTruncatedAtMs
 * @property {string | null} error
 */

/** @type {Map<string, any>} */
const scopes = new Map();
/** Price series by `${chainId}|${interval}`, shared by every wallet. */
const priceStore = new Map();

function scopeKey(walletId, accountId, activeNetwork) {
    return `${walletId || ''}|${accountId || ''}|${activeNetwork || ''}`;
}

function emptyChain(addressesKey) {
    return {
        addressesKey,
        actions: new Map(),
        txs: new Map(),
        tokenSinceMs: null,
        nativeSinceMs: null,
        newestIndex: null,
        newestHeight: null,
        oldestHeight: null,
        tokenFailedAt: null,
        nativeFailedAt: null,
        reorgCount: null,
        historyFromHeight: null,
        backfilling: false,
        tokenTruncatedAtMs: null,
        nativeTruncatedAtMs: null,
        error: null,
    };
}

function scopeFor(key) {
    let scope = scopes.get(key);
    if (!scope) {
        scope = {
            chains: new Map(),
            wantedSinceMs: null,
            wantDaily: false,
            running: null,
            again: false,
            pendingRefresh: false,
            loading: false,
            listeners: new Set(),
            version: 0,
            input: null,
        };
        scopes.set(key, scope);
    }
    return scope;
}

function notify(scope) {
    scope.version += 1;
    for (const fn of scope.listeners) fn(scope.version);
}

function chunks(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

function secondsMs(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

function codeOf(err) {
    return typeof err?.code === 'string' ? err.code : '';
}

/**
 * Whether the tracker is still backfilling any of `addresses`. The tracker
 * answers `addresses: { <address>: { history_status, ... } }` with
 * 'complete', 'backfilling', 'not_watched' or 'unavailable'; the same status
 * is also read as one string for the whole answer or a map of strings, and an
 * address matches whatever case the explorer spelled it in.
 *
 * @param {any} answer
 * @param {string[]} addresses
 */
export function nativeBackfilling(answer, addresses) {
    const isBackfilling = (value) => String(value ?? '').toLowerCase() === 'backfilling';
    if (!answer || typeof answer !== 'object') return false;
    if (isBackfilling(answer.history_status) || isBackfilling(answer.sync?.history_status)) return true;
    const wanted = new Set(addresses.map((a) => String(a).toLowerCase()));
    const maps = [answer.addresses, answer.history_status, answer.address_status];
    for (const map of maps) {
        if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
        for (const [address, entry] of Object.entries(map)) {
            if (!wanted.has(address.toLowerCase())) continue;
            if (isBackfilling(entry) || isBackfilling(entry?.history_status)) return true;
        }
    }
    return false;
}

// One /history walk for one batch of addresses, newest page first, merged into
// `chain`. A first or wider read runs down to `sinceMs` (above `untilMs` when
// it extends an earlier one). A refresh runs from the top within the range
// and stops at the first page holding an action it already has: action
// indexes only grow, so every newer action sits above it. (A `since` at the
// newest held action's time could skip a later block stamped earlier, since
// the route resolves `since` by block stamps.) Returns the time the walk
// stopped short at, or null when it reached its end.
async function walkTokenBatch(messaging, chainId, addresses, chain, { sinceMs, untilMs = null, stopAtIndex = null }) {
    let before;
    let oldestMs = null;
    for (let page = 1; ; page += 1) {
        const answer = await messaging.getWalletHistoryBatch({
            chainId,
            addresses,
            before,
            since: Math.floor(sinceMs / 1000),
            until: untilMs === null ? undefined : Math.floor(untilMs / 1000),
            limit: WALLET_HISTORY_PAGE_LIMIT,
        });
        if (!answer || !Array.isArray(answer.actions)) throw new Error('history: unexpected answer');
        let reachedHeld = false;
        for (const action of answer.actions) {
            const index = String(action?.action_index ?? '');
            const ms = secondsMs(action?.timestamp);
            if (!/^\d+$/.test(index) || ms === null) continue;
            if (stopAtIndex !== null && BigInt(index) <= stopAtIndex) reachedHeld = true;
            if (oldestMs === null || ms < oldestMs) oldestMs = ms;
            if (chain.newestIndex === null || BigInt(index) > chain.newestIndex) chain.newestIndex = BigInt(index);
            // An action can reach addresses in two batches: each batch brings
            // the effects on its own addresses.
            const held = chain.actions.get(index);
            const effects = Array.isArray(action.effects) ? action.effects : [];
            if (!held) {
                chain.actions.set(index, { ms, effects: [...effects] });
                continue;
            }
            const seen = new Set(held.effects.map((e) => `${e.address}\u0000${e.tick}`));
            for (const effect of effects) {
                if (!seen.has(`${effect.address}\u0000${effect.tick}`)) held.effects.push(effect);
            }
        }
        if (reachedHeld || !answer.next_cursor) return null;
        if (page >= WALLET_HISTORY_MAX_PAGES) return stopAtIndex === null ? oldestMs : null;
        before = answer.next_cursor;
    }
}

// One /native_history walk for one batch of addresses, merged into `target`.
// The tracker applies time bounds as a filter after its scan, newest first,
// so past `sinceMs` it answers empty pages with a live cursor: the walk stops
// at the first empty page once it has seen rows, or at once when nothing
// bounds it above (`toHeight` bounds an extension by height instead of time,
// so it opens on rows). A moved reorg count or a refused cursor restarts the
// walk once from the first page.
async function walkNativeBatch(messaging, chainId, addresses, target, { sinceMs, untilMs = null, fromHeight = null, toHeight = null }) {
    const boundedAbove = untilMs !== null && toHeight === null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        let cursor;
        let reorgCount = null;
        let oldestMs = null;
        let backfilling = false;
        let historyFromHeight = null;
        let restart = false;
        const found = [];
        try {
            for (let page = 1; ; page += 1) {
                const answer = await messaging.getNativeHistoryBatch({
                    chainId,
                    addresses,
                    cursor,
                    from_time: fromHeight === null ? Math.floor(sinceMs / 1000) : undefined,
                    to_time: boundedAbove ? Math.floor(untilMs / 1000) : undefined,
                    from_height: fromHeight === null ? undefined : fromHeight,
                    to_height: toHeight === null ? undefined : toHeight,
                    limit: NATIVE_HISTORY_PAGE_LIMIT,
                });
                if (!answer || !Array.isArray(answer.transactions)) throw new Error('native history: unexpected answer');
                const count = Number(answer.sync?.reorg_count);
                if (Number.isFinite(count)) {
                    if (reorgCount !== null && count !== reorgCount) { restart = true; break; }
                    reorgCount = count;
                }
                if (Number.isInteger(answer.history_from_height)) {
                    historyFromHeight = Math.max(historyFromHeight ?? 0, answer.history_from_height);
                }
                if (nativeBackfilling(answer, addresses)) backfilling = true;
                for (const tx of answer.transactions) found.push(tx);
                if (!answer.cursor) break;
                if (answer.transactions.length === 0 && (found.length > 0 || !boundedAbove)) break;
                if (page >= WALLET_HISTORY_MAX_PAGES) {
                    for (const tx of found) {
                        const ms = secondsMs(tx?.time);
                        if (ms !== null && (oldestMs === null || ms < oldestMs)) oldestMs = ms;
                    }
                    break;
                }
                cursor = answer.cursor;
            }
        } catch (err) {
            if (codeOf(err) === 'INVALID_CURSOR' || /INVALID_CURSOR/.test(String(err?.message))) { restart = true; } else throw err;
        }
        if (restart) continue;
        for (const tx of found) {
            const txid = typeof tx?.txid === 'string' ? tx.txid : '';
            const ms = secondsMs(tx?.time);
            if (!txid || ms === null) continue;
            const nets = {};
            for (const [address, share] of Object.entries(tx.addresses || {})) {
                if (share && share.net != null) nets[String(address).toLowerCase()] = String(share.net);
            }
            const held = target.txs.get(txid);
            const height = Number(tx.height);
            target.txs.set(txid, { ms, height, nets: held ? { ...held.nets, ...nets } : nets });
            if (Number.isFinite(height)) {
                if (target.newestHeight === null || height > target.newestHeight) target.newestHeight = height;
                if (target.oldestHeight === null || height < target.oldestHeight) target.oldestHeight = height;
            }
        }
        return { reorgCount, truncatedAtMs: oldestMs, backfilling, historyFromHeight };
    }
    throw new Error('native history: the tracker reorganized twice during one read');
}

// Whether a route that failed is still resting: a failed or refused read
// (an explorer without the route, a tracker outage) is not asked again, and
// does not read as loading, until the TTL has passed.
function resting(failedAtMs, nowMs) {
    return failedAtMs !== null && nowMs - failedAtMs < HISTORY_FAILURE_TTL_MS;
}

/** Whether a load would run a first or wider walk for `chain` (the chart says it is loading). */
function needsInitialWalk(chain, wantedSinceMs, nowMs) {
    if (!chain) return true;
    const tokenDue = !resting(chain.tokenFailedAt, nowMs)
        && (chain.tokenSinceMs === null || wantedSinceMs < chain.tokenSinceMs);
    const nativeDue = !resting(chain.nativeFailedAt, nowMs)
        && (chain.nativeSinceMs === null || wantedSinceMs < chain.nativeSinceMs);
    return tokenDue || nativeDue;
}

// The token and coin walks one load needs for one chain, every batch in
// parallel, each batch paged by its own single cursor.
async function loadChain(messaging, chainId, addresses, chain, { wantedSinceMs, refresh, nowMs }) {
    const batches = chunks(addresses, WALLET_HISTORY_BATCH_MAX);
    const tokenWalks = [];
    if (!resting(chain.tokenFailedAt, nowMs)) {
        if (chain.tokenSinceMs === null) {
            tokenWalks.push({ sinceMs: wantedSinceMs });
        } else {
            if (wantedSinceMs < chain.tokenSinceMs) tokenWalks.push({ sinceMs: wantedSinceMs, untilMs: chain.tokenSinceMs });
            if (refresh) tokenWalks.push({ sinceMs: chain.tokenSinceMs, stopAtIndex: chain.newestIndex });
        }
    }
    const nativeWalks = [];
    // A backfill in progress adds older transactions, so the next refresh
    // reads the coin's whole range again.
    const nativeWhole = !resting(chain.nativeFailedAt, nowMs)
        && (chain.nativeSinceMs === null || (refresh && chain.backfilling));
    // A whole read lands in a fresh set, swapped in only when it completes,
    // so the line keeps what it had while the read runs.
    const nativeTarget = nativeWhole ? { txs: new Map(), newestHeight: null, oldestHeight: null } : chain;
    if (nativeWhole) {
        nativeWalks.push({ sinceMs: wantedSinceMs });
    } else if (!resting(chain.nativeFailedAt, nowMs)) {
        if (wantedSinceMs < chain.nativeSinceMs) {
            // Older than the oldest transaction held, bounded by its height
            // (inclusive, merged by txid) when one is held.
            nativeWalks.push(chain.oldestHeight === null
                ? { sinceMs: wantedSinceMs, untilMs: chain.nativeSinceMs }
                : { sinceMs: wantedSinceMs, toHeight: chain.oldestHeight });
        }
        // Only blocks from the newest one held (inclusive, merged by txid).
        if (refresh) {
            nativeWalks.push(chain.newestHeight === null
                ? { sinceMs: chain.nativeSinceMs }
                : { sinceMs: chain.nativeSinceMs, fromHeight: chain.newestHeight });
        }
    }

    const tokenRuns = typeof messaging?.getWalletHistoryBatch === 'function'
        ? tokenWalks.flatMap((walk) => batches.map((batch) => walkTokenBatch(messaging, chainId, batch, chain, walk)))
        : [];
    const nativeRuns = typeof messaging?.getNativeHistoryBatch === 'function'
        ? nativeWalks.flatMap((walk) => batches.map((batch) => walkNativeBatch(messaging, chainId, batch, nativeTarget, walk)))
        : [];
    const [tokens, natives] = await Promise.all([Promise.allSettled(tokenRuns), Promise.allSettled(nativeRuns)]);

    let error = null;
    for (const result of tokens) {
        if (result.status === 'rejected') { error = error || String(result.reason?.message || result.reason); continue; }
        if (result.value !== null) chain.tokenTruncatedAtMs = Math.max(chain.tokenTruncatedAtMs ?? -Infinity, result.value);
    }
    if (tokenRuns.length > 0) {
        if (tokens.every((r) => r.status === 'fulfilled')) {
            chain.tokenSinceMs = Math.min(chain.tokenSinceMs ?? Infinity, wantedSinceMs);
            chain.tokenFailedAt = null;
        } else {
            chain.tokenFailedAt = nowMs;
        }
    }
    let backfilling = false;
    let reorgCount = null;
    for (const result of natives) {
        if (result.status === 'rejected') { error = error || String(result.reason?.message || result.reason); continue; }
        const facts = result.value;
        if (facts.backfilling) backfilling = true;
        if (facts.reorgCount !== null) reorgCount = facts.reorgCount;
        if (facts.historyFromHeight !== null) chain.historyFromHeight = facts.historyFromHeight;
        if (facts.truncatedAtMs !== null) chain.nativeTruncatedAtMs = Math.max(chain.nativeTruncatedAtMs ?? -Infinity, facts.truncatedAtMs);
    }
    if (nativeRuns.length > 0) {
        if (natives.every((r) => r.status === 'fulfilled')) {
            if (nativeWhole) {
                chain.txs = nativeTarget.txs;
                chain.newestHeight = nativeTarget.newestHeight;
                chain.oldestHeight = nativeTarget.oldestHeight;
            }
            chain.nativeSinceMs = Math.min(nativeWhole ? Infinity : (chain.nativeSinceMs ?? Infinity), wantedSinceMs);
            chain.backfilling = backfilling;
            chain.nativeFailedAt = null;
            // A reorg since the last read: the next refresh starts the coin over.
            if (reorgCount !== null && chain.reorgCount !== null && reorgCount !== chain.reorgCount) chain.nativeSinceMs = null;
            if (reorgCount !== null) chain.reorgCount = reorgCount;
        } else {
            chain.nativeFailedAt = nowMs;
        }
    }
    chain.error = error;
}

// Token prices for one chain and interval: the held tokens and the coin in
// calls of at most 50 assets, kept for PRICE_HISTORY_TTL_MS.
async function loadPrices(chainId, ticks, interval, sinceMs, nowMs) {
    const descriptor = defaultRegistry().get(chainId);
    if (!descriptor || descriptor.networkKind !== 'mainnet' || ticks.length === 0) return;
    const key = `${chainId}|${interval}`;
    const held = priceStore.get(key);
    const wanted = new Set(ticks.map((t) => String(t).toUpperCase()));
    // The hourly series always spans the hourly ranges (24h, 1W); the daily
    // one reaches back as far as the widest range asked for.
    const needSinceMs = interval === 'hour' ? nowMs - WALLET_HISTORY_DEFAULT_SPAN_MS : sinceMs;
    const covered = held
        && nowMs - held.fetchedAt < PRICE_HISTORY_TTL_MS
        && held.sinceMs <= needSinceMs + HOUR_MS
        && [...wanted].every((t) => held.asked.has(t));
    if (covered) return;
    const coinTick = tickerForCoin(descriptor.coin);
    const tokens = [...wanted].filter((t) => t !== coinTick.toUpperCase());
    const from = Math.floor(needSinceMs / 1000);
    const byTick = new Map();
    let coinOracle = null;
    // The coin rides in every call, so each call carries the oracle series
    // its DEX prices convert through.
    for (const group of chunks(tokens, PRICE_HISTORY_ASSETS_MAX - 1)) {
        let answer = null;
        try {
            answer = await fetchPriceHistory({ chainCoin: descriptor.coin, assets: [coinTick, ...group], interval, from });
        } catch {
            // A refused or failed read is held as no series for the same TTL,
            // so the tokens read as having no price history instead of being
            // asked for again on every update.
        }
        if (!answer) continue;
        for (const series of answer.series) {
            const points = series.points
                .map((p) => [Number(p.t) * 1000, Number(p.price)])
                .filter(([ms, price]) => Number.isFinite(ms) && Number.isFinite(price) && price > 0)
                .sort((a, b) => a[0] - b[0]);
            const tick = String(series.asset).toUpperCase();
            if (tick === coinTick.toUpperCase()) {
                if (series.source === 'oracle' && !coinOracle) coinOracle = points;
                continue;
            }
            if (!byTick.has(tick)) byTick.set(tick, { oracle: null, dex: null });
            byTick.get(tick)[series.source === 'oracle' ? 'oracle' : 'dex'] = points;
        }
    }
    priceStore.set(key, { fetchedAt: nowMs, sinceMs: needSinceMs, asked: wanted, byTick, coinOracle });
}

async function runLoad(scope, { refresh }) {
    const input = scope.input;
    if (!input) return;
    const { messaging, chains, tokenTicksByChain } = input;
    const nowMs = Date.now();
    const wantedSinceMs = Math.min(scope.wantedSinceMs ?? Infinity, nowMs - WALLET_HISTORY_DEFAULT_SPAN_MS);
    const firstLoad = [...chains.keys()].some((chainId) => needsInitialWalk(scope.chains.get(chainId), wantedSinceMs, nowMs));
    if (firstLoad) {
        scope.loading = true;
        notify(scope);
    }
    const work = [];
    for (const [chainId, addresses] of chains) {
        const addressesKey = [...addresses].sort().join(',');
        let chain = scope.chains.get(chainId);
        if (!chain || chain.addressesKey !== addressesKey) {
            chain = emptyChain(addressesKey);
            scope.chains.set(chainId, chain);
        }
        work.push(loadChain(messaging, chainId, addresses, chain, { wantedSinceMs, refresh, nowMs }));
        const ticks = tokenTicksByChain.get(chainId) || [];
        work.push(loadPrices(chainId, ticks, 'hour', wantedSinceMs, nowMs).catch(() => {}));
        if (scope.wantDaily) work.push(loadPrices(chainId, ticks, 'day', wantedSinceMs, nowMs).catch(() => {}));
    }
    await Promise.allSettled(work);
    scope.loading = false;
    notify(scope);
}

function schedule(scope, { refresh = false } = {}) {
    if (refresh) scope.pendingRefresh = true;
    if (scope.running) {
        scope.again = true;
        return scope.running;
    }
    scope.running = (async () => {
        do {
            scope.again = false;
            const doRefresh = scope.pendingRefresh;
            scope.pendingRefresh = false;
            await runLoad(scope, { refresh: doRefresh });
        } while (scope.again);
        scope.running = null;
    })();
    return scope.running;
}

/** Drops every held scope and price series (lock, wallet removal, tests). */
export function clearWalletHistoryStore() {
    scopes.clear();
    priceStore.clear();
}

/**
 * The wallet's batch history reads for its value chart.
 *
 * @param {object} args
 * @param {string | null | undefined} args.walletId
 * @param {string | null | undefined} [args.accountId]
 * @param {string | null | undefined} args.activeNetwork
 * @param {any} args.messaging
 * @param {Record<string, string[]> | null | undefined} args.addressesByChain  every address the wallet holds per chain
 * @param {string[]} [args.chainIds]                    the chains the chart values (others are not read)
 * @param {Record<string, string[]>} [args.tokenTicksByChain]  the valued tokens per chain, priced from /price_history
 * @param {unknown} [args.refreshKey]                   a new key reads what is newer (Home passes the balances' fetch time)
 * @param {boolean} [args.enabled]
 */
export function useWalletHistory({
    walletId,
    accountId = null,
    activeNetwork,
    messaging,
    addressesByChain = null,
    chainIds = [],
    tokenTicksByChain = {},
    refreshKey = null,
    enabled = true,
}) {
    const key = enabled && walletId && activeNetwork ? scopeKey(walletId, accountId, activeNetwork) : null;
    const chainsKey = useMemo(() => {
        if (!key) return '';
        return [...new Set(chainIds || [])].sort().map((chainId) => {
            const addresses = [...new Set((addressesByChain?.[chainId] || [])
                .map((a) => String(typeof a === 'string' ? a : a?.address || '').trim())
                .filter(Boolean))].sort();
            const ticks = [...new Set((tokenTicksByChain?.[chainId] || []).map((t) => String(t).toUpperCase()))].sort();
            return `${chainId}=${addresses.join(',')}~${ticks.join(',')}`;
        }).join(';');
    }, [key, chainIds, addressesByChain, tokenTicksByChain]);
    const [, setVersion] = useState(0);

    useEffect(() => {
        if (!key) return undefined;
        const scope = scopeFor(key);
        scope.listeners.add(setVersion);
        return () => { scope.listeners.delete(setVersion); };
    }, [key]);

    useEffect(() => {
        if (!key || !chainsKey) return;
        const scope = scopeFor(key);
        const chains = new Map();
        const tokenTicks = new Map();
        for (const part of chainsKey.split(';')) {
            const [chainId, rest] = part.split('=');
            const [addressList, tickList] = rest.split('~');
            const addresses = addressList ? addressList.split(',') : [];
            if (addresses.length === 0) continue;
            chains.set(chainId, addresses);
            tokenTicks.set(chainId, tickList ? tickList.split(',') : []);
        }
        const isRefresh = scope.input !== null && scope.input.refreshKey !== refreshKey;
        scope.input = { messaging, chains, tokenTicksByChain: tokenTicks, refreshKey };
        void schedule(scope, { refresh: isRefresh });
    }, [key, chainsKey, refreshKey, messaging]);

    const scope = key ? scopes.get(key) : null;
    const version = scope?.version ?? 0;
    return useMemo(() => {
        if (!key || !scope) {
            return { reads: null, addressesByChain: null, loading: false, backfilling: false, tokenPrices: null, requestRange: null };
        }
        const reads = new Map();
        let backfilling = false;
        for (const [chainId, chain] of scope.chains) {
            reads.set(chainId, {
                actions: chain.actions,
                txs: chain.txs,
                tokenTruncatedAtMs: chain.tokenTruncatedAtMs,
                nativeTruncatedAtMs: chain.nativeTruncatedAtMs,
                historyFromHeight: chain.historyFromHeight,
            });
            if (chain.backfilling) backfilling = true;
        }
        const tokenPrices = new Map();
        for (const chainId of scope.chains.keys()) {
            for (const interval of ['hour', 'day']) {
                const held = priceStore.get(`${chainId}|${interval}`);
                if (held) tokenPrices.set(`${chainId}|${interval}`, held);
            }
        }
        /**
         * A chart range asks for its own span: older history and, for a daily
         * range, the daily price series. Safe to call while rendering: the
         * read starts after the current task and lands as a later update.
         *
         * @param {{ source: 'hourly' | 'daily', sinceMs: number }} want
         */
        const requestRange = ({ source, sinceMs } = /** @type {any} */ ({})) => {
            const since = Number.isFinite(sinceMs) ? Math.max(0, sinceMs) : null;
            const widens = since !== null && (scope.wantedSinceMs === null || since < scope.wantedSinceMs);
            const daily = source === 'daily' && !scope.wantDaily;
            if (!widens && !daily) return;
            if (widens) scope.wantedSinceMs = since;
            if (daily) scope.wantDaily = true;
            Promise.resolve().then(() => schedule(scope));
        };
        return {
            reads,
            addressesByChain: addressesByChain || null,
            loading: scope.loading,
            backfilling,
            tokenPrices,
            requestRange,
        };
        // `version` stands for every change to the held reads.
    }, [key, scope, version, addressesByChain]); // eslint-disable-line react-hooks/exhaustive-deps
}
