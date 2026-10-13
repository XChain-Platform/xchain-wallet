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
    describeUnreadableReason,
    isUnreadableActionReason,
} from '../../../packages/core/src/shared/components/psbtDecodeReasons.js';

const REASONS_BY_DESCRIPTION = {
    'the action is written in a form this wallet cannot read yet': [
        'P2SH_P2WSH_UNSUPPORTED',
        'MULTI_LEG_UNSUPPORTED',
        'REST_FIELD_UNSUPPORTED',
        'BATCH_UNSUPPORTED',
        'MULTI_OP_RETURN',
        'MULTI_ENVELOPE',
        'ENVELOPE_NOT_INPUT_ZERO',
        'ENVELOPE_MIXED_CARRIER',
    ],
    'the action is a type or version this wallet does not recognize': [
        'UNKNOWN_ACTION',
        'BAD_VERSION',
    ],
    'the action data is malformed': [
        'DEOBFUSCATION_FAILED',
        'NOT_UTF8',
        'OVERSIZED',
        'FIELD_COUNT_MISMATCH',
        'INNER_DECOMPILE_FAILED',
        'ENVELOPE_SCRIPT_INVALID',
        'UNEXPECTED_FORMAT',
        'MALFORMED_ACTION_STRING',
        'REST_FIELD_TOO_LONG',
        'PARAM_INVALID',
    ],
};

describe('isUnreadableActionReason', () => {
    it.each(['NO_OP_RETURN', 'NO_MAGIC_WORD'])(
        'treats %s as an absent action',
        (reason) => expect(isUnreadableActionReason(reason)).toBe(false),
    );

    it.each([null, undefined, ''])(
        'does not claim that a missing reason is unreadable',
        (reason) => expect(isUnreadableActionReason(reason)).toBe(false),
    );

    it('treats every documented decode failure as an unreadable action', () => {
        for (const reasons of Object.values(REASONS_BY_DESCRIPTION)) {
            for (const reason of reasons) {
                expect(isUnreadableActionReason(reason), reason).toBe(true);
            }
        }
    });

    it('fails closed for a new non-empty reason', () => {
        expect(isUnreadableActionReason('NEW_DECODER_FAILURE')).toBe(true);
    });
});

describe('describeUnreadableReason', () => {
    it('describes every documented decode failure with its safe plain-language clause', () => {
        for (const [description, reasons] of Object.entries(REASONS_BY_DESCRIPTION)) {
            for (const reason of reasons) {
                expect(describeUnreadableReason(reason), reason).toBe(description);
            }
        }
    });

    it.each([
        'NO_OP_RETURN',
        'NO_MAGIC_WORD',
        'NEW_DECODER_FAILURE',
        'toString',
        '__proto__',
        '',
        null,
        undefined,
        42,
    ])('returns null instead of echoing an unmapped or invalid reason', (reason) => {
        expect(describeUnreadableReason(reason)).toBeNull();
    });
});
