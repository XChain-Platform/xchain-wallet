// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// VOTE governance read queries (no signing). Thin passthroughs to the SDK's
// explorer poll-read methods (getPolls / getPoll / getPollResults / getVotes),
// which read the indexer's polls / poll_results / votes tables. Back the
// GovernancePolls (list), PollDetail (definition + live results), and the
// cast-ballot / delegation surfaces. Mirrors stakingQueries.js.

/**
 * @typedef {Object} PollQueryOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} [query]           the filter value (block / tick / status / creator / poll index)
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
 * List governance polls, optionally filtered. type ∈ {block, tick, status, source}.
 * With no query, lists all polls on the chain.
 * @param {PollQueryOpts} params
 */
export async function pollsForChain({ sdkRegistry, chainId, query, type, opts }) {
    const sdk = requireSdk({ sdkRegistry, chainId }, 'pollsForChain');
    if (typeof sdk.getPolls !== 'function') throw new Error('pollsForChain: sdk.getPolls is unavailable');
    return sdk.getPolls(query || null, type || null, opts);
}

/**
 * Fetch a single poll definition + finalization summary by its id (creating action_index).
 * @param {{ sdkRegistry: object, chainId: string, pollIndex: string | number, opts?: object }} params
 */
export async function pollDetail({ sdkRegistry, chainId, pollIndex, opts }) {
    const sdk = requireSdk({ sdkRegistry, chainId }, 'pollDetail');
    if (pollIndex === undefined || pollIndex === null) throw new Error('pollDetail: pollIndex is required');
    if (typeof sdk.getPoll !== 'function') throw new Error('pollDetail: sdk.getPoll is unavailable');
    return sdk.getPoll(pollIndex, opts);
}

/**
 * Fetch the frozen per-option tally for a poll (empty until the poll is finalized).
 * @param {{ sdkRegistry: object, chainId: string, pollIndex: string | number, opts?: object }} params
 */
export async function pollResults({ sdkRegistry, chainId, pollIndex, opts }) {
    const sdk = requireSdk({ sdkRegistry, chainId }, 'pollResults');
    if (pollIndex === undefined || pollIndex === null) throw new Error('pollResults: pollIndex is required');
    if (typeof sdk.getPollResults !== 'function') throw new Error('pollResults: sdk.getPollResults is unavailable');
    return sdk.getPollResults(pollIndex, opts);
}

/**
 * List ballots, optionally filtered. type ∈ {address, poll, block}. Used both to show
 * a poll's live ballots (before finalization) and a voter's own ballots.
 * @param {PollQueryOpts} params
 */
export async function votesForQuery({ sdkRegistry, chainId, query, type, opts }) {
    const sdk = requireSdk({ sdkRegistry, chainId }, 'votesForQuery');
    if (typeof sdk.getVotes !== 'function') throw new Error('votesForQuery: sdk.getVotes is unavailable');
    return sdk.getVotes(query || null, type || null, opts);
}
