// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The rule half: what the wallet will let a user coin.
//
// The subject here is a DELTA against the chain, not a taste in names, so the
// cases below are anchored to the indexer's own constants rather than invented:
// TICK_CHARACTERS and the 1..250 length band from `xchain-indexer/src/config.js`,
// and the structural refusals from `xchain-indexer/src/actions/issue.js`
// (`invalid: TICK (period)`, `invalid: TICK (id)`).
//
// Teeth: restore `/^[A-Za-z0-9]+$/` in either authoring surface and the symbol
// and lowercase cases here fail. Delete the caret guard and the caret case
// fails. Drop the dot-structure rules and three cases fail.

import { describe, it, expect } from 'vitest';
import {
    ALLOWED_TICKER_CHARACTERS,
    MAX_TICKER_LENGTH,
    MIN_TICKER_LENGTH,
    TICKER_HINT,
    isAuthorableTicker,
    tickerGrammarError,
} from '../../../packages/core/src/shared/utils/tickerGrammar.js';

/** Quoted from xchain-indexer/src/config.js, so the delta below is measured. */
const CHAIN_TICK_CHARACTERS =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789~!@#$%^&*()_+-={}[]:<>.?';

describe('ticker grammar', () => {
    describe('the allowlist tracks the chain, minus exactly one character', () => {
        it('differs from TICK_CHARACTERS only by the caret', () => {
            // Written as a set difference rather than as a literal string
            // compare so a future widening reads as one character moving,
            // and so the assertion names WHICH character if it ever drifts.
            const chain = new Set(CHAIN_TICK_CHARACTERS);
            const wallet = new Set(ALLOWED_TICKER_CHARACTERS);
            const missing = [...chain].filter((c) => !wallet.has(c));
            const extra = [...wallet].filter((c) => !chain.has(c));
            expect(missing).toEqual(['^']);
            expect(extra,
                'the wallet allows a character the chain will refuse at ISSUE time')
                .toEqual([]);
        });

        it('carries the chain length band, not one of its own', () => {
            expect(MIN_TICKER_LENGTH).toBe(1);
            expect(MAX_TICKER_LENGTH).toBe(250);
        });

        it('discloses the rule without promising uppercase', () => {
            // The old hint said "A-Z, 0-9. Uppercase.", which was the only
            // disclosure a user got that the field rewrote what they typed.
            expect(TICKER_HINT).not.toMatch(/uppercase/i);
            expect(TICKER_HINT).toMatch(/250/);
        });
    });

    describe('shapes the chain accepts, that the wallet does not refuse', () => {
        // Every one of these read `status: valid` at a regtest venue's own
        // /feequote, which is why refusing them was the wallet's defect.
        const accepted = [
            ['symbol, dollar', 'JDOG$'],
            ['symbol, bang', 'WOW!'],
            ['symbol, tilde inside', 'A~B'],
            ['symbol, hyphen', 'TGR123-1'],
            ['symbol, underscore', 'TGR123_1'],
            ['symbol, percent', 'TGR123%1'],
            ['symbol, hash', 'TGR123#1'],
            ['symbol, brackets', 'TGR[1]{2}'],
            ['symbol, angle and colon', 'A<B>C:D'],
            ['symbol, question mark', 'WHO?'],
            ['lowercase', 'jdogtest'],
            ['mixed case', 'JDog'],
            ['one character', 'F'],
            ['digits only', '999999'],
        ];

        it.each(accepted)('accepts a %s ticker', (_klass, tick) => {
            expect(tickerGrammarError(tick), `"${tick}" was refused`).toBeNull();
            expect(isAuthorableTicker(tick)).toBe(true);
        });

        it('accepts a ticker at exactly MAX_TICK_LENGTH', () => {
            expect(tickerGrammarError('A'.repeat(MAX_TICKER_LENGTH))).toBeNull();
        });

    });

    describe('the dot is a separator, so only reference fields take it', () => {
        // A dot is a legal TICK character and it is NOT a character: issue.js
        // splits on it and reads the head as the parent. Letting a COINING
        // field take one turns a local refusal into one the chain charges a
        // miner fee to deliver.
        it('refuses a dot in a name being coined, and says where subtokens are made', () => {
            expect(tickerGrammarError('PARENT.CHILD'))
                .toMatch(/cannot contain a dot.*Subtoken template/);
        });

        it('accepts a dotted reference, at any depth', () => {
            expect(tickerGrammarError('PARENT.CHILD', { allowDot: true })).toBeNull();
            expect(tickerGrammarError('PARENT.CHILD.GRAND', { allowDot: true })).toBeNull();
        });

        it('accepts an undotted name in a reference field too', () => {
            expect(tickerGrammarError('PARENT', { allowDot: true })).toBeNull();
        });
    });

    describe('the caret stays closed', () => {
        // Valid at the fee quote and murky past it: `createTicker` never
        // inserts a literal `^…` row, so a caret ISSUE can land valid with a
        // NULL ticker id. Refused here until that admission path is settled.
        it('refuses the tick-ID form', () => {
            expect(tickerGrammarError('^999999')).toMatch(/reserved for token IDs/);
        });

        it('refuses a caret anywhere in the name, not just as a prefix', () => {
            expect(tickerGrammarError('A^B')).toMatch(/reserved for token IDs/);
        });

        it('names the caret rather than shrugging at the character class', () => {
            // A user typing `^123` is reaching for a real wire form on
            // purpose; "that character is not allowed" would not tell them
            // anything they could act on.
            expect(tickerGrammarError('^123')).not.toMatch(/can only use/);
        });
    });

    describe('what the chain refuses, the form still refuses', () => {
        it('refuses an empty ticker, and names the field', () => {
            expect(tickerGrammarError('')).toBe('Ticker is required.');
            expect(tickerGrammarError('   ')).toBe('Ticker is required.');
            expect(tickerGrammarError('', { noun: 'Token name' }))
                .toBe('Token name is required.');
        });

        it('refuses one character past MAX_TICK_LENGTH', () => {
            expect(tickerGrammarError('A'.repeat(MAX_TICKER_LENGTH + 1)))
                .toMatch(/longer than 250/);
        });

        it('refuses a leading or trailing dot, which the chain calls TICK (period)', () => {
            // Asserted on a REFERENCE field, because a coining field never gets
            // this far: it refuses the dot outright a step earlier.
            expect(tickerGrammarError('.ABC', { allowDot: true }))
                .toMatch(/start or end with a dot/);
            expect(tickerGrammarError('ABC.', { allowDot: true }))
                .toMatch(/start or end with a dot/);
        });

        it('refuses an empty level between dots', () => {
            // `A..B` splits to an empty parent segment, so the chain looks for
            // a parent named `A.` and never finds it.
            expect(tickerGrammarError('A..B', { allowDot: true })).toMatch(/empty level/);
        });

        it('refuses the two protocol delimiters', () => {
            // A pipe separates fields and a semicolon separates actions, so
            // neither is in TICK_CHARACTERS and issue.js rejects both by name.
            expect(tickerGrammarError('A|B')).toMatch(/can only use/);
            expect(tickerGrammarError('A;B')).toMatch(/can only use/);
        });

        it('refuses whitespace inside a ticker', () => {
            expect(tickerGrammarError('TWO WORDS')).toMatch(/can only use/);
        });

        it('refuses characters outside the allowlist entirely', () => {
            expect(tickerGrammarError('CAFÉ')).toMatch(/can only use/);
            expect(tickerGrammarError('TOKEN/1')).toMatch(/can only use/);
            expect(tickerGrammarError('BACK\\SLASH')).toMatch(/can only use/);
            expect(tickerGrammarError("QUOTE'D")).toMatch(/can only use/);
        });
    });

    describe('surrounding whitespace is trimmed, not refused', () => {
        it('accepts a padded ticker, because both callers trim before composing', () => {
            expect(tickerGrammarError('  JDOG$  ')).toBeNull();
        });
    });

    it('accepts every character on the allowlist', () => {
        // The cheapest possible proof that the exported string and the regex
        // agree: a character present in one and missing from the other would
        // otherwise only surface when a user typed it.
        //
        // Driven mid-name (`X<char>X`) on a REFERENCE field, because of the
        // dot: it is a legal TICK character, `.` alone is a leading-and-
        // trailing dot the chain refuses, and a coining field refuses it on
        // sight. Both of those are pinned in their own cases above; this one is
        // about the character class and nothing else.
        for (const char of ALLOWED_TICKER_CHARACTERS) {
            expect(tickerGrammarError(`X${char}X`, { allowDot: true }),
                `the allowlist character "${char}" was refused`)
                .toBeNull();
        }
    });
});
