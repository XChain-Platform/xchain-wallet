// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

//  §3.6: the general-purpose neutralizer `betOutcomeLabels.js`'s
// `safeOutcomeLabel` and `uri/xchainUri.js`'s `hardenUriIntentText` both
// build on. Codepoints are constructed via String.fromCharCode rather than
// embedded as literal characters or \u escapes in this file's source, so
// what the test asserts is never ambiguous with what a reader's editor
// renders.

import { describe, it, expect } from 'vitest';
import {
    neutralizeControlText,
    BIDI_PLACEHOLDER,
} from '../../../../packages/core/src/shared/utils/textHardening.js';

const RLO = String.fromCharCode(0x202E); // RIGHT-TO-LEFT OVERRIDE
const ZWSP = String.fromCharCode(0x200B); // ZERO WIDTH SPACE
const BOM = String.fromCharCode(0xFEFF);
const NUL = String.fromCharCode(0x0000);

describe('neutralizeControlText', () => {
    it('is empty for null/undefined and stringifies everything else', () => {
        expect(neutralizeControlText(null)).toBe('');
        expect(neutralizeControlText(undefined)).toBe('');
        expect(neutralizeControlText(42)).toBe('42');
    });

    it('replaces a bidi override with the visible placeholder rather than dropping it', () => {
        const out = neutralizeControlText(`Yes${RLO}evil`);
        expect(out).not.toContain(RLO);
        expect(out).toContain(BIDI_PLACEHOLDER);
        expect(out).toBe(`Yes${BIDI_PLACEHOLDER}evil`);
    });

    it('drops zero-width characters and BOM without a trace', () => {
        expect(neutralizeControlText(`Ye${ZWSP}s`)).toBe('Yes');
        expect(neutralizeControlText(`${BOM}Yes`)).toBe('Yes');
    });

    it('turns a NUL and other C0 controls into a space, then collapses it', () => {
        expect(neutralizeControlText(`TICK${NUL}X`)).toBe('TICK X');
        expect(neutralizeControlText('Yes\r\nplease')).toBe('Yes please');
    });

    it('collapses whitespace runs and trims the ends', () => {
        expect(neutralizeControlText('  Yes   please  ')).toBe('Yes please');
    });

    it('leaves ordinary text untouched', () => {
        expect(neutralizeControlText('Pay rent')).toBe('Pay rent');
        expect(neutralizeControlText('')).toBe('');
    });

    it('does not truncate when no maxLength is given (the deep-link callers\' case)', () => {
        const long = 'A'.repeat(200);
        expect(neutralizeControlText(long)).toBe(long);
    });

    it('truncates with an ellipsis when maxLength is given (the label caller\'s case)', () => {
        const out = neutralizeControlText('A'.repeat(200), { maxLength: 40 });
        expect(out.length).toBe(40);
        expect(out.endsWith('…')).toBe(true);
    });
});
