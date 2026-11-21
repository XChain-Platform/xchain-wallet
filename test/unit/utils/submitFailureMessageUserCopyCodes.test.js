// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An error the wallet raises with a sentence written for the user keeps that
// sentence on a form, instead of the generic failure line.

import { describe, it, expect } from 'vitest';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { USER_COPY_CODES } from '../../../packages/core/src/shared/utils/userFacingMessage.js';

const SENTENCES = {
    ADS_DONATION_STALE: 'The automatic donation changed while this was on screen. Nothing was signed or sent. Review the action again.',
    NATIVE_FEE_CHANGED: 'The network fee changed while this was on screen. Review the new fee and confirm again.',
    INPUTS_SPENT: 'Another payment is already spending these coins. Nothing was sent. Start the payment again.',
    MULTISIG_SIGNATURE_INVALID: 'The reply from your cosigner did not check out. Ask them to sign again.',
    MULTISIG_NONCE_INVALID: 'The cosigner reply was for a different step. Ask them to start again.',
};

describe('submitFailureMessage for user-copy error codes', () => {
    it('covers every code in the user-copy set', () => {
        expect([...USER_COPY_CODES].sort()).toEqual(Object.keys(SENTENCES).sort());
    });

    for (const [code, sentence] of Object.entries(SENTENCES)) {
        it(`shows the sentence for ${code}`, () => {
            const err = Object.assign(new Error(sentence), { code });
            expect(submitFailureMessage(err, { verb: 'issue this token' })).toBe(sentence);
        });

        it(`shows the sentence for ${code} when the form passes its own fallback`, () => {
            const err = Object.assign(new Error(sentence), { code });
            expect(submitFailureMessage(err, { verb: 'issue this token', fallback: 'Something else.' })).toBe(sentence);
        });
    }
});
