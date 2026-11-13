// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { neutralizeControlText } from '../utils/textHardening.js';

const MAX_WEIGHT_SCALE = 18;
const MAX_QUESTION_DISPLAY_LENGTH = 1_024;
const MAX_OPTION_DISPLAY_LENGTH = 256;
const MAX_SHORT_FIELD_DISPLAY_LENGTH = 128;
const MAX_ACTION_INDEX = 0xffffffffffffffffn;

function primitiveDisplayText(value, maxLength, fallback = '') {
    const type = typeof value;
    if (value === null || value === undefined
        || !['string', 'number', 'bigint', 'boolean'].includes(type)
        || (type === 'number' && !Number.isFinite(value))) return fallback;
    return neutralizeControlText(value, { maxLength }) || fallback;
}

function positiveIndexText(value) {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    }
    const raw = String(value ?? '').trim();
    if (!/^[1-9]\d{0,19}$/.test(raw)) return null;
    return BigInt(raw) <= MAX_ACTION_INDEX ? raw : null;
}

/** Normalize untrusted explorer poll fields before a route renders them. */
export function pollRowForDisplay(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const actionIndex = positiveIndexText(row.action_index);
    const pollIndex = positiveIndexText(row.poll_index);
    if (actionIndex && pollIndex && BigInt(actionIndex) !== BigInt(pollIndex)) return null;
    const indexText = actionIndex || pollIndex;
    const indexValue = actionIndex ? row.action_index : row.poll_index;
    if (!indexText) return null;
    const options = Array.isArray(row.options)
        ? row.options.map((option) => (
            primitiveDisplayText(option, MAX_OPTION_DISPLAY_LENGTH, 'Unavailable option')
        ))
        : [];
    return {
        ...row,
        action_index: typeof indexValue === 'number' ? indexValue : indexText,
        tick: primitiveDisplayText(row.tick, MAX_SHORT_FIELD_DISPLAY_LENGTH),
        question: primitiveDisplayText(row.question, MAX_QUESTION_DISPLAY_LENGTH),
        options,
        poll_status: primitiveDisplayText(row.poll_status, MAX_SHORT_FIELD_DISPLAY_LENGTH),
        tally_mode: primitiveDisplayText(row.tally_mode, MAX_SHORT_FIELD_DISPLAY_LENGTH, 'unavailable'),
        weight_mode: primitiveDisplayText(row.weight_mode, MAX_SHORT_FIELD_DISPLAY_LENGTH, 'unavailable'),
    };
}

/** Compare poll ids as exact integers without passing them through Number. */
export function samePollIndex(left, right) {
    const a = positiveIndexText(left);
    const b = positiveIndexText(right);
    return a !== null && b !== null && BigInt(a) === BigInt(b);
}

function parseWeight(value) {
    if (typeof value === 'number' && (
        !Number.isFinite(value)
        || value < 0
        || (Number.isInteger(value) && !Number.isSafeInteger(value))
    )) return null;
    const raw = String(value ?? '').trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
    if (!match) return null;
    const fraction = (match[2] || '').replace(/0+$/, '');
    if (fraction.length > MAX_WEIGHT_SCALE) return null;
    return {
        units: BigInt(`${match[1]}${fraction}`),
        scale: fraction.length,
    };
}

/**
 * Allocate whole display percentages from frozen per-option weights.
 * Largest remainders receive the spare points, in result order for ties, so
 * every positive tally displays exactly 100 percent without float rounding.
 */
export function pollResultPercentages(rows) {
    const results = Array.isArray(rows) ? rows : [];
    const parsed = results.map((row) => parseWeight(row?.total_weight));
    const scale = parsed.reduce((largest, weight) => Math.max(largest, weight?.scale || 0), 0);
    const weights = parsed.map((weight) => (weight
        ? weight.units * 10n ** BigInt(scale - weight.scale)
        : 0n));
    const total = weights.reduce((sum, weight) => sum + weight, 0n);
    if (total === 0n) return weights.map(() => 0);

    const percentages = [];
    const remainders = [];
    let allocated = 0n;
    weights.forEach((weight, index) => {
        const scaled = weight * 100n;
        const whole = scaled / total;
        percentages[index] = Number(whole);
        allocated += whole;
        remainders.push({ index, remainder: scaled % total });
    });
    remainders.sort((left, right) => {
        if (left.remainder === right.remainder) return left.index - right.index;
        return left.remainder > right.remainder ? -1 : 1;
    });
    const spare = Number(100n - allocated);
    for (let index = 0; index < spare; index += 1) {
        percentages[remainders[index].index] += 1;
    }
    return percentages;
}

// The exact option labels of a yes/no poll. The indexer stores no outcome,
// so only a two-option poll whose labels are exactly one of these pairs
// reads as Approved or Rejected; a winning "No fee" stays Decided.
const YES_NO_PAIRS = [
    ['yes', 'no'],
    ['approve', 'reject'],
    ['for', 'against'],
    ['aye', 'nay'],
];

function yesNoReading(options, winner) {
    if (!Array.isArray(options) || options.length !== 2) return null;
    const labels = options.map((option) => String(option ?? '').trim().toLowerCase());
    for (const [yes, no] of YES_NO_PAIRS) {
        const yesIndex = labels.indexOf(yes);
        const noIndex = labels.indexOf(no);
        if (yesIndex === -1 || noIndex === -1) continue;
        if (winner === yesIndex) return 'approved';
        if (winner === noIndex) return 'rejected';
    }
    return null;
}

/**
 * The outcome of a closed poll, for the poll page's result card and the
 * list's status pill. An explicit `outcome` on the row wins; otherwise it
 * is inferred from the labels: a two-option poll labelled exactly as a
 * yes/no pair (Yes and No, Approve and Reject, For and Against, Aye and
 * Nay) is Approved or Rejected by its winner, and any other decided poll is
 * Decided.
 *
 * @param {any} poll  a row from pollRowForDisplay
 * @returns {'approved' | 'rejected' | 'no_quorum' | 'decided' | null}  null while the poll is open or pending
 */
export function pollOutcome(poll) {
    const status = poll?.poll_status;
    if (status === 'failed_quorum') return 'no_quorum';
    if (status !== 'finalized') return null;
    if (poll?.outcome === 'approved' || poll?.outcome === 'rejected') return poll.outcome;
    const winner = poll?.winning_option;
    const index = winner === null || winner === undefined || winner === '' ? null : Number(winner);
    return (Number.isInteger(index) && yesNoReading(poll?.options, index)) || 'decided';
}

/**
 * Plain-language pill label for a poll's lifecycle and outcome. Unknown
 * codes degrade to a sentence-case humanization rather than a raw token.
 *
 * @param {string | null | undefined} status
 * @param {string | null | undefined} [outcome]
 */
export function pollStatusLabel(status, outcome) {
    if (status === 'pending') return 'Not started';
    if (status === 'finalized' && outcome === 'approved') return 'Approved';
    if (status === 'finalized' && outcome === 'rejected') return 'Rejected';
    if (status === 'finalized') return 'Decided';
    if (status === 'failed_quorum') return 'No quorum';
    if (status === 'open' || !status) return 'Open';
    const words = String(status).trim().toLowerCase().replace(/[_-]+/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Pill colours for a poll's lifecycle: pending grey, open amber, approved
 * or decided green, rejected and no quorum red.
 *
 * @param {string | null | undefined} status
 * @param {string | null | undefined} [outcome]
 * @returns {{ bg: string, fg: string }}
 */
export function pollStatusTone(status, outcome) {
    if (status === 'pending') return { bg: 'var(--xc-bg-muted)', fg: 'var(--xc-text-muted)' };
    if (status === 'finalized' && outcome === 'rejected') return { bg: 'var(--xc-danger-bg)', fg: 'var(--xc-danger-text)' };
    if (status === 'finalized') return { bg: 'color-mix(in srgb, var(--xc-success) 18%, transparent)', fg: 'var(--xc-success)' };
    if (status === 'failed_quorum') return { bg: 'var(--xc-danger-bg)', fg: 'var(--xc-danger-text)' };
    return { bg: 'var(--xc-warning-bg)', fg: 'var(--xc-warning-text)' };
}

/**
 * The result card's numbers from the frozen per-option tally: each
 * option's weight, whole percentage (summing to 100) and voter count, the
 * leading option (null on a tie or an empty tally) and the total voters.
 *
 * @param {any[] | null | undefined} rows     poll_results rows
 * @param {string[]} options                  the poll's option labels
 */
export function pollResultSummary(rows, options) {
    const results = Array.isArray(rows) ? rows : [];
    const percentages = pollResultPercentages(results);
    const entries = results.map((row, index) => {
        const optionIndex = Number(row?.option_index);
        return {
            optionIndex,
            label: Number.isInteger(optionIndex) ? String(options?.[optionIndex] ?? '') : '',
            weight: String(row?.total_weight ?? '0'),
            percent: percentages[index] || 0,
            voters: Number.isFinite(Number(row?.voter_count)) ? Number(row.voter_count) : 0,
            parsed: parseWeight(row?.total_weight),
        };
    });
    const scale = entries.reduce((largest, entry) => Math.max(largest, entry.parsed?.scale || 0), 0);
    const weighted = entries.map((entry) => ({
        entry,
        units: entry.parsed ? entry.parsed.units * 10n ** BigInt(scale - entry.parsed.scale) : 0n,
    }));
    const top = weighted.reduce((best, item) => (item.units > best ? item.units : best), 0n);
    const leaders = top > 0n ? weighted.filter((item) => item.units === top) : [];
    return {
        entries: entries.map(({ parsed: _parsed, ...entry }) => entry),
        leading: leaders.length === 1 ? (({ parsed: _parsed, ...entry }) => entry)(leaders[0].entry) : null,
        tie: leaders.length > 1,
        totalVoters: entries.reduce((sum, entry) => sum + entry.voters, 0),
    };
}

/**
 * "in 3 days", "in 4 h", "in 20 min" for a block count at the chain's
 * target block interval; null when either is unknown.
 *
 * @param {number | null} blocks
 * @param {number | null} blockSeconds
 */
export function blocksDurationText(blocks, blockSeconds) {
    if (!Number.isFinite(blocks) || !Number.isFinite(blockSeconds) || blockSeconds <= 0) return null;
    const secs = Math.max(0, blocks) * blockSeconds;
    if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))} min`;
    if (secs < 86400) return `${Math.round(secs / 3600)} h`;
    const days = Math.round(secs / 86400);
    return `${days} day${days === 1 ? '' : 's'}`;
}

function actionIndex(row) {
    const value = row?.action_index;
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
    }
    const raw = String(value ?? '').trim();
    return /^\d+$/.test(raw) ? BigInt(raw) : null;
}

/** Return the latest complete ballot set cast directly by one address. */
export function latestBallotRows(rows, address) {
    const matching = (Array.isArray(rows) ? rows : [])
        .filter((row) => String(row?.source ?? '') === String(address));
    const indexed = matching.map((row) => ({ row, index: actionIndex(row) }));
    const valid = indexed.filter(({ index }) => index !== null);
    if (!valid.length) return matching;
    const latest = valid.reduce(
        (largest, entry) => (entry.index > largest ? entry.index : largest),
        valid[0].index,
    );
    return valid.filter(({ index }) => index === latest).map(({ row }) => row);
}
