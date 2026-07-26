// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// stakingDashboard (PC-47): the two derived numbers the staking list needs -
// what a validator can claim right now, and when a releasing position matures.
// Pure and synchronous; the callers own the fetching.
//
// UNCLAIMED REWARDS mirrors the indexer's own getUnclaimedRewardTotal exactly:
//
//     sum(validator_rewards.amount) - sum(reward_claims.amount WHERE valid)
//
// The `WHERE valid` half is the part that is easy to miss and expensive to get
// wrong. A COLLECT that the chain REJECTED - most usefully, one rejected as
// `insufficient reward pool` - still leaves a reward_claims row behind. Counting
// it would tell a validator their rewards were already paid out when in fact
// nothing moved and the claim is still available to retry. So only claims the
// indexer marked valid subtract here.
//
// Arithmetic is BigInt over base units, the same posture as balances.js: these
// are money totals, and floating-point summation of many reward rows drifts.
//
// COOLDOWN needs no derivation at all, and this is a correction to the item's
// premise. PC-47 was written expecting the wallet to compute maturity itself
// from getUnstakes plus a per-lane cooldown source (the protocol constant for
// validator stakes, the contract's own COOLDOWN_BLOCKS for stakeable
// contracts). At HEAD the indexer ALREADY resolves that per lane and stamps the
// result on the row as `cooldown_end_block` (xchain-indexer/src/actions/
// unstake.js: the contract lane reads contractInfo.cooldown_blocks, the
// validator lane the protocol constant), and the explorer projects it. So the
// wallet only needs the chain height to count down. Re-deriving it wallet-side
// would risk DISAGREEING with the block the chain actually stamped, which is
// the one number that matters.
//
// The zero trap: the indexer deliberately leaves `cooldown_end_block` at 0 on
// INVALID unstake rows rather than persisting a phantom maturity. Zero is a
// smaller number than any real height, so a naive comparison reports those as
// matured long ago. They are treated as unknown here.

import { estimateBlockDate } from '../shared/utils/blockDateEstimate.js';

/** Base units per whole token at 8dp (XCHAIN's scale; see the genesis spec). */
const SCALE = 8;

/**
 * Exact decimal string -> base-unit BigInt. Returns null for anything that
 * isn't a plain decimal, so a malformed row is skipped rather than silently
 * counted as zero.
 *
 * @param {string | number | null | undefined} value
 * @param {number} [decimals]
 * @returns {bigint | null}
 */
export function toBaseUnits(value, decimals = SCALE) {
    if (value == null || value === '') return null;
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
    if (!m) return null;
    const frac = (m[3] || '').slice(0, decimals).padEnd(decimals, '0');
    const magnitude = BigInt(m[2]) * (10n ** BigInt(decimals)) + BigInt(frac || '0');
    return m[1] === '-' ? -magnitude : magnitude;
}

/**
 * Base-unit BigInt -> exact decimal string, trailing zeros trimmed.
 *
 * @param {bigint} units
 * @param {number} [decimals]
 * @returns {string}
 */
export function fromBaseUnits(units, decimals = SCALE) {
    const neg = units < 0n;
    const abs = neg ? -units : units;
    const div = 10n ** BigInt(decimals);
    const whole = (abs / div).toString();
    const frac = (abs % div).toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * @typedef {Object} UnclaimedRewards
 * @property {string} accrued    total ever accrued, exact decimal
 * @property {string} claimed    total successfully claimed, exact decimal
 * @property {string} unclaimed  accrued - claimed, floored at 0, exact decimal
 * @property {boolean} hasRejectedClaim  a claim exists that the chain refused
 */

/**
 * Unclaimed validator rewards for one address.
 *
 * @param {object} args
 * @param {Array<{ amount?: string }>} [args.rewards]  validator_rewards rows (accrual ledger)
 * @param {Array<{ amount?: string, status?: string }>} [args.claims]  reward_claims rows (COLLECT events)
 * @returns {UnclaimedRewards}
 */
export function unclaimedRewards({ rewards, claims } = {}) {
    let accrued = 0n;
    for (const r of Array.isArray(rewards) ? rewards : []) {
        const units = toBaseUnits(r?.amount);
        if (units !== null) accrued += units;
    }
    let claimed = 0n;
    let hasRejectedClaim = false;
    for (const c of Array.isArray(claims) ? claims : []) {
        const valid = String(c?.status ?? '') === 'valid';
        if (!valid) { hasRejectedClaim = true; continue; }
        const units = toBaseUnits(c?.amount);
        if (units !== null) claimed += units;
    }
    const remaining = accrued - claimed;
    return {
        accrued: fromBaseUnits(accrued),
        claimed: fromBaseUnits(claimed),
        // A negative can only mean inconsistent reads mid-reorg; showing a
        // negative claimable would be worse than showing nothing owed.
        unclaimed: fromBaseUnits(remaining > 0n ? remaining : 0n),
        hasRejectedClaim,
    };
}

/**
 * @typedef {Object} CooldownStatus
 * @property {'matured' | 'releasing' | 'unknown'} state
 * @property {number | null} blocksRemaining
 * @property {number | null} endBlock
 * @property {Date | null} maturityEstimate  approximate wall-clock maturity
 */

/**
 * Where a releasing position stands, from the end block the CHAIN stamped.
 *
 * @param {object} args
 * @param {{ cooldown_end_block?: number | string | null }} args.unstake
 * @param {number | string | null | undefined} args.height  current chain height
 * @param {string | null | undefined} [args.coin]  for the maturity estimate
 * @returns {CooldownStatus}
 */
export function cooldownStatus({ unstake, height, coin } = {}) {
    const raw = unstake ? unstake.cooldown_end_block : null;
    const endBlock = raw == null || raw === '' ? NaN : Number(raw);
    const current = height == null || height === '' ? NaN : Number(height);
    // 0 is the indexer's "no maturity recorded" marker on invalid unstakes, not
    // a block that has long since passed.
    if (!Number.isFinite(endBlock) || endBlock <= 0 || !Number.isFinite(current)) {
        return { state: 'unknown', blocksRemaining: null, endBlock: null, maturityEstimate: null };
    }
    const blocksRemaining = endBlock - current;
    if (blocksRemaining <= 0) {
        return { state: 'matured', blocksRemaining: 0, endBlock, maturityEstimate: null };
    }
    return {
        state: 'releasing',
        blocksRemaining,
        endBlock,
        maturityEstimate: estimateBlockDate({ coin, currentHeight: current, targetBlock: endBlock }),
    };
}

/**
 * Plain-language countdown for a releasing position. Returns null when there
 * is nothing meaningful to say, so the caller keeps its existing text.
 *
 * @param {CooldownStatus} status
 * @returns {string | null}
 */
export function cooldownText(status) {
    if (!status) return null;
    if (status.state === 'matured') return 'Ready to withdraw';
    if (status.state !== 'releasing') return null;
    const blocks = status.blocksRemaining;
    const plural = blocks === 1 ? 'block' : 'blocks';
    if (!status.maturityEstimate) return `Releasing: ${blocks} ${plural} to go`;
    const when = status.maturityEstimate.toLocaleDateString(undefined, {
        month: 'short', day: 'numeric',
    });
    // "~" throughout: block intervals are a difficulty target, not a schedule.
    return `Releasing: ${blocks} ${plural} to go (~${when})`;
}
