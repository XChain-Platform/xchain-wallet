// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A token's balance over time, rebuilt from this wallet's own history rows,
// for the asset page's hero chart when the token has no price history. The
// wallet never invents a number: the line starts from the balance it holds
// now and steps back through the rows it read, and it is never drawn back
// past the oldest row loaded. Only rows whose effect on the balance the
// record states (a send, receive, mint, issue or destroy of this token) move
// the line; every other row leaves it where it is.

import { classifyEntryAction } from './historyFilter.js';
import { activityRowTick, rawActivityAmount } from './activityAmount.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Milliseconds for an entry's time; a row with no time yet (pending) is now. */
function entryMs(entry, nowMs) {
    const value = Number(entry?.timestamp);
    if (!Number.isFinite(value) || value <= 0) return nowMs;
    return value < 1e12 ? value * 1000 : value;
}

/** A whole-unit decimal ("1.5") as base units, or null when it is not one. */
function wholeToAtomic(text, divisibility) {
    const s = String(text ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const [whole, frac = ''] = s.split('.');
    const places = Math.max(0, divisibility | 0);
    const fraction = frac.slice(0, places).padEnd(places, '0');
    try {
        return BigInt(whole + fraction);
    } catch {
        return null;
    }
}

/** A base-unit integer string as a BigInt, or null. */
function baseToAtomic(text) {
    const s = String(text ?? '').trim();
    if (!/^\d+$/.test(s)) return null;
    try {
        return BigInt(s);
    } catch {
        return null;
    }
}

function sideAddress(raw, keys) {
    for (const key of keys) {
        const value = raw?.[key];
        if (typeof value === 'string' && value) return value.toLowerCase();
    }
    return '';
}

/**
 * The change one history row made to this wallet's balance of `tick`, in base
 * units, or 0n when the row does not say. A SEND row carries a whole-unit
 * amount; MINT, ISSUE and DESTROY rows carry base units.
 *
 * @param {any} entry  a normalized history entry (historyRow.js)
 * @param {{ tick: string, divisibility: number, walletAddresses?: Set<string> }} ctx
 * @returns {bigint}
 */
export function entryBalanceDelta(entry, { tick, divisibility, walletAddresses }) {
    const want = String(tick || '').toUpperCase();
    if (!want || String(activityRowTick(entry)).toUpperCase() !== want) return 0n;
    const action = String(entry?.action || '').toUpperCase();
    const raw = entry?.raw || {};
    const amountText = rawActivityAmount(raw);
    if (action === 'SEND') {
        const atomic = wholeToAtomic(amountText, divisibility);
        if (atomic === null) return 0n;
        const own = walletAddresses instanceof Set ? walletAddresses : new Set();
        const source = sideAddress(raw, ['source', 'SOURCE']);
        const destination = sideAddress(raw, ['destination', 'DESTINATION']);
        // A send between two of the wallet's own addresses leaves the total.
        if (source && destination && own.has(source) && own.has(destination)) return 0n;
        const kind = classifyEntryAction(entry, own);
        if (kind === 'send') return -atomic;
        if (kind === 'receive') return atomic;
        return 0n;
    }
    const atomic = baseToAtomic(amountText);
    if (atomic === null) return 0n;
    if (action === 'MINT' || action === 'ISSUE' || action === 'ISSUANCE') return atomic;
    if (action === 'DESTROY' || action === 'BURN') return -atomic;
    return 0n;
}

/**
 * Where a chart range's window opens, in milliseconds. The two hourly ranges
 * are fixed spans back from now; the daily ones use `dailyWindowStart` (the
 * portfolio chart's calendar rule), and All opens at the oldest row.
 *
 * @param {{ id: string }} range
 * @param {number} nowMs
 * @param {(rangeId: string, nowMs: number) => number} [dailyWindowStart]
 * @returns {number}
 */
export function balanceWindowStart(range, nowMs, dailyWindowStart) {
    if (range?.id === '24h') return nowMs - DAY_MS;
    if (range?.id === '1w') return nowMs - 7 * DAY_MS;
    if (range?.id === 'all') return -Infinity;
    const start = typeof dailyWindowStart === 'function' ? dailyWindowStart(range?.id, nowMs) : Number.NaN;
    return Number.isFinite(start) ? start : nowMs - 30 * DAY_MS;
}

/**
 * The balance line for one range: `points` evenly spaced samples from the
 * window's start to now, in whole units. With no rows the line is flat at the
 * current balance, so the hero still draws its chart.
 *
 * @param {object} args
 * @param {any[] | null} args.entries         this wallet's rows for the asset, any order
 * @param {bigint | null} args.currentAtomic  the balance held now, in base units
 * @param {string} args.tick
 * @param {number | null} args.divisibility
 * @param {Set<string>} [args.walletAddresses]
 * @param {number} args.points                samples to draw (the range's point count)
 * @param {number} args.windowStart           ms where the range opens (-Infinity for All)
 * @param {number} [args.nowMs]
 * @returns {number[] | null}  null while the balance is unknown
 */
export function balanceSeries({ entries, currentAtomic, tick, divisibility, walletAddresses, points, windowStart, nowMs = Date.now() }) {
    if (typeof currentAtomic !== 'bigint') return null;
    const div = Number.isInteger(divisibility) && divisibility >= 0 ? divisibility : 0;
    const scale = 10 ** div;
    const toUnits = (atomic) => Number(atomic) / scale;
    const n = Math.max(2, points | 0);
    const rows = Array.isArray(entries) ? entries : [];
    if (rows.length === 0) return new Array(n).fill(toUnits(currentAtomic));

    const own = walletAddresses instanceof Set
        ? walletAddresses
        : new Set(rows.map((e) => String(e?.address || '').toLowerCase()).filter(Boolean));
    // Newest first, so the walk steps back from the balance held now.
    const events = rows
        .map((entry) => ({ ms: entryMs(entry, nowMs), delta: entryBalanceDelta(entry, { tick, divisibility: div, walletAddresses: own }) }))
        .filter((event) => event.delta !== 0n)
        .sort((a, b) => b.ms - a.ms);
    const steps = [];
    let after = currentAtomic;
    for (const event of events) {
        steps.push({ ms: event.ms, after });
        let before = after - event.delta;
        if (before < 0n) before = 0n;
        after = before;
    }
    const oldestBefore = after;

    // Never back past the oldest row read: before it the balance is unknown.
    const oldestRowMs = Math.min(...rows.map((entry) => entryMs(entry, nowMs)));
    let start = Number.isFinite(windowStart) ? windowStart : -Infinity;
    if (start < oldestRowMs) start = oldestRowMs - 1;
    if (!(start < nowMs)) start = nowMs - 1;

    const balanceAt = (ms) => {
        for (const step of steps) {
            if (step.ms <= ms) return step.after;
        }
        return oldestBefore;
    };
    const out = new Array(n);
    for (let i = 0; i < n; i += 1) {
        const at = start + ((nowMs - start) * i) / (n - 1);
        out[i] = toUnits(balanceAt(at));
    }
    return out;
}
