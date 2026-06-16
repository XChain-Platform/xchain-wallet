// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Market query flows — §41.2 + §41.3. Passthroughs to the SDK's
// explorer-client methods for the DEX surfaces. Single-chain read-
// only queries; no vault, no signing.
//
// All methods return whatever the explorer returns — the wallet
// renders what's present and tolerates missing fields (indexer
// state varies, especially for newer markets).

/**
 * @typedef {{ sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry, chainId: string }} SdkCtx
 */

/**
 * List all markets on a chain (optionally filtered by a ticker). Used
 * by `MarketsList` to render the "Popular markets" section.
 *
 * @param {SdkCtx & { tick?: string }} params
 */
export async function getMarkets({ sdkRegistry, chainId, tick }) {
    if (!sdkRegistry) throw new Error('getMarkets: sdkRegistry is required');
    if (!chainId) throw new Error('getMarkets: chainId is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getMarkets(tick);
}

/**
 * Fetch the summary for a specific market — last price, 24h change,
 * cumulative depth. Used for watchlist row hydration + the market
 * detail header.
 *
 * @param {SdkCtx & { tick1: string, tick2: string }} params
 */
export async function getMarket({ sdkRegistry, chainId, tick1, tick2 }) {
    if (!sdkRegistry) throw new Error('getMarket: sdkRegistry is required');
    if (!chainId) throw new Error('getMarket: chainId is required');
    if (!tick1) throw new Error('getMarket: tick1 is required');
    if (!tick2) throw new Error('getMarket: tick2 is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getMarket(tick1, tick2);
}

/**
 * Historical fills for a market. Optional `address` filters to the
 * caller's trades (used for the §41.3.6 "My trade history" panel);
 * omitted for the §41.3.3 "Recent trades" feed and the chart.
 *
 * @param {SdkCtx & { tick1: string, tick2: string, address?: string, opts?: object }} params
 */
export async function getMarketHistory({ sdkRegistry, chainId, tick1, tick2, address, opts }) {
    if (!sdkRegistry) throw new Error('getMarketHistory: sdkRegistry is required');
    if (!chainId) throw new Error('getMarketHistory: chainId is required');
    if (!tick1) throw new Error('getMarketHistory: tick1 is required');
    if (!tick2) throw new Error('getMarketHistory: tick2 is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getMarketHistory(tick1, tick2, address, opts);
}

/**
 * Orders for a market (§41.3.2 orderbook + §41.3.5 "My open orders"
 * when `address` is passed).
 *
 * @param {SdkCtx & { tick1: string, tick2: string, address?: string, opts?: object }} params
 */
export async function getMarketOrders({ sdkRegistry, chainId, tick1, tick2, address, opts }) {
    if (!sdkRegistry) throw new Error('getMarketOrders: sdkRegistry is required');
    if (!chainId) throw new Error('getMarketOrders: chainId is required');
    if (!tick1) throw new Error('getMarketOrders: tick1 is required');
    if (!tick2) throw new Error('getMarketOrders: tick2 is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getMarketOrders(tick1, tick2, address, opts);
}

/**
 * Aggregated orderbook snapshot (bids/asks). Available when the
 * explorer exposes the `/orderbook` endpoint; falls through to the
 * explorer client which returns whatever shape the server provides.
 *
 * @param {SdkCtx & { tick1: string, tick2: string }} params
 */
export async function getOrderbook({ sdkRegistry, chainId, tick1, tick2 }) {
    if (!sdkRegistry) throw new Error('getOrderbook: sdkRegistry is required');
    if (!chainId) throw new Error('getOrderbook: chainId is required');
    if (!tick1) throw new Error('getOrderbook: tick1 is required');
    if (!tick2) throw new Error('getOrderbook: tick2 is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getOrderbook(tick1, tick2);
}

/**
 * All orders mentioning a tick on either side (give or get). Used by
 * §40.5 ManageToken's Orders tab: "every open order for my token,
 * regardless of pair".
 *
 * @param {SdkCtx & { tick: string, opts?: object }} params
 */
export async function ordersForToken({ sdkRegistry, chainId, tick, opts }) {
    if (!sdkRegistry) throw new Error('ordersForToken: sdkRegistry is required');
    if (!chainId) throw new Error('ordersForToken: chainId is required');
    if (!tick) throw new Error('ordersForToken: tick is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getOrders(tick, 'token', opts);
}

/**
 * Recent SWAP actions involving a tick on either side. Used by §40.5
 * ManageToken's Swaps tab.
 *
 * @param {SdkCtx & { tick: string, opts?: object }} params
 */
export async function swapsForToken({ sdkRegistry, chainId, tick, opts }) {
    if (!sdkRegistry) throw new Error('swapsForToken: sdkRegistry is required');
    if (!chainId) throw new Error('swapsForToken: chainId is required');
    if (!tick) throw new Error('swapsForToken: tick is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getSwaps(tick, 'token', opts);
}

/**
 * Recent on-chain history for a token — every action that mentions
 * the tick. Powers §40.5 ManageToken's Activity tab.
 *
 * @param {SdkCtx & { tick: string, opts?: object }} params
 */
export async function historyForToken({ sdkRegistry, chainId, tick, opts }) {
    if (!sdkRegistry) throw new Error('historyForToken: sdkRegistry is required');
    if (!chainId) throw new Error('historyForToken: chainId is required');
    if (!tick) throw new Error('historyForToken: tick is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getHistory(tick, 'token', opts);
}

/**
 * Genesis (ISSUE) action for a token — the first issuance row, which
 * carries the creator address, originating block, and tx hash. Used
 * by ManageToken's Genesis sub-section.
 *
 * @param {SdkCtx & { tick: string, opts?: object }} params
 */
export async function genesisForToken({ sdkRegistry, chainId, tick, opts }) {
    if (!sdkRegistry) throw new Error('genesisForToken: sdkRegistry is required');
    if (!chainId) throw new Error('genesisForToken: chainId is required');
    if (!tick) throw new Error('genesisForToken: tick is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getIssues !== 'function') return null;
    const rows = await sdk.getIssues(tick, 'token', opts);
    const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.data) ? rows.data : []);
    return list.length > 0 ? list[list.length - 1] : null;
}

/**
 * Subassets (children) of a token. xchain-explorer's tokens/subtoken
 * filter matches ticks LIKE `${tick}.%`. Returns the raw rows; the
 * renderer normalizes the array vs keyed-object shape.
 *
 * @param {SdkCtx & { tick: string, opts?: object }} params
 */
export async function subtokensForTick({ sdkRegistry, chainId, tick, opts }) {
    if (!sdkRegistry) throw new Error('subtokensForTick: sdkRegistry is required');
    if (!chainId) throw new Error('subtokensForTick: chainId is required');
    if (!tick) throw new Error('subtokensForTick: tick is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getTokens !== 'function') return [];
    return sdk.getTokens(tick, 'subtoken', opts);
}
