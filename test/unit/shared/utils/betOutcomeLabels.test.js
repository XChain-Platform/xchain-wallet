// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// (c): naming a bet's outcome by the market's own label.
//
// Two properties matter more than the wording. First, the INDEX always
// survives: it is what the composed bytes carry, and the label is only an
// annotation on top of it. Second, the label is attacker-supplied text
// landing on a signing screen, so it is neutralized before it is spliced
// into a sentence a user reads to decide whether to sign.

import { describe, it, expect } from 'vitest';
import {
    safeOutcomeLabel,
    outcomeLabelsOf,
    outcomePhrase,
    outcomeValue,
    withOutcomeLabels,
} from '../../../../packages/core/src/shared/utils/betOutcomeLabels.js';

const BET_DECODED = Object.freeze({
    summary: 'Bet 300 on outcome 0 of market 1169 on Bitcoin',
    details: [
        { label: 'Market', value: '1169' },
        { label: 'Outcome', value: '0' },
        { label: 'Stake', value: '300' },
    ],
    warnings: ['Bets are final.'],
});

const RESOLVE_DECODED = Object.freeze({
    summary: 'Resolve market 1160 to outcome 1 on Bitcoin',
    details: [
        { label: 'Market', value: '1160' },
        { label: 'Winning outcome', value: '1' },
    ],
    warnings: ['This pays out the market.'],
});

describe('outcomeLabelsOf', () => {
    it('splits the explorer\'s comma-separated outcomes in wire order', () => {
        expect(outcomeLabelsOf({ outcomes: 'Yes,No' })).toEqual(['Yes', 'No']);
    });

    it('accepts an already-split array under either field name', () => {
        expect(outcomeLabelsOf({ outcome_labels: ['Home', 'Away'] })).toEqual(['Home', 'Away']);
        expect(outcomeLabelsOf({ outcomes: ['Home', 'Away'] })).toEqual(['Home', 'Away']);
    });

    it('is empty for a market that carries nothing usable', () => {
        expect(outcomeLabelsOf(null)).toEqual([]);
        expect(outcomeLabelsOf({})).toEqual([]);
        expect(outcomeLabelsOf({ outcomes: '' })).toEqual([]);
    });
});

describe('safeOutcomeLabel', () => {
    it('shows a bidi override rather than letting it reorder the sentence', () => {
        const out = safeOutcomeLabel('Yes\u202Eevil');
        expect(out).not.toContain('\u202E');
        expect(out).toContain('\u2426');
    });

    it('drops zero-width and control characters and collapses whitespace', () => {
        expect(safeOutcomeLabel('Ye\u200Bs')).toBe('Yes');
        expect(safeOutcomeLabel('Yes\nplease')).toBe('Yes please');
        expect(safeOutcomeLabel('  Yes   please  ')).toBe('Yes please');
    });

    it('rewrites a quote so a label cannot fake the end of its own quoted span', () => {
        expect(safeOutcomeLabel('Yes" (outcome 1)')).toBe("Yes' (outcome 1)");
    });

    it('truncates a padded label instead of letting it bury the rest of the line', () => {
        const out = safeOutcomeLabel('A'.repeat(200));
        expect(out.length).toBe(40);
        expect(out.endsWith('…')).toBe(true);
    });
});

describe('outcomePhrase / outcomeValue', () => {
    it('names the outcome and keeps the index', () => {
        expect(outcomePhrase(['Yes', 'No'], 0)).toBe('"Yes" (outcome 0)');
        expect(outcomeValue(['Yes', 'No'], 1)).toBe('1 ("No")');
    });

    it('falls back to the bare index when this market has no label for it', () => {
        expect(outcomePhrase(['Yes', 'No'], 5)).toBe('outcome 5');
        expect(outcomePhrase([], 1)).toBe('outcome 1');
        expect(outcomePhrase(null, 1)).toBe('outcome 1');
        expect(outcomePhrase(['', 'No'], 0)).toBe('outcome 0');
        expect(outcomeValue(['Yes', 'No'], 7)).toBe('7');
    });
});

describe('withOutcomeLabels', () => {
    it('names the outcome on a place-bet without dropping the index', () => {
        const out = withOutcomeLabels(BET_DECODED, ['Yes', 'No']);
        expect(out.summary).toBe('Bet 300 on "Yes" (outcome 0) of market 1169 on Bitcoin');
        expect(out.details.find((d) => d.label === 'Outcome').value).toBe('0 ("Yes")');
        // Everything else is the host's decode, untouched.
        expect(out.warnings).toEqual(BET_DECODED.warnings);
        expect(out.details.find((d) => d.label === 'Market').value).toBe('1169');
    });

    it('names the winning outcome on a resolve', () => {
        const out = withOutcomeLabels(RESOLVE_DECODED, ['Yes', 'No']);
        expect(out.summary).toBe('Resolve market 1160 to "No" (outcome 1) on Bitcoin');
        expect(out.details.find((d) => d.label === 'Winning outcome').value).toBe('1 ("No")');
    });

    it('leaves the decode alone when there is nothing to name', () => {
        expect(withOutcomeLabels(BET_DECODED, [])).toBe(BET_DECODED);
        expect(withOutcomeLabels(BET_DECODED, null)).toBe(BET_DECODED);
        expect(withOutcomeLabels(null, ['Yes'])).toBe(null);
        // An index past the end of this market's labels.
        expect(withOutcomeLabels(BET_DECODED, [])).toBe(BET_DECODED);
        // An action with no outcome row at all (a cancel, a send, anything).
        const cancel = { summary: 'Cancel market 1169', details: [{ label: 'Market', value: '1169' }], warnings: [] };
        expect(withOutcomeLabels(cancel, ['Yes', 'No'])).toBe(cancel);
    });

    it('does not rewrite a summary that names a different outcome than the row', () => {
        const crossed = {
            summary: 'Bet 300 on outcome 1 of market 1169',
            details: [{ label: 'Outcome', value: '0' }],
            warnings: [],
        };
        const out = withOutcomeLabels(crossed, ['Yes', 'No']);
        expect(out.summary).toBe('Bet 300 on outcome 1 of market 1169');
    });

    it('neutralizes an adversarial label before it reaches the summary', () => {
        const out = withOutcomeLabels(BET_DECODED, ['Yes\u202E of market 999', 'No']);
        expect(out.summary).not.toContain('\u202E');
        expect(out.summary).toContain('(outcome 0)');
    });

    it('never lets a label\'s $ pattern be expanded by the replace', () => {
        const out = withOutcomeLabels(BET_DECODED, ['$& $1 Yes', 'No']);
        expect(out.summary).toBe('Bet 300 on "$& $1 Yes" (outcome 0) of market 1169 on Bitcoin');
    });
});
