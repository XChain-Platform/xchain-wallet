// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-118: an SDK params-builder refusal must not reach a user as a log line.
//
// FOUND LIVE, not by reading: a zero stake on a real Litecoin regtest market
// put "betting.placeBetParams: amount must be a positive stake" in the alert a
// user reads to find out what they did wrong. The refusal is correct and
// nothing was broadcast - the wording is the defect.
//
// The three properties below are the ones that make this a mapper rather than
// a string replacement:
//   1. the named refusals say something the raw text does not;
//   2. an UNMAPPED builder message still loses the `namespace.builder:` prefix,
//      because there are hundreds of them and a mapper that only helps the ones
//      someone remembered to enumerate is a promise it cannot keep;
//   3. errors that are NOT builder refusals are left alone, so this cannot
//      swallow an encoder or broadcast failure that has its own sentence.

import { describe, it, expect } from 'vitest';
import {
    isSdkValidationError,
    validationErrorMessage,
} from '../../../packages/core/src/sdk/validationErrors.js';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

/** The shape that crosses the messaging boundary: name and message only. */
function boundaryError(message) {
    const err = new Error(message);
    err.name = 'SDKValidationError';
    return err;
}

describe('validationErrorMessage', () => {
    it('names what to do about the refusal that was found live', () => {
        const msg = validationErrorMessage(
            boundaryError('betting.placeBetParams: amount must be a positive stake'));
        expect(msg).toBe('Enter a stake greater than zero.');
        expect(msg, 'the builder name is still on screen').not.toMatch(/placeBetParams|betting\./);
    });

    it('strips the builder prefix from a refusal nobody has mapped', () => {
        const msg = validationErrorMessage(
            boundaryError('betting.createBetFeedParams: DETAILS is not parseable JSON'));
        expect(msg).toBe('DETAILS is not parseable JSON.');
        expect(msg).not.toMatch(/createBetFeedParams|betting\./);
    });

    it('quotes the offending value back when the rule is about a specific one', () => {
        expect(validationErrorMessage(
            boundaryError('betting.createBetFeedParams: duplicate outcome "Yes"')))
            .toBe('Two outcomes have the same name ("Yes"). Each outcome must be different.');
    });

    it('recognises a builder refusal that lost its name in transit', () => {
        const plain = new Error('betting.placeBetParams: amount is required');
        expect(isSdkValidationError(plain), 'the message shape alone should identify it').toBe(true);
        expect(validationErrorMessage(plain)).toBe('Enter the amount you want to stake.');
    });

    it('claims nothing that is not a builder refusal', () => {
        expect(isSdkValidationError(new Error('Network request failed'))).toBe(false);
        expect(validationErrorMessage(new Error('Network request failed'))).toBeNull();
        expect(validationErrorMessage(null)).toBeNull();
        expect(validationErrorMessage('a string')).toBeNull();
    });
});

describe('submitFailureMessage routes builder refusals', () => {
    it('maps the refusal instead of falling through to the form copy', () => {
        expect(submitFailureMessage(
            boundaryError('betting.placeBetParams: amount must be a positive stake'),
            { fallback: 'Bet failed.' },
        )).toBe('Enter a stake greater than zero.');
    });

    it('still prefers the form copy for an error it does not recognise', () => {
        expect(submitFailureMessage(new Error('kaboom'), { fallback: 'Bet failed.' }))
            .toBe('Bet failed.');
    });

    it('does not shadow an encoder failure, which has its own sentence', () => {
        const enc = new Error('no spendable UTXOs found for the funding address');
        enc.name = 'SDKEncoderError';
        const msg = submitFailureMessage(enc, { coinTicker: 'LTC', fallback: 'Bet failed.' });
        expect(msg).not.toBe('Bet failed.');
        expect(msg).not.toMatch(/UTXO/i);
    });
});
