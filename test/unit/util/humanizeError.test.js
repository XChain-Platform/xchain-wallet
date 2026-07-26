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

    // D-42: a backend index that is behind is neither a funds problem nor a
    // rejection - the transaction was never built. Observed live as
    // "Encoder RPC error: utxo-tracker is lagging by 97 blocks; refusing to
    // fetch UTXOs", which the Mint form reduced to a bare "Couldn't mint."
    it('recognizes a backend index that is behind or halted', () => {
        const out = humanizeError(
            new Error('Encoder RPC error: utxo-tracker is lagging by 97 blocks; refusing to fetch UTXOs'),
            'mint',
        );
        expect(out.cause).to.equal('backend_behind');
        expect(out.message).to.match(/catching up with the chain/i);
        expect(out.message).to.match(/try again/i);
    });

    it('classifies a halted decoder as behind, not as a rejection', () => {
        // "refusing" would otherwise match the rejected branch and tell the
        // user the network rejected a transaction that was never broadcast.
        const out = humanizeError(new Error('decoder is HALTED; refusing to roll back further'), 'send');
        expect(out.cause).to.equal('backend_behind');
    });

    // D-42: the module's contract is that the raw message is "never lost", but
    // every call site renders `message` alone, so an unrecognized error used to
    // reach the user as a dead end with no cause at all.
    it('keeps the raw detail in the message for unrecognized errors', () => {
        const out = humanizeError(new Error('sendToken: params.TICK is required'), 'send');
        expect(out.cause).to.equal('unknown');
        expect(out.message).to.equal("Couldn't send. sendToken: params.TICK is required");
        expect(out.raw).to.equal('sendToken: params.TICK is required');
    });

    it('uses the verb in the fallback copy', () => {
        expect(humanizeError(new Error('boom'), 'stake').message).to.equal("Couldn't stake. boom");
    });

    it('says only the generic line when there is no detail to add', () => {
        expect(humanizeError(null, 'stake').message).to.equal("Couldn't stake.");
    });

    it('handles null / undefined / non-Error inputs without throwing', () => {
        expect(humanizeError(null, 'send').cause).to.equal('unknown');
        expect(humanizeError(undefined, 'send').raw).to.equal('');
        const strOut = humanizeError('insufficient balance', 'send');
        expect(strOut.cause).to.equal('insufficient_funds');
        expect(strOut.raw).to.equal('insufficient balance');
    });
});
