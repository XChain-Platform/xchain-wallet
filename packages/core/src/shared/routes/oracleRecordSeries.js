// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The oracle record's derived figures: each market's status group for the
// Markets list and its Status filter, the identity card's "since" month and
// the fee the markets were created with. All come from the page's one page
// of markets; nothing here reads. Kept pure.

function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
}

/** Positive unix seconds, or null. */
function secondsOf(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The four states a market shows in the list, in list order. Betting markets
 * have no dispute process, so there is no Disputed state: a cancelled or
 * expired market is Refunded, since every stake went back.
 */
export const ORACLE_MARKET_STATUSES = ['open', 'resolving', 'resolved', 'refunded'];

/** The list state of one market's feed_status, or null for one it cannot place. */
export function marketStatusKind(feedStatus) {
    if (feedStatus === 'open') return 'open';
    if (feedStatus === 'closed') return 'resolving';
    if (feedStatus === 'resolved' || feedStatus === 'resolved_void') return 'resolved';
    if (feedStatus === 'cancelled' || feedStatus === 'expired') return 'refunded';
    return null;
}

/**
 * The markets in list order: Open, Resolving, Resolved, Refunded (unplaced
 * last); the live ones closing soonest first, the finished ones newest first.
 *
 * @param {any[]} markets
 * @returns {any[]}
 */
export function orderedMarkets(markets) {
    const rank = (m) => {
        const i = ORACLE_MARKET_STATUSES.indexOf(marketStatusKind(m?.feed_status));
        return i < 0 ? ORACLE_MARKET_STATUSES.length : i;
    };
    return (Array.isArray(markets) ? markets : []).slice().sort((a, b) => {
        const byRank = rank(a) - rank(b);
        if (byRank !== 0) return byRank;
        const live = rank(a) < 2;
        return live ? num(a?.deadline) - num(b?.deadline) : num(b?.deadline) - num(a?.deadline);
    });
}

/**
 * The month this address opened its first market ("Jul 2026"), only when
 * the loaded page holds every market the record counts; otherwise the oldest
 * may be missing and the month would overstate how new the oracle is.
 *
 * @returns {string | null}
 */
export function sinceMonthText(record, markets) {
    const rows = Array.isArray(markets) ? markets : [];
    if (rows.length === 0 || rows.length < num(record?.total_feeds)) return null;
    let first = Infinity;
    for (const row of rows) {
        const created = secondsOf(row?.timestamp);
        if (created !== null && created < first) first = created;
    }
    if (!Number.isFinite(first)) return null;
    try {
        return new Date(first * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
    } catch {
        return null;
    }
}

/** The oracle fee the loaded markets were created with: "1.5%" or "1% to 2%". */
export function feeRangeText(markets) {
    const fees = [];
    for (const row of Array.isArray(markets) ? markets : []) {
        const raw = row?.fee;
        if (raw === null || raw === undefined || raw === '') continue;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) fees.push(n);
    }
    if (fees.length === 0) return null;
    const lo = Math.min(...fees);
    const hi = Math.max(...fees);
    const pct = (n) => `${Number(n.toFixed(4))}%`;
    return lo === hi ? pct(lo) : `${pct(lo)} to ${pct(hi)}`;
}
