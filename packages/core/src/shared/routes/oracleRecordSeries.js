// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The oracle card's "markets resolved over time" series and figures, derived
// from the page's two reads. No settle time exists, so each settled row is
// dated at its betting close (the earliest it could have settled). Kept pure.

const DAY = 86400;

/** The card's range chips. */
export const ORACLE_RANGE_WINDOWS = {
    '1m': 30 * DAY,
    '3m': 90 * DAY,
    '6m': 180 * DAY,
    '1y': 365 * DAY,
    all: Infinity,
};

/** Statuses where the oracle published a result (with or without a winner). */
export const RESOLVED_STATUSES = new Set(['resolved', 'resolved_void']);

function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
}

/** Positive unix seconds, or null. */
function secondsOf(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** The record's resolved total: settled with a winner plus settled void. */
export function resolvedTotal(record) {
    const counts = record?.counts || {};
    return num(counts.resolved) + num(counts.resolved_void);
}

/** When a settled row is drawn: its betting close, never later than now. */
export function resolvedAt(row, now) {
    if (!RESOLVED_STATUSES.has(row?.feed_status)) return null;
    const deadline = secondsOf(row?.deadline);
    if (deadline === null) return null;
    return Math.min(deadline, now);
}

/**
 * The cumulative resolved count for one range.
 *
 * The market read is one page, so the line is pinned to the record's own
 * total: settled markets the page did not load (or could not date) are
 * counted before the first point, and the last point always equals the
 * card's big number.
 *
 * @param {object} args
 * @param {any} args.record
 * @param {any[]} args.markets
 * @param {string} args.rangeId     an ORACLE_RANGE_WINDOWS key
 * @param {number} [args.now]       unix seconds
 * @param {number} [args.points]
 * @returns {{ values: number[], total: number, inRange: number, dated: number, start: number }}
 */
export function resolvedSeries({ record, markets, rangeId, now = Math.floor(Date.now() / 1000), points = 48 }) {
    const total = resolvedTotal(record);
    const times = [];
    for (const row of Array.isArray(markets) ? markets : []) {
        const t = resolvedAt(row, now);
        if (t !== null) times.push(t);
    }
    times.sort((a, b) => a - b);
    // Never let a stale record end the line below the rows we can see.
    const end = Math.max(total, times.length);
    const before = end - times.length;

    const window = ORACLE_RANGE_WINDOWS[rangeId] ?? Infinity;
    let start;
    if (Number.isFinite(window)) {
        start = now - window;
    } else {
        let first = times.length ? times[0] : Infinity;
        for (const row of Array.isArray(markets) ? markets : []) {
            const created = secondsOf(row?.timestamp);
            if (created !== null && created < first) first = created;
        }
        start = Number.isFinite(first) && first < now ? first : now - 30 * DAY;
    }

    const values = new Array(points).fill(end);
    if (times.length === 0) return { values, total: end, inRange: 0, dated: 0, start };
    let next = 0;
    for (let k = 0; k < points; k += 1) {
        const t = points === 1 ? now : start + ((now - start) * k) / (points - 1);
        while (next < times.length && times[next] <= t) next += 1;
        values[k] = before + next;
    }
    values[points - 1] = end;
    const inRange = times.filter((t) => t > start && t <= now).length;
    return { values, total: end, inRange, dated: times.length, start };
}

/**
 * Whether a range's count can be shown, and whether it is only a floor. The
 * market read is newest first, so a range reaching back past the oldest
 * loaded market may be missing some; All is never shown (it is the big
 * number, less what the page could not date).
 *
 * @returns {'hide' | 'exact' | 'floor'}
 */
export function rangeCountKind({ rangeId, series, record, markets }) {
    if (rangeId === 'all' || !series || series.dated === 0) return 'hide';
    const rows = Array.isArray(markets) ? markets : [];
    if (rows.length >= num(record?.total_feeds)) return 'exact';
    let oldest = Infinity;
    for (const row of rows) {
        const created = secondsOf(row?.timestamp);
        if (created !== null && created < oldest) oldest = created;
    }
    return Number.isFinite(oldest) && series.start >= oldest ? 'exact' : 'floor';
}

/** "3 months" style wording for a span of seconds. */
export function spanText(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
    if (s < 60 * DAY) return plural(Math.max(1, Math.floor(s / DAY)), 'day');
    if (s < 730 * DAY) return plural(Math.floor(s / (30 * DAY)), 'month');
    return plural(Math.floor(s / (365 * DAY)), 'year');
}

/**
 * How long this address has run markets, from its oldest loaded market. When
 * the page holds fewer markets than the record counts, the oldest one may be
 * missing, so the span reads as a floor ("3+ months").
 *
 * @returns {string | null}
 */
export function activeForText(record, markets, now = Math.floor(Date.now() / 1000)) {
    const rows = Array.isArray(markets) ? markets : [];
    let first = Infinity;
    for (const row of rows) {
        const created = secondsOf(row?.timestamp);
        if (created !== null && created < first) first = created;
    }
    if (!Number.isFinite(first) || first > now) return null;
    const complete = rows.length >= num(record?.total_feeds);
    const span = spanText(now - first);
    return complete ? span : span.replace(/^(\d+)/, '$1+');
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
