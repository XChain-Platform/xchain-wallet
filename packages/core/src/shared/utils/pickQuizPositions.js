// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// pickQuizPositions (§19.2): backup-verification helper.
//
// Picks N random non-adjacent positions out of `totalWords` (skipping
// position 1, which the user just read as the first row of the recovery-
// phrase grid). Used by `CreateWallet.jsx`'s verify stage to build the
// word-quiz blanks.
//
// Cluster H FOLLOWUP 6: count scales with mnemonic length so 24-word
// users get proportional coverage:
//   12 words → 3 positions
//   24 words → 4 positions
// Floor-divide by 6 with a minimum of 3. The minimum keeps short
// custom phrases (e.g. test fixtures) from collapsing to a one-position
// quiz that's trivially solvable.
//
// Non-adjacency prevents a partial-recall user from sliding along
// consecutive words and lucking into the right answers.

/**
 * @param {number} totalWords
 * @returns {number[]} sorted ascending; length === targetCount when totalWords ≥ targetCount * 2
 */
export function pickQuizPositions(totalWords) {
    const targetCount = Math.max(3, Math.floor(totalWords / 6));
    const out = new Set();
    const candidates = [];
    for (let i = 2; i <= totalWords; i++) candidates.push(i);
    // Fisher-Yates shuffle; pick from the end.
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const c of candidates) {
        if (out.size >= targetCount) break;
        let adjacent = false;
        for (const p of out) {
            if (Math.abs(p - c) <= 1) { adjacent = true; break; }
        }
        if (!adjacent) out.add(c);
    }
    return Array.from(out).sort((a, b) => a - b);
}
