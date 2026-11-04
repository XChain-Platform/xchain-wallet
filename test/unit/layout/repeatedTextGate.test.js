// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The U18 gate reads repeated text findings as one line each, and the
// rulings allowlist holds no repeated text debt.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULING_KEYS, repeatedTextFailures } from '../../e2e/layout/rulings-gate.js';

describe('repeated text gate', () => {
    it('maps repeatedText to ruling U18', () => {
        expect(RULING_KEYS.repeatedText.ruling).toBe('U18');
    });

    it('prints one line per repeated text finding', () => {
        expect(repeatedTextFailures('Send', { repeatedText: [{ text: 'check the address', count: 2 }] }))
            .toEqual(['Send: "check the address" appears 2 times']);
    });

    it('prints nothing for a screen without repeats', () => {
        expect(repeatedTextFailures('Home', {})).toEqual([]);
        expect(repeatedTextFailures('Home', { repeatedText: [] })).toEqual([]);
    });

    it('holds no repeated text debt in the allowlist', () => {
        const file = resolve(__dirname, '../../e2e/tests/layout/rulings.allowlist.json');
        expect(JSON.parse(readFileSync(file, 'utf8')).repeatedText).toBeUndefined();
    });
});
