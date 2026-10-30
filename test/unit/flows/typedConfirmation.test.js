// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { isExactTypedConfirmation } from '../../../packages/core/src/flows/typedConfirmation.js';

const GATE_WORDS = [
    'CALLBACK',
    'DESTROY',
    'LOCK',
    'PUBLISH',
    'SHARE',
    'SWEEP',
    'TRANSFER',
    'WIPE',
];

describe('typed confirmation gates', () => {
    it.each(GATE_WORDS)('accepts only exact %s', (word) => {
        const titleCase = `${word[0]}${word.slice(1).toLowerCase()}`;
        const invalid = [word.toLowerCase(), ` ${word}`, `${word} `, titleCase];

        for (const typed of invalid) {
            expect(isExactTypedConfirmation(typed, word)).toBe(false);
        }
        expect(isExactTypedConfirmation(word, word)).toBe(true);
    });
});
