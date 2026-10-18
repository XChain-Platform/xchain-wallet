// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A confirm-lane tamper refusal reaches the form as the wallet's own sentence.
// Forms hand `err.message` over as their fallback, and the tail of
// submitFailureMessage distrusts a fallback that only repeats the raw error, so
// the tamper branch is what keeps a refused Taproot reveal from reading as the
// generic "Something went wrong. Try again." line.

import { describe, expect, it } from 'vitest';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { TamperDetectedError } from '../../../packages/core/src/flows/confirmChecks.js';

const MISMATCH = 'The action encoded in the transaction does not match what you approved.';
const GENERIC = "Couldn't complete this. Something went wrong. Try again.";

describe('submitFailureMessage on a tamper refusal', () => {
    it('shows the refusal, not the generic line, when the form passes the message as fallback', () => {
        const err = new TamperDetectedError(MISMATCH, { reason: 'REVEAL_CARRIER_BINDING' });
        const copy = submitFailureMessage(err, { coinTicker: 'BTC', fallback: err.message });
        expect(copy).toBe(`${MISMATCH} Nothing was signed.`);
        expect(copy).not.toBe(GENERIC);
    });

    it('recognises the refusal by name alone, as it arrives across the messaging boundary', () => {
        const wire = { name: 'TamperDetectedError', message: MISMATCH };
        expect(submitFailureMessage(wire, { fallback: wire.message })).toBe(`${MISMATCH} Nothing was signed.`);
    });

    it('keeps the output-count wording of an injected-output refusal', () => {
        const err = new TamperDetectedError('The transaction contains 1 output(s) you did not approve.');
        expect(submitFailureMessage(err, { fallback: 'Publish failed.' }))
            .toBe('The transaction contains 1 output(s) you did not approve. Nothing was signed.');
    });

    it('still filters wire text out of a tamper message', () => {
        const wire = { name: 'TamperDetectedError', message: 'refused at https://private.example/RBTC/api/x' };
        expect(submitFailureMessage(wire, { fallback: wire.message })).toBe(GENERIC);
    });
});
