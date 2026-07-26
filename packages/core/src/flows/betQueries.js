// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BET read queries (no signing). Thin passthroughs to the SDK's explorer
// bet-read methods (getBetFeeds / getBetFeed / getBets / getOracleStats), which
// read the indexer's bet_feeds / bets tables. Back BetFeedsList (market
// browser), BetFeedDetail (market + pools + place-bet), MyBets and the oracle
// console. Mirrors voteQueries.js.

/**
 * @typedef {Object} BetQueryOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} [query]           the filter value (block / address / source / token / status / feed index)
 * @property {string} [type]            how to interpret `query` (see the SDK method's type enum)
 * @property {object} [opts]            paging opts ({ page, limit, sortorder })
 */

function requireSdk(params, ctx) {
    if (!params?.sdkRegistry) throw new Error(`${ctx}: sdkRegistry is required`);
    if (!params?.chainId) throw new Error(`${ctx}: chainId is required`);
    const sdk = params.sdkRegistry.get(params.chainId);
    if (!sdk) throw new Error(`${ctx}: no SDK for chain ${params.chainId}`);
    return sdk;
}

/**
 * List betting markets, optionally filtered. type ∈ {block, address, source, token, status}.
 * With no query, lists every market on the chain.
 *
 * `status` filters the STORED feed status rather than recomputing a close from
 * the clock, which is what makes a listing agree with the chain's own view of
 * whether a market still takes bets.
 * @param {BetQueryOpts} params
 */
export async function betFeedsForChain({ sdkRegistry, chainId, query, type, opts }) {
    const sdk = requireSdk({ sdkRegistry, chainId }, 'betFeedsForChain');
    if (typeof sdk.getBetFeeds !== 'function') throw new Error('betFeedsForChain: sdk.getBetFeeds is unavailable');
    return sdk.getBetFeeds(query || null, type || null, opts);
}

/**
 * Fetch one market by its id (the creating action_index), with per-outcome pools
 * and the full status timeline attached.
 *
 * The pools this returns are summed over OPEN bets only, which is the same
 * predicate settlement uses, so a projected payout computed from them matches
 * what the chain will actually pay.
 * @param {{ sdkRegistry: object, chainId: string, feedIndex: string | number, opts?: object }} params
 */
export async function betFeedDetail({ sdkRegistry, chainId, feedIndex, opts }) {
    const sdk = requireSdk({ sdkRegistry, chainId }, 'betFeedDetail');
    if (feedIndex === undefined || feedIndex === null) throw new Error('betFeedDetail: feedIndex is required');
    if (typeof sdk.getBetFeed !== 'function') throw new Error('betFeedDetail: sdk.getBetFeed is unavailable');
    return sdk.getBetFeed(feedIndex, opts);
}

/**
 * List placed bets, optionally filtered. type ∈ {block, address, feed, token, status}.
 * `address` is the bettor; `feed` scopes to one market.
 * @param {BetQueryOpts} params
 */
export async function betsForQuery({ sdkRegistry, chainId, query, type, opts }) {
    const sdk = requireSdk({ sdkRegistry, chainId }, 'betsForQuery');
    if (typeof sdk.getBets !== 'function') throw new Error('betsForQuery: sdk.getBets is unavailable');
    return sdk.getBets(query || null, type || null, opts);
}

/**
 * Project what a prospective stake would pay if its outcome won, at the pools as
 * they stand right now.
 *
 * Deliberately delegated to the SDK rather than approximated in the UI:
 * settlement floors in a specific order, and a projection that disagrees with the
 * settled amount in the last decimal place reads to a user as a bug. The number
 * is still only current, not locked: this is a parimutuel market and every later
 * bet moves it.
 * @param {{ sdkRegistry: object, chainId: string, pools: any[], outcome: number|string,
 *           stake: string|number, feePct?: string|number, decimals?: number }} params
 */
export async function projectBetPayout({ sdkRegistry, chainId, pools, outcome, stake, feePct, decimals }) {
    const sdk = requireSdk({ sdkRegistry, chainId }, 'projectBetPayout');
    if (typeof sdk?.betting?.projectPayout !== 'function') {
        throw new Error('projectBetPayout: sdk.betting.projectPayout is unavailable');
    }
    return sdk.betting.projectPayout({
        pools,
        outcome,
        stake,
        ...(feePct !== undefined && feePct !== null && { feePct }),
        ...(decimals !== undefined && decimals !== null && { decimals }),
    });
}

/**
 * Fetch an oracle's track record (markets created, resolved, cancelled, expired).
 *
 * This is the v0 reputation system and it is NOT backed by any stake: the record
 * is per-address and addresses are free to create, so an empty history means
 * unknown rather than safe. Any surface rendering this MUST carry that caveat.
 * @param {{ sdkRegistry: object, chainId: string, address: string, opts?: object }} params
 */
export async function oracleStats({ sdkRegistry, chainId, address, opts }) {
    const sdk = requireSdk({ sdkRegistry, chainId }, 'oracleStats');
    if (!address) throw new Error('oracleStats: address is required');
    if (typeof sdk.getOracleStats !== 'function') throw new Error('oracleStats: sdk.getOracleStats is unavailable');
    return sdk.getOracleStats(address, opts);
}
