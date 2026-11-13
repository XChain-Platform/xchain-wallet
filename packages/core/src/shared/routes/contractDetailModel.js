// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pure helpers behind the contract detail page's card and its Functions and
// Mine tabs, derived from the contract row and the first page of its
// execution history, so the page adds no read of its own and none per row.

import { neutralizeControlText } from '../utils/textHardening.js';
import { sanitizeAbi } from './contractResponseShape.js';
import { BET_RANGE_WINDOWS } from './betMarketSeries.js';

/** The call chart offers the bet card's ranges (Home's, without YTD). */
export const CALL_RANGE_WINDOWS = BET_RANGE_WINDOWS;

const FUNCTION_NAME_MAX = 64;
const FUNCTION_SUMMARY_MAX = 160;

/** An execution row's time in unix seconds, or null when it carries none. */
function rowSeconds(row) {
    const raw = Number(row?.timestamp ?? row?.block_time);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw > 1e12 ? Math.floor(raw / 1000) : raw;
}

/** The method an execution row called, hardened, or null for a non-call row. */
export function executionMethodName(row) {
    const raw = row?.method ?? row?.METHOD ?? row?.method_name;
    if (typeof raw !== 'string') return null;
    const clean = neutralizeControlText(raw, { maxLength: FUNCTION_NAME_MAX });
    return clean === '' ? null : clean;
}

/**
 * Calls per time slot over one range, from the execution rows the page loaded.
 *
 * `values` holds `points` counts, oldest slot first, or is null when no row
 * carries a time inside the range. `counted` is how many rows fell inside it.
 * All runs from the oldest loaded call to now.
 *
 * @param {object} args
 * @param {any[]} args.rows
 * @param {string} args.rangeId          a CALL_RANGE_WINDOWS key
 * @param {number} [args.now]            unix seconds
 * @param {number} [args.points]
 * @returns {{ values: number[] | null, counted: number }}
 */
export function callSeries({ rows, rangeId, now = Math.floor(Date.now() / 1000), points = 48 }) {
    const times = (Array.isArray(rows) ? rows : [])
        .map(rowSeconds)
        .filter((t) => t !== null && t <= now)
        .sort((a, b) => a - b);
    if (times.length === 0) return { values: null, counted: 0 };
    const window = CALL_RANGE_WINDOWS[rangeId] ?? CALL_RANGE_WINDOWS['1w'];
    let start = Number.isFinite(window) ? now - window : times[0];
    // One call (or calls in one second) under All still gets an hour to sit in.
    if (now - start < 3600) start = now - 3600;
    const span = now - start;
    const values = new Array(points).fill(0);
    let counted = 0;
    for (const t of times) {
        if (t < start) continue;
        const slot = Math.min(points - 1, Math.floor(((t - start) / span) * points));
        values[slot] += 1;
        counted += 1;
    }
    return { values: counted > 0 ? values : null, counted };
}

/**
 * The loaded execution rows this wallet signed: a row's caller (or source)
 * is one of the wallet's addresses on this chain.
 *
 * @param {any[]} rows
 * @param {string[]} addresses
 */
export function rowsByWallet(rows, addresses) {
    if (!Array.isArray(rows) || !Array.isArray(addresses) || addresses.length === 0) return [];
    const mine = new Set(addresses.map(String));
    return rows.filter((row) => {
        const who = row?.caller ?? row?.source ?? row?.SOURCE;
        return who !== null && who !== undefined && mine.has(String(who));
    });
}

/**
 * The contract's functions for the Functions tab.
 *
 * From the contract's own `abi` when it publishes one: the name, its one-line
 * summary (or the inputs it takes), and `view` when it declares one. A
 * contract with no abi falls back to the methods its loaded history called,
 * which says nothing about what they do, so those carry no tag.
 *
 * Names and summaries are the deployer's text, hardened like the meta strings.
 *
 * @param {any} abiRaw                 the contract row's `abi`
 * @param {any[]} historyRows          the loaded execution rows
 * @returns {{ source: 'abi' | 'history' | 'none', functions: Array<{ name: string, explanation: string, kind: 'read' | 'write' | null }> }}
 */
export function contractFunctions(abiRaw, historyRows) {
    const abi = sanitizeAbi(abiRaw);
    if (abi) {
        const functions = [];
        for (const [rawName, spec] of Object.entries(abi.methods)) {
            const name = neutralizeControlText(rawName, { maxLength: FUNCTION_NAME_MAX });
            if (!name) continue;
            const summary = typeof spec.summary === 'string'
                ? neutralizeControlText(spec.summary, { maxLength: FUNCTION_SUMMARY_MAX })
                : '';
            const params = (spec.params || [])
                .map((p) => neutralizeControlText(p.name, { maxLength: FUNCTION_NAME_MAX }))
                .filter(Boolean);
            const explanation = summary
                || (params.length > 0 ? `Takes ${joinWords(params)}.` : 'Takes no inputs.');
            const kind = spec.view === true ? 'read' : spec.view === false ? 'write' : null;
            functions.push({ name, explanation, kind });
        }
        if (functions.length > 0) return { source: 'abi', functions };
    }
    const counts = new Map();
    for (const row of Array.isArray(historyRows) ? historyRows : []) {
        const name = executionMethodName(row);
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    if (counts.size === 0) return { source: 'none', functions: [] };
    return {
        source: 'history',
        functions: [...counts.entries()].map(([name, n]) => ({
            name,
            explanation: `Called ${n === 1 ? 'once' : `${n} times`} in the recent history.`,
            kind: null,
        })),
    };
}

/**
 * The What It Does text: the contract's own description when it exported
 * one, otherwise a neutral line built from what the page knows of its
 * functions.
 *
 * @param {string | null} description
 * @param {{ source: string, functions: Array<{ name: string, kind: string | null }> }} fns
 */
export function whatItDoesText(description, fns) {
    if (description) return description;
    const list = fns?.functions || [];
    if (fns?.source === 'abi' && list.length > 0) {
        const reads = list.filter((f) => f.kind === 'read').length;
        const names = joinWords(list.slice(0, 4).map((f) => f.name)) + (list.length > 4 ? ', and more' : '');
        const readNote = reads > 0 ? ` ${reads === list.length ? 'All of them only read' : `${reads} of them only read`} its state.` : '';
        return `Its publisher gave no description. It offers ${list.length} function${list.length === 1 ? '' : 's'}: ${names}.${readNote}`;
    }
    if (fns?.source === 'history' && list.length > 0) {
        return `Its publisher gave no description or function list. Recent calls used ${joinWords(list.slice(0, 4).map((f) => f.name))}${list.length > 4 ? ', and more' : ''}.`;
    }
    return 'Its publisher gave no description or function list. Its calls appear under History.';
}

/** "a", "a and b", "a, b and c". */
function joinWords(words) {
    if (words.length <= 1) return words.join('');
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
