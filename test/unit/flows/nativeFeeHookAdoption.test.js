// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// PC-51 / §11.3: every fee-bearing surface holds the fee mode through useNativeFee.
//
// The hook exists because the flag has to reach up to three submit paths - the legacy
// sign path, the compose preview, and the watcher encode-only path - and a form
// that threaded it through two of them dropped it silently on the third: the action
// composed, broadcast, and then indexed `invalid: insufficient fee (native coin output
// required)` AFTER the miner fee was spent. The hook is also what derives `mandatory`
// per render, which is what makes switching chains mid-form re-derive the rule
// instead of carrying a stale seeded value.
//
// A form that re-implements the flag with its own useState looks identical on screen and
// loses both properties. That is not something a screenshot or a happy-path drive
// catches, so it is pinned structurally here.
//
// Measured when this was written (wallet E2E session 25, §11.3's grep half): 27 surfaces
// mount the toggle, all 27 consume the hook, none holds the flag locally.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED = join(HERE, '..', '..', '..', 'packages', 'core', 'src', 'shared');

// Derived from the tree, never listed: a new fee-bearing form is covered the day it
// mounts the toggle, which is exactly when it starts being able to get this wrong.
function feeBearingSurfaces() {
    const out = [];
    for (const dir of ['components', 'routes']) {
        for (const file of readdirSync(join(SHARED, dir))) {
            if (!file.endsWith('.jsx') || file === 'NativeFeeToggle.jsx') continue;
            const rel = `${dir}/${file}`;
            const src = readFileSync(join(SHARED, rel), 'utf8');
            if (src.includes('NativeFeeToggle')) out.push({ rel, src });
        }
    }
    return out;
}

// A useState whose name says it is holding the fee mode. Deliberately narrow: the point
// is to catch a form re-implementing the hook's job, not to police unrelated state.
const LOCAL_FLAG_STATE = /useState\s*\([^)]*\)\s*;?\s*\/\/[^\n]*native fee/i;
const LOCAL_FLAG_NAMED = /const\s*\[\s*(payFeeInNativeCoin|nativeFeeFlag|payInNative|useNative\w*)\s*,\s*set\w+\s*\]\s*=\s*useState/;

describe('§11.3: the fee mode is held by useNativeFee on every surface that offers it', () => {
    const surfaces = feeBearingSurfaces();

    it('finds the fee-bearing surfaces (guards against an empty sweep)', () => {
        expect(surfaces.length).toBeGreaterThan(20);
    });

    for (const { rel, src } of surfaces) {
        it(`${rel} takes the fee mode from the hook`, () => {
            expect(src, `${rel} mounts NativeFeeToggle without calling useNativeFee. The flag has to `
                + 'reach the legacy sign path, the confirm preview AND the watcher encode-only path, '
                + 'and `mandatory` has to be derived per render so a chain switch re-derives.'
                + 'A local copy silently drops one of those.').toMatch(/useNativeFee/);
            expect(LOCAL_FLAG_NAMED.test(src) || LOCAL_FLAG_STATE.test(src),
                `${rel} appears to hold the native-fee flag in its own useState alongside the hook.`)
                .toBe(false);
        });
    }
});
