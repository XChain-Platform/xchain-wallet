// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the watcher / air-gapped lane handed out a HALF transaction for any
// action the encoder chunked, with no warning.
//
// `buildActionPsbt` is the whole watcher lane - all three of its callers are
// encode-only (`action.psbt`, buildCoinpayPsbtRequest, buildGatedPublishPsbtRequest)
// - and it produces exactly ONE psbt. A P2SH/P2WSH encoding needs two: the
// commit, which carries no action at all, and the REVEAL that spends its script
// output and is the transaction the indexer reads. `spendP2sh` has exactly one
// call site in the wallet (`submitWithSigner`), which this lane never reaches,
// so the hex it exported could not be completed by anything.
//
// AND IT COSTS COIN TO FIND OUT. The encoder folds the payload's value and
// EVERY custom output's value - the native protocol fee, a Mode B dispenser's
// oracle usage fee , an ADS donation - into the script output, so
// broadcasting the commit alone spends real money into a script only the
// missing reveal can open, and records no action. Measured on Litecoin regtest
// 2026-07-31: a Mode B dispenser is 90 action bytes, past the 80-byte OP_RETURN
// limit, so it takes this lane every time, and its commit carried 0.05005464
// LTC. A gated FILE publish - which has its own watcher entry point - is the
// case most likely to chunk of all.
//
// `DeployContractForm` already reaches this verdict for the chunked-deploy lane
// and says so in words; the refusal now lives in the one place every
// watcher-composed action passes through, so no form has to know.

import { describe, it, expect, vi } from 'vitest';
import { buildActionPsbt, WatcherChunkLaneError } from '../../../packages/core/src/flows/buildActionPsbt.js';
import { humanizeError } from '../../../packages/core/src/shared/utils/humanizeError.js';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

const SOURCE = {
    address: 'rltc1qexampleexampleexampleexampleexampleex',
    publicKey: '03c015d1857ef0227b38b31b0e33157382222da9a45e6e3f558994d7ea7250450f',
    derivationPath: "m/84'/2'/0'/0/0",
};

function harness(encoding) {
    const sdk = {
        actions: {
            createAction: vi.fn(() => ({
                actionString: 'DISPENSER|0|LTC|XCHAIN|5||100|LTC||0||USD||rltc1qoracle|||',
                action: 'DISPENSER',
                version: 0,
            })),
        },
        encoder: { createTx: vi.fn(async () => ({ psbt: '70736274ff', encoding })) },
        explorer: {
            getOracleFeeQuote: vi.fn(async () => ({
                valid: true, oracleAddress: 'rltc1qoracle', requiredFeeSats: 5000000, belowDust: false,
            })),
        },
    };
    return sdk;
}

function build(encoding) {
    const sdk = harness(encoding);
    return buildActionPsbt({
        sdkRegistry: { get: () => sdk },
        chainRegistry: { get: () => ({ coin: 'LTC', networkKind: 'regtest' }) },
        chainId: 'litecoin-regtest',
        from: SOURCE,
        actionData: {
            action: 'DISPENSER',
            params: {
                VERSION: '0', GIVE_COIN: 'LTC', GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '5',
                GIVE_ESCROW: '100', GET_COIN: 'LTC', GET_AMOUNT: '0',
                FIAT_CODE: 'USD', ORACLE_ADDRESS: 'rltc1qoracle',
            },
        },
    });
}

describe('the watcher lane refuses an action it can only half-build', () => {

    it('refuses a P2SH encoding rather than exporting a commit with no reveal', async () => {
        await expect(build('P2SH')).rejects.toThrow(WatcherChunkLaneError);
    });

    it('refuses P2WSH the same way', async () => {
        // The other two-phase encoding. Same shape, same missing reveal.
        await expect(build('P2WSH')).rejects.toThrow(WatcherChunkLaneError);
    });

    it('says what it costs to ignore, and what to do instead', async () => {
        // The remedy is "compose it from the wallet holding the key", not "try
        // again" - so the sentence has to carry it, and it has to say that
        // broadcasting the half anyway spends coin for nothing. A watcher user
        // who reads "failed" and retries loses money on the retry too.
        const err = await build('P2SH').catch((e) => e);
        expect(err.message).toMatch(/wallet holding the key/i);
        expect(err.message).toMatch(/spend coin into a script that nothing can open/i);
        expect(err.encoding).toBe('P2SH');
        expect(err.action).toBe('DISPENSER');
    });

    it('leaves the single-transaction lane alone', async () => {
        // The control, and the reason this is a refusal rather than a blanket
        // block on the lane: an OP_RETURN action is complete in one transaction,
        // which is exactly what a watcher wallet can export and a signer can
        // sign. Most watcher-composed actions are this.
        const out = await build('OP_RETURN');
        expect(out.psbtHex).toBe('70736274ff');
        expect(out.encoding).toBe('OP_RETURN');
    });

    it('is case-insensitive about the encoder\'s spelling', async () => {
        // `isChunkEncoding` upper-cases before comparing, and the encoder has
        // answered lower-case in this tree's own fixtures ('opreturn'). A guard
        // that missed 'p2sh' would be no guard at all.
        await expect(build('p2sh')).rejects.toThrow(WatcherChunkLaneError);
    });
});

// A refusal is only as good as the sentence that reaches the screen, and this
// one had to be rescued from the layer above it. `submitFailureMessage`'s tail
// prefers each form's `fallback` over the raw message, so without a branch of
// its own this error arrives as "Dispenser creation failed." - which reads as a
// transient failure and invites the retry that spends the coin again. Same
// shape as D-121, one layer further out.
describe('the refusal survives the trip to the form', () => {

    it('reaches the user whole, instead of being replaced by the form\'s fallback', () => {
        const err = new WatcherChunkLaneError({ action: 'DISPENSER', encoding: 'P2SH' });
        const copy = submitFailureMessage(err, {
            coinTicker: 'LTC', mandatory: true, fallback: 'Dispenser creation failed.',
        });
        expect(copy).not.toBe('Dispenser creation failed.');
        expect(copy).toMatch(/wallet holding the key/i);
    });

    it('is recognised across the messaging boundary, where the class is gone', () => {
        // The popup receives `{ name, message }` only (MessageHost.serializeError),
        // so an `instanceof` check would match in the tests and never in the
        // extension. This is the shape that actually arrives there.
        const wire = {
            name: 'WatcherChunkLaneError',
            message: new WatcherChunkLaneError({ action: 'FILE', encoding: 'P2WSH' }).message,
        };
        expect(submitFailureMessage(wire, { fallback: 'Publish failed.' }))
            .toMatch(/wallet holding the key/i);
    });

    it('is recognised from the message alone, if even the name is lost', () => {
        const wire = {
            message: new WatcherChunkLaneError({ action: 'FILE', encoding: 'P2SH' }).message,
        };
        expect(submitFailureMessage(wire, { fallback: 'Publish failed.' }))
            .toMatch(/wallet holding the key/i);
    });

    // Found while driving the refusal in a browser (Session 37), and it makes
    // this branch load-bearing on a whole family of forms rather than merely
    // tidier. The six forms behind `useActionForm` (Mint, Destroy, Sweep,
    // CreateOrder, Callback, Sleep) do not pass a plain fallback string: they
    // pass `humanizeError(err, <verb>).message`, which classifies by KEYWORD -
    // and this error's own wording says "the network carries it as a P2SH
    // pair". So it matched `network` and came out as a CONNECTIVITY failure,
    // telling the user to check their connection and try again: the one
    // instruction that spends the coin a second time. Without the branch above,
    // the more carefully this sentence was written the worse it read.
    it('is not reclassified as a connection failure by the forms that humanize', () => {
        // THE TRAP, pinned on a bare copy of the same sentence so a later
        // rewording of either side cannot hide it: the keyword chain reads
        // "network" out of the explanation itself.
        const bare = new Error(new WatcherChunkLaneError({ action: 'MINT', encoding: 'P2SH' }).message);
        expect(humanizeError(bare, 'mint').cause).toBe('network');
        expect(humanizeError(bare, 'mint').message).toMatch(/check your connection/i);

        // The real error carries D-160's `userFacing` marker, so it is exempt
        // from that chain, and `submitFailureMessage` returns it whole either
        // way. Both belts are asserted because the six forms behind
        // `useActionForm` build their `fallback` by calling humanizeError FIRST.
        const err = new WatcherChunkLaneError({ action: 'MINT', encoding: 'P2SH' });
        const humanized = humanizeError(err, 'mint');
        expect(humanized.cause).toBe('unknown');
        expect(humanized.message).not.toMatch(/check your connection/i);

        const copy = submitFailureMessage(err, { fallback: humanized.message });
        expect(copy).not.toMatch(/check your connection/i);
        expect(copy).toMatch(/wallet holding the key/i);
    });

    it('does not claim unrelated failures', () => {
        // The classifier keys on a distinctive phrase; a generic build failure
        // must still get its form's fallback.
        expect(submitFailureMessage(new Error('boom'), { fallback: 'Dispenser creation failed.' }))
            .toBe('Dispenser creation failed.');
    });
});
