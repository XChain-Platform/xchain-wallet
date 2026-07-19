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
import { humanizeError } from '../../../packages/core/src/shared/utils/humanizeError.js';

describe('humanizeError', () => {
    it('recognizes insufficient-funds errors', () => {
        const out = humanizeError(new Error('compose: insufficient funds for SEND'), 'send');
        expect(out.cause).to.equal('insufficient_funds');
        expect(out.message).to.match(/enough funds/i);
        expect(out.message.startsWith("Couldn't send.")).to.equal(true);
        expect(out.raw).to.equal('compose: insufficient funds for SEND');
    });

    it('recognizes network errors', () => {
        const out = humanizeError(new Error('fetch failed: ETIMEDOUT'), 'send');
        expect(out.cause).to.equal('network');
        expect(out.message).to.match(/network is unreachable/i);
    });

    it('recognizes node-rejected broadcasts', () => {
        const out = humanizeError(new Error('bad-txns-inputs-missingorspent (code -25)'), 'send');
        expect(out.cause).to.equal('rejected');
        expect(out.message).to.match(/network rejected/i);
    });

    it('falls back to a generic message for unrecognized errors', () => {
        const out = humanizeError(new Error('sendToken: params.TICK is required'), 'send');
        expect(out.cause).to.equal('unknown');
        expect(out.message).to.equal("Couldn't send.");
        expect(out.raw).to.equal('sendToken: params.TICK is required');
    });

    it('uses the verb in the fallback copy', () => {
        expect(humanizeError(new Error('boom'), 'stake').message).to.equal("Couldn't stake.");
    });

    it('handles null / undefined / non-Error inputs without throwing', () => {
        expect(humanizeError(null, 'send').cause).to.equal('unknown');
        expect(humanizeError(undefined, 'send').raw).to.equal('');
        const strOut = humanizeError('insufficient balance', 'send');
        expect(strOut.cause).to.equal('insufficient_funds');
        expect(strOut.raw).to.equal('insufficient balance');
    });
});
