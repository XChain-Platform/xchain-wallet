// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    findLookalike,
    levenshtein,
    similarity,
} from '../../../../packages/core/src/shared/utils/lookalike.js';

describe('lookalike branch coverage', () => {
    it('handles edit-distance edge cases and both row orientations', () => {
        expect(levenshtein(null, 'a')).toBe(Number.POSITIVE_INFINITY);
        expect(levenshtein('same', 'same')).toBe(0);
        expect(levenshtein('', 'abc')).toBe(3);
        expect(levenshtein('abc', '')).toBe(3);
        expect(levenshtein('longer', 'x')).toBe(6);
        expect(levenshtein('x', 'longer')).toBe(6);
        expect(similarity('', '')).toBe(1);
        expect(similarity('kitten', 'sitting')).toBeCloseTo(4 / 7);
    });

    it('rejects absent, short, invalid, and exact candidates', () => {
        expect(findLookalike()).toBeNull();
        expect(findLookalike({ address: 'short' })).toBeNull();
        expect(findLookalike({
            address: 'entered-address',
            minLength: 1,
            candidates: [null, {}, { address: '' }],
        })).toBeNull();
        expect(findLookalike({
            address: 'entered-address',
            minLength: 1,
            candidates: [
                { address: 'xntered-address' },
                { address: 'entered-address' },
            ],
        })).toBeNull();
    });

    it('ranks matching-end candidates by edge strength and score', () => {
        const address = 'abcdefMMMMMMuvwxyz';
        const best = { address: 'abcdeXMMMMMMXvwxyz', label: 'best' };
        const hit = findLookalike({
            address,
            minLength: 1,
            candidates: [
                { address: 'abcdXX111111XXwxyz', label: 'weak edges' },
                { address: 'abcdeX111111Xvwxyz', label: 'low score' },
                best,
                { address: 'abcdXXMMMMMMXXwxyz', label: 'weaker later' },
                { address: 'xbcdefMMMMMMuvwxyz', label: 'near edit later' },
            ],
        });

        expect(hit).toMatchObject({
            match: best,
            kind: 'matching-ends',
            prefixLength: 5,
            suffixLength: 5,
        });
    });

    it('applies length, distance, threshold, and best-score gates to near edits', () => {
        const address = 'aaaaaaaaaabbbbbbbbbb';
        const best = { address: 'xaaaaaaaaabbbbbbbbbb', label: 'distance one' };
        expect(findLookalike({
            address,
            minLength: 1,
            threshold: 0.5,
            maxDistance: 4,
            candidates: [
                { address: `${address}xxx`, label: 'too long' },
                { address: 'xxxxaaaaaabbbbbbbbbx', label: 'too distant' },
                { address: 'xaaaaaaaaabbbbbbbbbx', label: 'distance two' },
                best,
                { address: 'yaaaaaaaaabbbbbbbbbx', label: 'lower score later' },
            ],
        })).toMatchObject({ match: best, kind: 'near-edit', distance: 1 });

        expect(findLookalike({
            address,
            minLength: 1,
            threshold: 0.99,
            maxDistance: 4,
            candidates: [best],
        })).toBeNull();
    });
});
