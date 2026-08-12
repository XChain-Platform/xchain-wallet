// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// protocolActivations (PC-29): the wallet's single source of truth for
// flag-day protocol extensions it must not emit (or honor) before their
// activation height.
//
// GATE_MIN_AMOUNT is a DECIDED protocol extension (operator, 2026-07-24;
// wallet coverage spec §5 PC-29): an optional
// unlock-threshold field appended to FILE format 0's tail, plus a SEND
// rule change (the paired key-handoff MESSAGE is required only when the
// destination's post-send balance of the gate tick meets the threshold;
// below it a plain SEND is valid and carries no key).
//
// TESTNET is active from genesis (operator, 2026-08-10): the fresh
// testnet genesis reseeds all three testnet chains from a new XChain
// start height with every feature live from block 0, so there is no
// pre-extension testnet history for a flag-day to protect and the
// indexer/encoder/SDK legs it round-trips against all ship PC-29
// ungated at HEAD. Height 0 is the active-from-genesis idiom already
// used across xchain-indexer/src/stateHash.js. That decision retires
// the coordinated train for testnet only.
//
// MAINNET and REGTEST stay null. Mainnet has real pre-extension history
// and still needs a pinned coordinated height. Regtest stays null
// because the live regtest stack runs pre-train services, so early
// emission breaks round-trips there exactly like on mainnet.
//
// Filling a mainnet height is what turns the extension on for that
// chain: forms start offering the threshold field, the publish flow
// starts emitting the ninth FILE field, and the send guard starts
// honoring the below-threshold plain-SEND lane, each strictly at/after
// the height on its chain. This map is the ONLY protection on the
// publish side: the wire format is trailing-tolerant end to end
// (verified 2026-07-25: the SDK validator drops unknown positional
// fields and the indexer's setActionParams iterates only the format's
// fields), so a premature ninth field would NOT be rejected - it would
// publish successfully with the threshold silently dropped,
// PERMANENTLY, since a FILE is immutable. On the send side, honoring
// the lane early composes plain SENDs an unupgraded indexer rejects.
// A smoke test pins the mainnet and regtest entries null so a height
// cannot land on them outside a real activation decision.

/**
 * chainId -> GATE_MIN_AMOUNT activation block height. 0 means active
 * from genesis; null means unscheduled and the extension stays inert.
 */
export const GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS = Object.freeze({
    'bitcoin-mainnet': null,
    'bitcoin-testnet': 0,
    'bitcoin-regtest': null,
    'litecoin-mainnet': null,
    'litecoin-testnet': 0,
    'litecoin-regtest': null,
    'dogecoin-mainnet': null,
    'dogecoin-testnet': 0,
    'dogecoin-regtest': null,
});

/**
 * The scheduled activation height for a chain, or null when none is
 * scheduled (unknown chains count as unscheduled).
 *
 * @param {string} chainId
 * @param {Record<string, number | null>} [heights]  test override
 * @returns {number | null}
 */
export function gateMinAmountScheduledHeight(chainId, heights = GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS) {
    const h = heights ? heights[chainId] : null;
    return Number.isFinite(h) ? Number(h) : null;
}

/**
 * Synchronous check against a known block height. Activation is
 * inclusive: the extension is live AT the pinned height.
 *
 * @param {{ chainId: string, blockHeight: number | null | undefined,
 *           heights?: Record<string, number | null> }} params
 * @returns {boolean}
 */
export function isGateMinAmountActive({ chainId, blockHeight, heights }) {
    const scheduled = gateMinAmountScheduledHeight(chainId, heights);
    if (scheduled === null) return false;
    return Number.isFinite(blockHeight) && Number(blockHeight) >= scheduled;
}

/**
 * Async check for flows that must fetch the chain tip themselves.
 * `getBlockHeight` is only invoked when a height is actually scheduled,
 * so the pre-train fast path (every chain today) costs no network call.
 * A failed/garbage height reads as NOT active: the fail-closed
 * direction for an emission gate (never emit a field the network might
 * not accept yet).
 *
 * @param {{ chainId: string,
 *           getBlockHeight: () => Promise<number | null>,
 *           heights?: Record<string, number | null> }} params
 * @returns {Promise<boolean>}
 */
export async function resolveGateMinAmountActive({ chainId, getBlockHeight, heights }) {
    const scheduled = gateMinAmountScheduledHeight(chainId, heights);
    if (scheduled === null) return false;
    let height = null;
    try { height = await getBlockHeight(); } catch (_e) { return false; }
    return Number.isFinite(height) && Number(height) >= scheduled;
}

// ---------------------------------------------------------------------------
// PC-42: the two binding-poll flag-days.
//
// Unlike GATE_MIN_AMOUNT above, these are NOT waiting on the train and
// are NOT block heights. Both are already scheduled in the indexer
// (xchain-indexer/src/protocol_changes.js) as BLOCK-TIMESTAMP gates, with real
// values: mainnet 1786060800 (2026-08-07), testnet and regtest 0, i.e. live
// from genesis so the regtest stack exercises the rules today.
//
// The comparison must be against the CHAIN's block time, never the local
// clock: the indexer gates on the block timestamp of the block the action
// lands in, and a wallet whose clock runs fast would otherwise emit just
// before activation. The explorer's `/status` reports `last_block_time` per
// coin, which is the same quantity, so `chainTipBlockTime` (flows/balances.js)
// is the intended source.
// ---------------------------------------------------------------------------

/** Shared schedule; the two changes activate together but are independent
 *  protocol changes, so each gets its own map to keep a future divergence a
 *  one-line edit rather than a refactor. */
const VOTE_FLAG_DAY_TIMES = {
    'bitcoin-mainnet': 1786060800,
    'bitcoin-testnet': 0,
    'bitcoin-regtest': 0,
    'litecoin-mainnet': 1786060800,
    'litecoin-testnet': 0,
    'litecoin-regtest': 0,
    'dogecoin-mainnet': 1786060800,
    'dogecoin-testnet': 0,
    'dogecoin-regtest': 0,
};

/**
 * VOTE_BINDING_MINIMUMS: from this block time a binding poll MUST carry
 * QUORUM and MIN_VOTERS >= 1 or the v0 is invalid. The wallet requires both
 * unconditionally (a stricter client rule is valid on either side of the flag
 * day); this map exists so the UI can explain WHEN the network itself starts
 * enforcing it.
 */
export const VOTE_BINDING_MINIMUMS_TIMES = Object.freeze({ ...VOTE_FLAG_DAY_TIMES });

/**
 * VOTE_CALLBACK_TIMELOCK: from this block time CALLBACK_DELAY_BLOCKS is
 * honored. BEFORE it the indexer nulls the field and still accepts the poll,
 * so an early emission publishes a permanent poll whose timelock silently does
 * not exist - the wallet must not offer the field until this is active.
 */
export const VOTE_CALLBACK_TIMELOCK_TIMES = Object.freeze({ ...VOTE_FLAG_DAY_TIMES });

/**
 * The activation block time for a chain, or null when the chain is unknown.
 * A scheduled time of 0 means "active from genesis".
 *
 * @param {string} chainId
 * @param {Record<string, number>} times
 * @returns {number | null}
 */
export function voteFlagDayTime(chainId, times) {
    const t = times ? times[chainId] : undefined;
    return Number.isFinite(t) ? Number(t) : null;
}

/**
 * Is a VOTE flag-day active at a given chain block time? Fail-closed: an
 * unknown chain or an unusable block time reads as NOT active, so the wallet
 * withholds a field rather than emitting one the network will drop.
 *
 * @param {{ chainId: string, blockTime: number | null | undefined,
 *           times: Record<string, number> }} params
 * @returns {boolean}
 */
function isVoteFlagDayActive({ chainId, blockTime, times }) {
    const scheduled = voteFlagDayTime(chainId, times);
    if (scheduled === null) return false;
    if (!Number.isFinite(blockTime)) return false;
    return Number(blockTime) >= scheduled;
}

/**
 * @param {{ chainId: string, blockTime: number | null | undefined,
 *           times?: Record<string, number> }} params
 * @returns {boolean}
 */
export function isVoteBindingMinimumsActive({ chainId, blockTime, times = VOTE_BINDING_MINIMUMS_TIMES }) {
    return isVoteFlagDayActive({ chainId, blockTime, times });
}

/**
 * @param {{ chainId: string, blockTime: number | null | undefined,
 *           times?: Record<string, number> }} params
 * @returns {boolean}
 */
export function isVoteCallbackTimelockActive({ chainId, blockTime, times = VOTE_CALLBACK_TIMELOCK_TIMES }) {
    return isVoteFlagDayActive({ chainId, blockTime, times });
}
