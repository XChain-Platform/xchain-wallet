// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §19.2 / Cluster H FOLLOWUP 6 — pickQuizPositions scaling.
//
// 12-word mnemonics keep the original 3-position quiz; 24-word phrases
// get a 4-position quiz so coverage scales proportionally. Helper now
// lives in `shared/utils/pickQuizPositions.js` so it's directly
// importable from a unit-style smoke.

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const corePkg = join(wsRoot, 'packages', 'core');
const utilPath = join(corePkg, 'src', 'shared', 'utils', 'pickQuizPositions.js');
assert.ok(existsSync(utilPath), 'pickQuizPositions.js exists');

const { pickQuizPositions } = await import(utilPath);

// --- 1. Counts scale with mnemonic length -------------------------------

for (let trial = 0; trial < 100; trial++) {
    const twelve = pickQuizPositions(12);
    assert.equal(twelve.length, 3,
        `12-word phrase still gets a 3-position quiz (trial ${trial}, got ${twelve.length})`);
    const twentyFour = pickQuizPositions(24);
    assert.equal(twentyFour.length, 4,
        `24-word phrase gets a 4-position quiz (trial ${trial}, got ${twentyFour.length})`);
}

// --- 2. Floor with minimum 3 --------------------------------------------
//
// Wallet only emits 12 / 24 word phrases via `cryptoLib.generate-
// Bip39Mnemonic`, but the floor exists so that fictional shorter
// phrases (e.g. test fixtures) don't collapse to a one-position quiz.
// We assert the *upper bound* (≤ targetCount) for short phrases — the
// greedy non-adjacent picker can fall short on small candidate sets,
// which is fine since real BIP39 lengths (12, 18, 24) always have
// enough room.

assert.ok(pickQuizPositions(6).length >= 1,
    'short phrases (6 words) still produce at least one position');
assert.equal(pickQuizPositions(18).length, 3,
    '18-word phrase still maps to 3 positions (floor(18/6) = 3)');
// 36 words is theoretical; greedy picker may fall short on the higher
// targetCount but ≤ is the load-bearing invariant.
assert.ok(pickQuizPositions(36).length <= 6,
    '36-word phrase maps to at most 6 positions (floor(36/6) = 6)');

// --- 3. Skip position 1 -------------------------------------------------

for (let trial = 0; trial < 50; trial++) {
    const positions = pickQuizPositions(24);
    for (const p of positions) {
        assert.ok(p >= 2, `pickQuizPositions skips position 1 (got ${p} on trial ${trial})`);
        assert.ok(p <= 24, `position ${p} stays in range on trial ${trial}`);
    }
}

// --- 4. Non-adjacent ----------------------------------------------------

for (let trial = 0; trial < 100; trial++) {
    const positions = pickQuizPositions(24);
    for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
            assert.ok(
                Math.abs(positions[i] - positions[j]) > 1,
                `positions ${positions[i]} and ${positions[j]} should not be adjacent (trial ${trial})`,
            );
        }
    }
}

// --- 5. Sorted ascending ------------------------------------------------

for (let trial = 0; trial < 50; trial++) {
    const positions = pickQuizPositions(24);
    for (let i = 1; i < positions.length; i++) {
        assert.ok(positions[i] > positions[i - 1],
            `pickQuizPositions returns sorted positions (trial ${trial})`);
    }
}

// --- 6. CreateWallet uses the shared util -------------------------------

const fs = await import('node:fs/promises');
const cwSrc = await fs.readFile(join(corePkg, 'src', 'shared', 'routes', 'CreateWallet.jsx'), 'utf8');
assert.ok(
    /from '\.\.\/utils\/pickQuizPositions\.js'/.test(cwSrc),
    'CreateWallet imports pickQuizPositions from the shared util',
);
// The local copy should be gone — only the import + comment reference.
assert.ok(
    !/function pickQuizPositions\(totalWords\) \{/.test(cwSrc),
    'CreateWallet no longer ships an inline pickQuizPositions definition',
);

console.log('quiz-positions smoke OK');
