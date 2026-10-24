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

import {
    actionParamsTextError,
    actionTextSafetyError,
} from '../../../../packages/core/src/shared/utils/actionTextSafety.js';
import { buildActionPsbt } from '../../../../packages/core/src/flows/buildActionPsbt.js';
import { composeForConfirm } from '../../../../packages/core/src/flows/composeForConfirm.js';
import { submitAction } from '../../../../packages/core/src/flows/submitAction.js';
import { memoLengthError } from '../../../../packages/core/src/shared/utils/memoLimit.js';

const HOSTILE_TEXT = [
    ['NUL', '\u0000'],
    ['tab', '\t'],
    ['newline', '\n'],
    ['escape', '\u001b'],
    ['delete', '\u007f'],
    ['Arabic letter mark', '\u061c'],
    ['left-to-right mark', '\u200e'],
    ['right-to-left mark', '\u200f'],
    ['left-to-right embedding', '\u202a'],
    ['right-to-left embedding', '\u202b'],
    ['pop directional formatting', '\u202c'],
    ['left-to-right override', '\u202d'],
    ['right-to-left override', '\u202e'],
    ['left-to-right isolate', '\u2066'],
    ['right-to-left isolate', '\u2067'],
    ['first-strong isolate', '\u2068'],
    ['pop directional isolate', '\u2069'],
    ['zero-width space', '\u200b'],
    ['zero-width non-joiner', '\u200c'],
    ['zero-width joiner', '\u200d'],
    ['word joiner', '\u2060'],
    ['byte-order mark', '\ufeff'],
];

describe('actionTextSafetyError', () => {
    it.each(HOSTILE_TEXT)('refuses %s', (_name, character) => {
        expect(actionTextSafetyError(`before${character}after`, 'Memo')).toMatch(/^Memo cannot contain/);
        expect(memoLengthError(`before${character}after`)).toMatch(/^Memo cannot contain/);
    });

    it('keeps tabs and line breaks in multi-line message and description text', () => {
        expect(actionTextSafetyError('line one\n\tline two\r\n', 'Message')).toBeNull();
        expect(actionTextSafetyError('line one\nline two', 'Description')).toBeNull();
        expect(actionTextSafetyError('bad\u0000text', 'Message')).toMatch(/control characters/);
    });

    it('accepts ordinary printable Unicode, including natural right-to-left text', () => {
        expect(actionTextSafetyError('Café 📦 שלום', 'Memo')).toBeNull();
    });
});

describe('action param text boundary', () => {
    it.each([
        'MEMO', 'MESSAGE', 'PLAINTEXT_MESSAGE', 'NAME', 'TITLE', 'DESCRIPTION',
        'QUESTION', 'OPTIONS', 'LABEL', 'OUTCOMES', 'METHOD', 'CALLBACK_METHOD',
        'CALLBACK_PARAMS', 'PARAMS', 'DETAILS', 'RESOLUTION_CRITERIA', 'SOURCE',
        'CATEGORY', 'OUTCOME_DETAILS', 'URI', 'URL', 'TEXT', 'NOTE',
    ])('refuses hostile %s text in a composed action', (field) => {
        expect(actionParamsTextError({ action: 'TEST', params: { [field]: `safe\u202eevil` } }))
            .toMatch(/text-direction/);
    });

    it('enforces the memo byte ceiling at the common boundary', () => {
        expect(actionParamsTextError({ action: 'TEST', params: { MEMO: 'é'.repeat(125) } })).toBeNull();
        expect(actionParamsTextError({ action: 'TEST', params: { MEMO: `${'é'.repeat(125)}a` } }))
            .toBe('Memo is 251 bytes; the network accepts at most 250 bytes.');
    });

    it('leaves structured and binary action fields untouched', () => {
        expect(actionParamsTextError({
            action: 'FILE',
            params: { RAW_DATA: '\u0000\u202e\u200b', ENCRYPTED_MESSAGE: '\u0000' },
        })).toBeNull();
    });

    it('refuses before compose, watcher build, or signing dependencies run', async () => {
        const actionData = { action: 'LIST', params: { MEMO: 'unsafe\ntext' } };
        await expect(composeForConfirm({ actionData })).rejects.toThrow(/control characters/);
        await expect(buildActionPsbt({
            actionData,
            chainRegistry: {},
            sdkRegistry: {},
            chainId: 'bitcoin-mainnet',
        })).rejects.toThrow(/control characters/);
        await expect(submitAction({ actionData })).rejects.toThrow(/control characters/);
    });
});
