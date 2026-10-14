// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { validationErrorMessage } from '../../../packages/core/src/sdk/validationErrors.js';

function validationError(message) {
    return Object.assign(new Error(message), { name: 'SDKValidationError' });
}

describe('validationErrorMessage additional mappings', () => {
    it.each([
        ['label is required', 'Give the market a question - this is what people see when they browse.'],
        ['tick is required', 'Choose the token bets are placed in.'],
        ['deadline is required', 'Choose when betting closes.'],
        ['deadline must be a positive integer Unix timestamp', 'Choose a valid date and time for betting to close.'],
        ['outcome labels may not be empty', 'Every outcome needs a name.'],
        ['outcome is out of range', 'Choose one of the outcomes listed for this market.'],
    ])('maps "%s"', (body, expected) => {
        expect(validationErrorMessage(validationError(`betting.createBetFeedParams: ${body}`)))
            .toBe(expected);
    });

    it('preserves terminal punctuation in an unmapped validation message', () => {
        expect(validationErrorMessage(validationError('assets.issueParams: ticker is reserved!')))
            .toBe('Ticker is reserved!');
    });

    it.each([
        validationError(''),
        validationError('betting.placeBetParams: '),
    ])('returns null when a named validation error has no problem text', (error) => {
        expect(validationErrorMessage(error)).toBeNull();
    });
});
