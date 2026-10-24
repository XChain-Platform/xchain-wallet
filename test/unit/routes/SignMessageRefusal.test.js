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

    it('names the reserved sign-in prefix', () => {
        expect(messageRefusalReason('XChain Sign-In v2 challenge')).toMatch(/reserved for site sign-in/);
    });

    it.each([
        ['a bidi override', 'pay ‮evil‬'],
        ['a zero width space', 'a​b'],
    ])('names %s as a hidden character problem', (_name, text) => {
        expect(messageRefusalReason(text)).toMatch(/invisible, look-alike or direction-control/);
    });
});
