// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Fuzz: iconForLabel is a TOTAL function: for any input, it returns
// either a function (icon component) or null. It must never throw.

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { iconForLabel } from '../../../packages/core/src/ui/icons/index.jsx';

const RUNS = Number(process.env.FUZZ_ITERATIONS || 200);

describe('fuzz/icon-for-label', () => {
    it('returns null or a function for any input, never throws', () => {
        fc.assert(
            fc.property(fc.anything(), (input) => {
                const out = iconForLabel(input);
                return out === null || typeof out === 'function';
            }),
            { numRuns: RUNS },
        );
    });

    it('strings of any length / character mix never throw', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 0, maxLength: 1024 }), (s) => {
                const out = iconForLabel(s);
                return out === null || typeof out === 'function';
            }),
            { numRuns: RUNS },
        );
    });
});
