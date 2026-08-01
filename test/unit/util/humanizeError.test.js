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

    // : a dust rejection is the one member of the `rejected` family the
    // user can actually fix, and the generic sentence named neither the amount
    // nor the floor, so retrying the same amount was the obvious next move.
    // Measured live: a 109-sat Bitcoin send got signed, was refused at relay,
    // and all the wallet said was "the network rejected this transaction".
    it('tells a dust rejection apart from a generic one', () => {
        const out = humanizeError(new Error('dust (code -26)'), 'send');
        expect(out.cause).to.equal('rejected');
        expect(out.message).to.match(/below the smallest payment/i);
        expect(out.message).to.not.match(/network rejected/i);
    });

    it('does not read "dust" out of an unrelated word', () => {
        const out = humanizeError(new Error('adjust the fee rate and try again'), 'send');
        expect(out.message).to.not.match(/below the smallest payment/i);
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

    // D-160. The keyword chain reads the message as EVIDENCE, which is right for
    // a wire error and wrong for one the wallet wrote for this user:
    // GatedSendKeysMissingError explains that a send without the unlock key
    // "would be rejected by the network", matched `network`, and came out as a
    // connectivity failure telling the user to retry - on the Send form, which
    // calls this helper directly with no submitFailureMessage in front of it.
    describe('an error that says its own message is user-ready (D-160)', () => {

        /** The real shape: a wallet-authored explanation that names the network. */
        function marked(message) {
            const e = new Error(message);
            e.userFacing = true;
            return e;
        }

        it('passes it through instead of classifying it by keyword', () => {
            const out = humanizeError(marked(
                'PEPE has token-gated content, and this wallet holds none of its 2 unlock key(s). '
                + 'A send without the key(s) attached would be rejected by the network. '
                + 'Recover the keys first, then retry.',
            ), 'send');
            expect(out.cause).to.equal('unknown');
            expect(out.message).to.match(/Recover the keys first/);
            expect(out.message).to.not.match(/check your connection/i);
        });

        it('keeps the house-voice opener, so nothing that reads fine today changes shape', () => {
            expect(humanizeError(marked('Explained in full.'), 'send').message)
                .to.equal("Couldn't send. Explained in full.");
        });

        // The teeth: the same sentence WITHOUT the marker is still eaten, which
        // is what makes this test a pin on the bypass rather than on the wording.
        it('is the marker doing the work, not the phrasing', () => {
            const out = humanizeError(new Error(
                'A send without the key(s) attached would be rejected by the network.',
            ), 'send');
            expect(out.cause).to.equal('network');
        });

        it('does not exempt wire errors, which is the whole point of the helper', () => {
            expect(humanizeError(new Error('fetch failed: ECONNREFUSED'), 'send').cause)
                .to.equal('network');
            expect(humanizeError({ message: 'insufficient funds', userFacing: false }, 'send').cause)
                .to.equal('insufficient_funds');
        });

        // `cause` is a standard Error field that normally holds another ERROR,
        // so only a string is honoured - otherwise a wrapped error would be
        // handed to a consumer expecting a cause KEY.
        it('honours a named cause only when it is a string', () => {
            const withKey = marked('Not enough of this token.');
            withKey.cause = 'insufficient_funds';
            expect(humanizeError(withKey, 'send').cause).to.equal('insufficient_funds');

            const wrapped = marked('Explained in full.');
            wrapped.cause = new Error('inner');
            expect(humanizeError(wrapped, 'send').cause).to.equal('unknown');
        });
    });
});
