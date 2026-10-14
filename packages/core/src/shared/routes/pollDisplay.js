// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const MAX_WEIGHT_SCALE = 18;

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
