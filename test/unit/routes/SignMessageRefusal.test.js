// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';

import { messageRefusalReason } from '../../../packages/core/src/shared/routes/SignMessageForm.jsx';

describe('Sign message refusal wording', () => {
    it('lets ordinary text through', () => {
        expect(messageRefusalReason('Prove control of this wallet address.')).toBeNull();
        expect(messageRefusalReason('café 雪と月')).toBeNull();
        expect(messageRefusalReason('line one\nline two\n')).toBeNull();
    });

    it.each([
        ['a null', 'a\u0000b'],
        ['an escape', 'x\u001b[2Jy'],
        ['a carriage return', 'line\rover'],
        ['a backspace', 'a\bb'],
        ['a delete', 'a\u007fb'],
        ['a C1 control', 'a\u009bb'],
        ['an unpaired high surrogate', 'a\ud800b'],
        ['an unpaired low surrogate', 'a\udc00b'],
    ])('names %s as a control character problem', (_name, text) => {
        expect(messageRefusalReason(text)).toMatch(/control characters/);
    });

    it('keeps tabs, line feeds and paired surrogates', () => {
        expect(messageRefusalReason('a\tb\nc 🚀')).toBeNull();
    });

    it('names the reserved sign-in prefix', () => {
        expect(messageRefusalReason('XChain Sign-In v2 challenge')).toMatch(/reserved for site sign-in/);
    });

    it.each([
        ['a bidi override', 'pay ‮evil‬'],
        ['a zero width space', 'a​b'],
    ])('names %s as a hidden character problem', (_name, text) => {
        expect(messageRefusalReason(text)).toMatch(/invisible, look-alike or direction-control/);
    });

    // Format controls and default-ignorable marks that draw nothing on the
    // review page, so the signed bytes carry text the signer never saw.
    it.each([
        ['a musical beam control', 'pay\u{1D173} 1 unit'],
        ['a musical phrase control', 'pay\u{1D17A} 1 unit'],
        ['a Mongolian variation selector', 'pay᠋ 1 unit'],
        ['the Mongolian fourth variation selector', 'pay᠏ 1 unit'],
        ['a Syriac abbreviation mark', 'pay܏ 1 unit'],
        ['an interlinear annotation anchor', 'pay￹ 1 unit￻'],
        ['a shorthand format control', 'pay\u{1BCA0} 1 unit'],
        ['an Egyptian hieroglyph format control', 'pay\u{13430} 1 unit'],
    ])('names %s, which draws nothing, as a hidden character problem', (_name, text) => {
        expect(messageRefusalReason(text)).toMatch(/invisible, look-alike or direction-control/);
    });

    it('keeps emoji presentation selectors', () => {
        expect(messageRefusalReason('ok ❤️ and ☺︎')).toBeNull();
    });
});
