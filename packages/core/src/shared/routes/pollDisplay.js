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
