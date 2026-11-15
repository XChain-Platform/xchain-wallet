// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
import { describe, it, expect } from 'vitest';
import { submitFailureMessage, submitFailureDetails } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

describe('submitFailureMessage verb', () => {
    const err = new Error('insufficient funds for this transaction');

    it('uses the caller verb in the generic opener', () => {
        const msg = submitFailureMessage(err, { verb: 'send this message', fallback: err.message });
        expect(msg).toContain('send this message');
        expect(msg).not.toContain('complete this');
    });

    it('defaults to the generic verb when none is given', () => {
        const msg = submitFailureMessage(err, { fallback: err.message });
        expect(msg).toContain('complete this');
    });

    it('keeps a flow function prefix out of the sentence and in the details', () => {
        const raw = 'createList: params.TYPE must be "1" (TICK), "2" (ADDRESS), or "3" (UNION)';
        const flowErr = new Error(raw);
        const msg = submitFailureMessage(flowErr, { fallback: flowErr.message });
        expect(msg).not.toContain('createList:');
        expect(submitFailureDetails(flowErr, msg)).toBe(raw);
    });
});
