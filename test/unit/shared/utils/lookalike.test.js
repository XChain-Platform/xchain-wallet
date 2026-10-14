// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { findLookalike } from '../../../../packages/core/src/shared/utils/lookalike.js';

describe('findLookalike', () => {
    it.each([
        {
            name: 'four characters at each end',
            saved: 'bc1q1111111111111111111111abcd',
            entered: 'bc1qzzzzzzzzzzzzzzzzzzzzzzabcd',
            prefixLength: 4,
            suffixLength: 4,
        },
        {
            name: 'five characters at each end',
            saved: 'bc1qa111111111111111111111abcde',
            entered: 'bc1qazzzzzzzzzzzzzzzzzzzzzabcde',
            prefixLength: 5,
            suffixLength: 5,
        },
        {
            name: 'six or more characters at each end',
            saved: 'bc1qab11111111111111111111zabcdef',
            entered: 'bc1qabzzzzzzzzzzzzzzzzzzzzxabcdef',
            prefixLength: 6,
            suffixLength: 6,
        },
    ])('detects address poisoning with $name', ({
        saved,
        entered,
        prefixLength,
        suffixLength,
    }) => {
        const hit = findLookalike({
            address: entered,
            candidates: [{ address: saved, label: 'Alice', source: 'contact' }],
        });

        expect(hit).toMatchObject({
            match: { address: saved, label: 'Alice' },
            kind: 'matching-ends',
            prefixLength,
            suffixLength,
        });
    });

    it.each([
        {
            name: 'only the first edge matches',
            saved: 'bc1qab11111111111111111111abcdef',
            entered: 'bc1qabzzzzzzzzzzzzzzzzzzzzuvwxyz',
        },
        {
            name: 'only the last edge matches',
            saved: 'bc1qab11111111111111111111abcdef',
            entered: 'ltc1qzzzzzzzzzzzzzzzzzzzzzabcdef',
        },
        {
            name: 'only three characters match at each edge',
            saved: 'bc1x111111111111111111111111ydef',
            entered: 'bc1qzzzzzzzzzzzzzzzzzzzzzzzzdef',
        },
    ])('does not flag when $name', ({ saved, entered }) => {
        expect(findLookalike({
            address: entered,
            candidates: [{ address: saved, label: 'Alice' }],
        })).toBeNull();
    });

    it('does not warn for an identical saved address', () => {
        const address = 'bc1q1111111111111111111111abcdef';

        expect(findLookalike({
            address,
            candidates: [{ address, label: 'Alice' }],
        })).toBeNull();
    });

    it('preserves near-edit typo detection', () => {
        const saved = 'bc1qrealaddressonexamplecharsxx';
        const hit = findLookalike({
            address: 'Bc1qrealaddressonexamplecharsxx',
            candidates: [{ address: saved, label: 'Alice' }],
        });

        expect(hit).toMatchObject({
            match: { address: saved, label: 'Alice' },
            kind: 'near-edit',
            distance: 1,
        });
    });
});
