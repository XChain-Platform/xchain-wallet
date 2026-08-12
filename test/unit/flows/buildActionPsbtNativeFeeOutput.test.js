// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The watcher lane's native-coin fee output, exercised at RUNTIME.
//
// Every guard on this behaviour was a source-shape check ("does the file
// mention payFeeInNativeCoin?"), and that is exactly how the defect this
// closes survived: threaded SellOwnershipForm's submit path, the file
// therefore contained the string, the sweep smoke went green, and the WATCHER
// lane still composed a PSBT with no fee output. Nobody had ever executed the
// lane and looked at what came out the other end.
//
// This does. `buildActionPsbt` is the whole watcher lane - all its callers are
// encode-only - so driving it with a fake SDK and inspecting the arguments
// `encoder.createTx` actually receives is the closest thing to the real
// article that does not need a chain.
//
// WHAT THIS LANE CANNOT SEE, and where that half lives. A fake encoder proves
// the wallet ASKS for the fee output; it cannot prove the real encoder puts it
// in the PSBT it returns, nor that the indexer then accepts the action. That
// half is `tools/regtest/watcherLaneNativeFee.mjs`, driven on litecoin-regtest
// 2026-08-04: a watcher-composed ownership sale carrying the FEE_DESTINATION
// output indexed valid (action 2191, 0.03333333 LTC, payment_mode 1), and the
// same sale composed WITHOUT the flag - the shape every form whose fix
// stopped at the submit path produced - broadcast fine and was rejected
// `invalid: insufficient fee (native coin output required)` (action 2190).
//
// What "correct" looks like, from nativeFeePreflight.js: with the flag set the
// pre-flight quotes the fee, pushes { address: feeDestination, value: feeSats }
// onto customOutputs, and STRIPS its own flag so the encoder never sees an
// unknown param. Off Bitcoin that output IS the protocol fee: without
// it the transaction confirms and the indexer rejects the action
// "insufficient fee (native coin output required)" while the form reports
// success.

import { describe, it, expect, vi } from 'vitest';
import { buildActionPsbt } from '../../../packages/core/src/flows/buildActionPsbt.js';
import { NativeFeeForfeitError } from '../../../packages/core/src/sdk/nativeFeePreflight.js';

const SOURCE = {
    address: 'rltc1qexampleexampleexampleexampleexampleex',
    publicKey: '03c015d1857ef0227b38b31b0e33157382222da9a45e6e3f558994d7ea7250450f',
    derivationPath: "m/84'/2'/0'/0/0",
};

const FEE_DESTINATION = 'rltc1qfeedestinationfeedestinationfeedest';

function harness({ requiredFeeSats = 5_000_000, supported = true, valid = true } = {}) {
    const createTx = vi.fn(async () => ({ psbt: '70736274ff', encoding: 'OP_RETURN' }));
    const sdk = {
        actions: {
            createAction: vi.fn(() => ({
                actionString: 'ORDER|0|LTC|XCHAIN|5|LTC|100|',
                action: 'ORDER',
                version: 0,
            })),
        },
        encoder: { createTx },
        // The pre-flight refuses outright when this is missing, so its presence
        // is part of what the watcher lane depends on.
        quoteNativeFee: vi.fn(async () => ({
            supported, valid, requiredFeeSats, feeDestination: FEE_DESTINATION,
        })),
        explorer: {},
    };
    return { sdk, createTx };
}

function build(sdk, encoderOpts) {
    return buildActionPsbt({
        sdkRegistry: { get: () => sdk },
        chainRegistry: { get: () => ({ coin: 'LTC', networkKind: 'regtest' }) },
        chainId: 'litecoin-regtest',
        from: SOURCE,
        actionData: {
            action: 'ORDER',
            params: {
                VERSION: '0', GIVE_COIN: 'LTC', GIVE_TICK: 'XCHAIN',
                GIVE_AMOUNT: '5', GET_COIN: 'LTC', GET_AMOUNT: '100',
            },
        },
        ...(encoderOpts ? { encoderOpts } : {}),
    });
}

function feeOutputs(createTx) {
    const opts = createTx.mock.calls[0][0];
    return (opts.customOutputs || []).filter((o) => o.address === FEE_DESTINATION);
}

describe('The watcher lane composes the native-coin fee output', () => {
    it('attaches the FEE_DESTINATION output when the form threads the flag', async () => {
        const { sdk, createTx } = harness();
        await build(sdk, { payFeeInNativeCoin: true });

        expect(sdk.quoteNativeFee).toHaveBeenCalledTimes(1);
        const outs = feeOutputs(createTx);
        expect(outs).toHaveLength(1);
        expect(outs[0].value).toBe(5_000_000);
    });

    it('never forwards payFeeInNativeCoin to the encoder as an unknown param', async () => {
        const { sdk, createTx } = harness();
        await build(sdk, { payFeeInNativeCoin: true });

        expect(createTx.mock.calls[0][0]).not.toHaveProperty('payFeeInNativeCoin');
    });

    // THE REGRESSION ITSELF. This is what a watcher-mode compose produced from
    // every form whose fix stopped at the submit path: a perfectly valid PSBT,
    // signed and broadcast without complaint, carrying no protocol fee, which
    // the indexer then rejects while the wallet reports success.
    it('composes NO fee output when the flag never reaches this lane', async () => {
        const { sdk, createTx } = harness();
        await build(sdk, { feePerKb: 1000 });   // the shape the broken forms passed

        expect(sdk.quoteNativeFee).not.toHaveBeenCalled();
        expect(feeOutputs(createTx)).toHaveLength(0);
    });

    it('refuses rather than composing an unpayable transaction when the quote is dust', async () => {
        // A quote can be valid and still below the dust floor, at which point
        // neither paying nor skipping works: attaching a dust output makes the
        // tx non-standard, omitting it fails consensus. The lane must refuse.
        const { sdk, createTx } = harness({ requiredFeeSats: 2 });
        await expect(build(sdk, { payFeeInNativeCoin: true }))
            .rejects.toBeInstanceOf(NativeFeeForfeitError);
        expect(createTx).not.toHaveBeenCalled();
    });

    it('refuses when the action is unpriceable rather than composing a doomed tx', async () => {
        const { sdk, createTx } = harness({ supported: false });
        await expect(build(sdk, { payFeeInNativeCoin: true }))
            .rejects.toBeInstanceOf(NativeFeeForfeitError);
        expect(createTx).not.toHaveBeenCalled();
    });

    it('preserves customOutputs a caller already supplied', async () => {
        // The oracle-usage-fee lane puts its own output here, so the
        // fee output must be additive rather than a replacement.
        const { sdk, createTx } = harness();
        const existing = { address: 'rltc1qoracle', value: 1234 };
        await build(sdk, { payFeeInNativeCoin: true, customOutputs: [existing] });

        const all = createTx.mock.calls[0][0].customOutputs;
        expect(all).toEqual(expect.arrayContaining([existing]));
        expect(feeOutputs(createTx)).toHaveLength(1);
    });
});
