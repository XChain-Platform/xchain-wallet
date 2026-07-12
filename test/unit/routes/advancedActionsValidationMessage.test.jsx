// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the Advanced Actions live-validation alert must always render a human
// (and screen-reader) readable message, never a raw JSON dump of an SDK
// validator error whose shape is not contractual (review finding
// uuid:89bbbc76).

import { describe, it, expect } from 'vitest';
import { formatValidationError } from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';

describe('formatValidationError', () => {
    it('returns a string error as-is', () => {
        expect(formatValidationError('amount too large')).toBe('amount too large');
    });

    it('prefers a message property', () => {
        expect(formatValidationError({ message: 'amount too large', field: 'amount' }))
            .toBe('amount too large');
    });

    it('derives a field-based message when there is no message', () => {
        expect(formatValidationError({ field: 'destination', code: 'BAD_ADDR' }))
            .toBe('destination: invalid value');
    });

    it('falls back to a generic message for a message-less, field-less error', () => {
        expect(formatValidationError({ code: 'UNKNOWN', detail: { nested: true } }))
            .toBe('Invalid value');
    });

    it('never leaks a JSON structure into the message', () => {
        const outputs = [
            formatValidationError({ code: 'X', detail: { a: 1 } }),
            formatValidationError({ field: 'amount' }),
            formatValidationError(null),
            formatValidationError(undefined),
        ];
        for (const out of outputs) {
            expect(out).not.toContain('{');
        }
    });
});
