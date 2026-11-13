// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The bet market card's probability-over-time series, rebuilt from the
// market's own bet rows since there is no history API: each outcome's chance
// is its share of the accepted stakes placed up to that moment.

const DAY = 86400;

/** The card's range chips: the Home chart's ranges minus YTD. */
export const BET_RANGE_WINDOWS = {
    '24h': DAY,
    '1w': 7 * DAY,
    '1m': 30 * DAY,
    '3m': 90 * DAY,
    '6m': 180 * DAY,
    '1y': 365 * DAY,
    all: Infinity,
};

const AMOUNT = /^\d{1,47}(\.\d{1,18})?$/;

/** The same accepted-bet test the split reconstruction uses. */
function isAcceptedBetRow(b) {
    if (b?.bet_status === 'invalid') return false;
    if (typeof b?.status === 'string' && /^invalid/i.test(b.status)) return false;
    return true;
}

/** The bet rows that can move the split, oldest first by action index. */
function acceptedBetsInOrder(rows, outcomeCount) {
    const count = Number(outcomeCount);
    if (!Number.isInteger(count) || count < 1 || count > 16) return [];
    const out = [];
    for (const b of Array.isArray(rows) ? rows : []) {
        if (!isAcceptedBetRow(b)) continue;
        if (b?.outcome === null || b?.outcome === undefined || b?.outcome === '') continue;
        const outcome = Number(b.outcome);
        if (!Number.isInteger(outcome) || outcome < 0 || outcome >= count) continue;
        const amount = String(b?.amount ?? '').trim();
        if (!AMOUNT.test(amount) || !(Number(amount) > 0)) continue;
        const ts = Number(b?.timestamp);
        out.push({ outcome, amount: Number(amount), ts: Number.isFinite(ts) && ts > 0 ? ts : null, index: Number(b?.action_index) });
    }
    out.sort((a, b) => {
        const ai = Number.isFinite(a.index) ? a.index : Infinity;
        const bi = Number.isFinite(b.index) ? b.index : Infinity;
        if (ai !== bi) return ai - bi;
        return (a.ts ?? Infinity) - (b.ts ?? Infinity);
    });
    // A row without a time takes the time of the bet before it, so its stake
    // still counts from its place in chain order.
    let last = null;
    for (const b of out) {
        if (b.ts === null) b.ts = last;
        else last = b.ts;
    }
    return out.filter((b) => b.ts !== null);
}

/** Each outcome's percent of a pool list, or null when nothing is staked. */
function sharesOf(pools, outcomeCount) {
    const shares = new Array(outcomeCount).fill(0);
    let total = 0;
    for (const p of Array.isArray(pools) ? pools : []) {
        const i = Number(p?.outcome);
        const v = Number(p?.pool);
        if (!Number.isInteger(i) || i < 0 || i >= outcomeCount || !(v >= 0)) continue;
        shares[i] += v;
        total += v;
    }
    if (!(total > 0)) return null;
    return shares.map((v) => (v / total) * 100);
}

/**
 * The probability lines for one range.
 *
 * @param {object} args
 * @param {any[]} args.bets            the market's bet rows (any order)
 * @param {any[]} args.pools           the explorer's current per-outcome pools
 * @param {number} args.outcomeCount
 * @param {string} args.rangeId        a BET_RANGE_WINDOWS key
 * @param {number} [args.now]          unix seconds
 * @param {number} [args.createdAt]    the market's own creation time, for All
 * @param {number} [args.points]
 * @returns {{ lines: Array<{ outcome: number, values: Array<number | null> }>, fromBets: boolean, current: number[] | null }}
 */
export function probabilitySeries({ bets, pools, outcomeCount, rangeId, now = Math.floor(Date.now() / 1000), createdAt, points = 48 }) {
    const count = Number(outcomeCount);
    if (!Number.isInteger(count) || count < 1) return { lines: [], fromBets: false, current: null };
    const current = sharesOf(pools, count);
    const ordered = acceptedBetsInOrder(bets, count);
    const window = BET_RANGE_WINDOWS[rangeId] ?? BET_RANGE_WINDOWS['1w'];
    let start;
    if (Number.isFinite(window)) {
        start = now - window;
    } else {
        const firstBet = ordered.length > 0 ? ordered[0].ts : null;
        const created = Number(createdAt);
        start = Math.min(
            Number.isFinite(created) && created > 0 ? created : Infinity,
            firstBet ?? Infinity,
        );
        if (!Number.isFinite(start) || start >= now) start = now - 7 * DAY;
    }
    const lines = Array.from({ length: count }, (_, outcome) => ({ outcome, values: new Array(points).fill(null) }));

    if (ordered.length === 0) {
        // No bet rows to rebuild from: the line holds the current split flat,
        // which is what the market reads now, and the card says so.
        if (current) {
            for (const line of lines) line.values.fill(current[line.outcome]);
        }
        return { lines, fromBets: false, current };
    }

    const totals = new Array(count).fill(0);
    let sum = 0;
    let next = 0;
    for (let k = 0; k < points; k += 1) {
        const t = points === 1 ? now : start + ((now - start) * k) / (points - 1);
        while (next < ordered.length && ordered[next].ts <= t) {
            totals[ordered[next].outcome] += ordered[next].amount;
            sum += ordered[next].amount;
            next += 1;
        }
        if (sum > 0) {
            for (const line of lines) line.values[k] = (totals[line.outcome] / sum) * 100;
        }
    }
    // The line ends on the explorer's own split, so the card's big figure and
    // the end of its line always agree (the bet read is capped at a page).
    if (current) {
        for (const line of lines) line.values[points - 1] = current[line.outcome];
    }
    return { lines, fromBets: true, current };
}

/** First drawn value to last of one line, in percentage points. */
export function lineChange(values) {
    if (!Array.isArray(values)) return null;
    const drawn = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (drawn.length === 0) return null;
    return drawn[drawn.length - 1] - drawn[0];
}
