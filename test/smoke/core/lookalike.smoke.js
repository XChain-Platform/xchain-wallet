// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive — Step 2 — lookalike helper.

import { strict as assert } from 'node:assert';
import {
    levenshtein,
    similarity,
    findLookalike,
} from '../../../packages/core/src/shared/utils/lookalike.js';

// --- levenshtein basics --------------------------------------------------

assert.equal(levenshtein('abc', 'abc'), 0);
assert.equal(levenshtein('abc', ''), 3);
assert.equal(levenshtein('', 'abc'), 3);
assert.equal(levenshtein('kitten', 'sitting'), 3, 'classic test case');
assert.equal(levenshtein('saturday', 'sunday'), 3);
assert.equal(levenshtein('abc', 'abd'), 1, 'single substitution');
assert.equal(levenshtein('abc', 'abcd'), 1, 'single insertion');
assert.equal(levenshtein(null, 'abc'), Infinity, 'non-string → Infinity');

// --- similarity ----------------------------------------------------------

assert.equal(similarity('abc', 'abc'), 1, 'identical → 1');
assert.equal(similarity('', ''), 1, 'both empty → 1');
assert.equal(similarity('abc', 'xyz'), 0, 'totally different → 0');
const half = similarity('abcd', 'abxy');
assert.ok(half > 0.49 && half < 0.51, `half-different ≈ 0.5 (got ${half})`);

// --- findLookalike: basic match ------------------------------------------

const known = [
    { address: 'bc1qrealaddressonexamplecharsxx', label: 'Alice' },
    { address: 'bc1qotheraddressonexamplecharsx', label: 'Bob' },
];

const exact = findLookalike({ address: 'bc1qrealaddressonexamplecharsxx', candidates: known });
assert.equal(exact, null, 'exact match → no warning');

// One char different from Alice
const sneaky = 'bc1qrealaddressonexamplechars0x'; // last 'xx' → 'x0x' (one substitution + length stays)
// Better: change one char in the middle
const sneaky2 = 'bc1qreaIaddressonexamplecharsxx'; // l → I
const hit = findLookalike({ address: sneaky2, candidates: known });
assert.ok(hit, 'one-char-off match found');
assert.equal(hit.match.label, 'Alice');
assert.equal(hit.distance, 1);

// Totally different address → no hit
const miss = findLookalike({ address: 'totallydifferentaddressxxxxxx', candidates: known });
assert.equal(miss, null, 'unrelated address → no hit');

// --- findLookalike: edge cases ------------------------------------------

// Short input → no match (avoid matching half-typed input)
assert.equal(findLookalike({ address: 'bc1q', candidates: known }), null);
assert.equal(findLookalike({ address: 'bc1q', candidates: known, minLength: 4 }), null,
    'still null because match itself is too long for the short input');

// Threshold above the actual score → no match
const tooStrict = findLookalike({
    address: sneaky2,
    candidates: known,
    threshold: 0.999,
});
assert.equal(tooStrict, null, 'threshold above score suppresses match');

// maxDistance gate
const tooFar = findLookalike({
    address: sneaky2,
    candidates: known,
    maxDistance: 0,
});
assert.equal(tooFar, null, 'maxDistance=0 with distance 1 suppresses match');

// Empty candidates → null
assert.equal(findLookalike({ address: 'bc1qsomeaddress00000000000000', candidates: [] }), null);

// Picks the best (highest score) when multiple qualify
const multi = findLookalike({
    address: 'bc1qrealaddressonexamplechars0x', // 1 char off Alice
    candidates: [
        { address: 'bc1qotheraddressonexamplechars0', label: 'Bob' }, // ~5 off
        { address: 'bc1qrealaddressonexamplecharsxx', label: 'Alice' }, // 1 off
    ],
});
assert.ok(multi);
assert.equal(multi.match.label, 'Alice', 'best score wins');

console.log('lookalike smoke OK');
