// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const LIST_EDIT_ACTIONS = new Set(['DISPENSER', 'ORDER', 'SWAP']);

/** Describe a list edit value, including the activated zero sentinel. */
export function listEditValue(value, kind) {
    return /^0+$/.test(String(value).trim()) ? `Remove ${kind} list` : String(value);
}

/**
 * Replace raw zero values in an SDK description with removal copy. The SDK
 * remains the source of every other word and display-hardening decision.
 *
 * @param {object | null} decoded
 * @param {{ action?: string, version?: unknown, params?: object } | null} parsed
 * @returns {object | null}
 */
export function withListRemovalDescriptions(decoded, parsed) {
    const action = String(parsed?.action || '').toUpperCase();
    const version = String(parsed?.version ?? parsed?.params?.VERSION ?? '0');
    if (!decoded || !LIST_EDIT_ACTIONS.has(action) || version !== '2') return decoded;

    const removals = new Map();
    if (/^0+$/.test(String(parsed?.params?.ALLOW_LIST ?? '').trim())) {
        removals.set('Allow list', 'Remove allow list');
    }
    if (/^0+$/.test(String(parsed?.params?.BLOCK_LIST ?? '').trim())) {
        removals.set('Block list', 'Remove block list');
    }
    if (removals.size === 0) return decoded;

    const details = Array.isArray(decoded.details) ? decoded.details : [];
    const seen = new Set();
    const nextDetails = details.map((row) => {
        if (!removals.has(row?.label)) return row;
        seen.add(row.label);
        return { ...row, value: removals.get(row.label) };
    });
    for (const [label, value] of removals) {
        if (!seen.has(label)) nextDetails.push({ label, value });
    }
    return { ...decoded, details: nextDetails };
}
