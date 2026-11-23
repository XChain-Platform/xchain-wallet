// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export const DUO_STATES = Object.freeze([
    'closed-portrait',
    'closed-landscape',
    'open-portrait',
    'open-landscape',
    'partial-vertical',
    'partial-horizontal',
]);

const DIVISION_ORIENTATIONS = new Set(['vertical', 'horizontal', 'none']);
const FOLD_POSTURES = new Set(['closed', 'open', 'partial']);
const FOLD_DISPLAYS = new Set(['inner', 'outer']);
const MEASUREMENT_KEYS = ['division', 'height', 'width'];
const DIVISION_KEYS = ['height', 'orientation', 'width', 'x', 'y'];

export function parseFoldLines(text) {
    const folds = [];
    for (const line of text.split(/\r?\n/)) {
        const markerIndex = line.indexOf('fold: ');
        if (markerIndex === -1) continue;

        let fold;
        try {
            fold = JSON.parse(line.slice(markerIndex + 'fold: '.length));
        } catch {
            continue;
        }
        if (isFold(fold)) folds.push(fold);
    }
    return folds;
}

export function foldMeasurement(fold) {
    return {
        width: fold.viewport.width,
        height: fold.viewport.height,
        division: {
            orientation: fold.division.orientation,
            x: fold.division.x,
            y: fold.division.y,
            width: fold.division.width,
            height: fold.division.height,
        },
    };
}

export function buildMeasuredWidths({
    device,
    measuredAt,
    folds = {},
    unreachable = {},
}) {
    checkKnownStates(folds, 'folds');
    checkKnownStates(unreachable, 'unreachable');

    const states = {};
    for (const stateName of DUO_STATES) {
        const stateFolds = folds[stateName];
        if (stateFolds !== undefined && !Array.isArray(stateFolds)) {
            throw new TypeError(`Duo state "${stateName}" folds must be an array`);
        }

        const hasReading = Array.isArray(stateFolds) && stateFolds.length > 0;
        const hasReason = Object.hasOwn(unreachable, stateName);
        if (hasReading && hasReason) {
            throw new TypeError(`Duo state "${stateName}" has both a reading and a reason`);
        }
        if (hasReason) {
            const reason = unreachable[stateName];
            if (typeof reason !== 'string' || reason.trim() === '') {
                throw new TypeError(`Duo state "${stateName}" has a blank reason`);
            }
            states[stateName] = { unreachable: reason.trim() };
            continue;
        }
        if (!hasReading) {
            throw new TypeError(`Duo state "${stateName}" has neither a reading nor a reason`);
        }
        states[stateName] = foldMeasurement(stateFolds.at(-1));
    }

    return { device, measuredAt, states };
}

export function checkMeasuredWidths(value) {
    if (!isObject(value)) return ['fixture must be an object'];

    const problems = [];
    if (typeof value.device !== 'string' || value.device.trim() === '') {
        problems.push('device must be a non-empty string');
    }
    if (!isIsoTimestamp(value.measuredAt)) {
        problems.push('measuredAt must be an ISO 8601 timestamp');
    }
    if (!isObject(value.states)) {
        problems.push('states must be an object');
        return problems;
    }

    const stateKeys = Object.keys(value.states);
    if (!sameKeys(stateKeys, DUO_STATES)) {
        problems.push(`states must contain exactly: ${DUO_STATES.join(', ')}`);
    }

    for (const stateName of DUO_STATES) {
        if (!Object.hasOwn(value.states, stateName)) continue;
        checkState(value.states[stateName], `states.${stateName}`, problems);
    }
    return problems;
}

function checkState(state, path, problems) {
    if (!isObject(state)) {
        problems.push(`${path} must be an object`);
        return;
    }

    if (Object.hasOwn(state, 'unreachable')) {
        if (!sameKeys(Object.keys(state), ['unreachable'])) {
            problems.push(`${path} must contain only unreachable`);
        }
        if (typeof state.unreachable !== 'string' || state.unreachable.trim() === '') {
            problems.push(`${path}.unreachable must be a non-empty string`);
        }
        return;
    }

    if (!sameKeys(Object.keys(state), MEASUREMENT_KEYS)) {
        problems.push(`${path} must contain exactly width, height, division`);
        return;
    }
    checkPositive(state.width, `${path}.width`, problems);
    checkPositive(state.height, `${path}.height`, problems);
    checkDivision(state.division, `${path}.division`, problems);
}

function checkDivision(division, path, problems) {
    if (!isObject(division)) {
        problems.push(`${path} must be an object`);
        return;
    }
    if (!sameKeys(Object.keys(division), DIVISION_KEYS)) {
        problems.push(`${path} must contain exactly orientation, x, y, width, height`);
        return;
    }
    if (!DIVISION_ORIENTATIONS.has(division.orientation)) {
        problems.push(`${path}.orientation must be vertical, horizontal or none`);
    }
    for (const name of ['x', 'y', 'width', 'height']) {
        if (!Number.isFinite(division[name]) || division[name] < 0) {
            problems.push(`${path}.${name} must be a finite non-negative number`);
        }
    }
}

function checkPositive(value, path, problems) {
    if (!Number.isFinite(value) || value <= 0) {
        problems.push(`${path} must be a finite positive number`);
    }
}

function isFold(fold) {
    if (!isObject(fold)
        || !FOLD_POSTURES.has(fold.posture)
        || !FOLD_DISPLAYS.has(fold.display)
        || !isObject(fold.division)
        || !DIVISION_ORIENTATIONS.has(fold.division.orientation)
        || !isObject(fold.viewport)) {
        return false;
    }
    for (const name of ['x', 'y', 'width', 'height']) {
        if (!Number.isFinite(fold.division[name]) || fold.division[name] < 0) return false;
    }
    return Number.isFinite(fold.viewport.width)
        && fold.viewport.width > 0
        && Number.isFinite(fold.viewport.height)
        && fold.viewport.height > 0;
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkKnownStates(states, mapName) {
    for (const stateName of Object.keys(states)) {
        if (!DUO_STATES.includes(stateName)) {
            throw new TypeError(`Unknown Duo state "${stateName}" in ${mapName}`);
        }
    }
}

function sameKeys(actual, expected) {
    return actual.length === expected.length && expected.every((key) => actual.includes(key));
}

function isIsoTimestamp(value) {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    if (!match) return false;

    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
    const offsetHour = match[7] === undefined ? undefined : Number(match[7]);
    const offsetMinute = match[8] === undefined ? undefined : Number(match[8]);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, 0);
    const datePartsMatch = date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day
        && date.getUTCHours() === hour
        && date.getUTCMinutes() === minute
        && date.getUTCSeconds() === second;
    const offsetIsValid = offsetHour === undefined
        || (offsetHour <= 23 && offsetMinute <= 59);
    return datePartsMatch && offsetIsValid;
}
