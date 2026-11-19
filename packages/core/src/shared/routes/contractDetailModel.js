// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pure helpers behind the contract detail page's identity card, its contract
// functions, its Activity list and the header search, derived from the
// contract row and the page of execution history already loaded, so the page
// adds no read of its own and none per row.

import { neutralizeControlText } from '../utils/textHardening.js';
import { sanitizeAbi } from './contractResponseShape.js';

const FUNCTION_NAME_MAX = 64;
const FUNCTION_SUMMARY_MAX = 160;

/**
 * The header search's test: true when the query is empty or any of the texts
 * holds it, ignoring case. Non-string texts are skipped.
 *
 * @param {string} query
 * @param {...unknown} texts
 */
export function matchesQuery(query, ...texts) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return texts.some((text) => typeof text === 'string' && text.toLowerCase().includes(q));
}

/** A row's number field as a number, or -1 when it carries none. */
function rowNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : -1;
}

/**
 * The loaded activity rows newest first: by block, then by action index
 * within a block. The explorer's own order is kept for rows that tie.
 *
 * @param {any[]} rows
 */
export function newestFirst(rows) {
    return (Array.isArray(rows) ? rows : [])
        .map((row, i) => ({ row, i }))
        .sort((a, b) => (rowNumber(b.row.block_index) - rowNumber(a.row.block_index))
            || (rowNumber(b.row.action_index) - rowNumber(a.row.action_index))
            || (a.i - b.i))
        .map(({ row }) => row);
}

/** The method an execution row called, hardened, or null for a non-call row. */
export function executionMethodName(row) {
    const raw = row?.method ?? row?.METHOD ?? row?.method_name;
    if (typeof raw !== 'string') return null;
    const clean = neutralizeControlText(raw, { maxLength: FUNCTION_NAME_MAX });
    return clean === '' ? null : clean;
}

/**
 * The contract's functions, the Contract Functions rows on the Actions tab.
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
    return 'Its publisher gave no description or function list. Its calls appear under Activity.';
}

/** "a", "a and b", "a, b and c". */
function joinWords(words) {
    if (words.length <= 1) return words.join('');
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
