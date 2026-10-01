// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const UNION_MAX_LISTS = 16;
export const UNION_MAX_MERGED = 10000;

const UNION_MEMBER_REASON = 'Union lists cannot be members of a union';
const TYPE_REASON = 'A union holds lists of one type';
const LIST_LIMIT_REASON = 'A union holds at most 16 lists';

/**
 * @param {object} args
 * @param {string[]} args.picked
 * @param {{ actionIndex: string, type: '1'|'2'|'3', members?: unknown[] }[]} args.candidates
 * @returns {{
 *   rows: { actionIndex: string, picked: boolean, disabled: boolean, reason: string|null }[],
 *   pickedType: '1'|'2'|'3'|null,
 *   mergedCount: number|null,
 *   overLimit: boolean,
 *   canReview: boolean,
 * }}
 */
export function unionPickState({ picked, candidates }) {
    const candidatesByIndex = new Map(candidates.map((candidate) => [candidate.actionIndex, candidate]));
    const pickedIndexes = new Set(picked.filter((actionIndex) => candidatesByIndex.has(actionIndex)));
    const pickedCandidates = [...pickedIndexes].map((actionIndex) => candidatesByIndex.get(actionIndex));
    const pickedType = pickedCandidates[0]?.type ?? null;

    let mergedCount = null;
    if (pickedCandidates.every((candidate) => Array.isArray(candidate.members))) {
        const merged = new Set();
        pickedCandidates.forEach((candidate) => candidate.members.forEach((member) => merged.add(member)));
        mergedCount = merged.size;
    }

    const rows = candidates.map((candidate) => {
        const isPicked = pickedIndexes.has(candidate.actionIndex);
        let reason = null;
        if (!isPicked && candidate.type === '3') reason = UNION_MEMBER_REASON;
        else if (!isPicked && pickedType !== null && candidate.type !== pickedType) reason = TYPE_REASON;
        else if (!isPicked && pickedIndexes.size >= UNION_MAX_LISTS) reason = LIST_LIMIT_REASON;
        return {
            actionIndex: candidate.actionIndex,
            picked: isPicked,
            disabled: reason !== null,
            reason,
        };
    });

    const overLimit = mergedCount !== null && mergedCount > UNION_MAX_MERGED;
    return {
        rows,
        pickedType,
        mergedCount,
        overLimit,
        canReview: pickedIndexes.size > 0 && !overLimit,
    };
}
