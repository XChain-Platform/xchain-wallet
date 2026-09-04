// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Suppressing the SEND action string for a bare native-coin payment and paying
// the recipient are ONE decision.
//
// The atomic (non-prebuilt) branch made only the first half: it dropped the
// OP_RETURN and relied on the caller to have put the destination output in
// customOutputs. `sendToken` and `buildSendPsbt` do. `advancedAction` forwards
// pubkey/sourceAddress/change/fee opts and nothing else, and the Parallel
// Composer submits arbitrary action + params through it with no prebuiltPsbt,
// so a native SEND there built a transaction that said nothing and paid no one.
// With customOutputs otherwise empty the SDK encoder refuses the build; with a
// donation or a native protocol-fee output already present it succeeds and
// returns a txid.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const DESCRIPTOR = { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' };
const DEST = 'bcrt1qdest';
const SOURCE = 'bcrt1qsource';
const DONATION = { address: 'bcrt1qdonate', value: '1000' };

// One satoshi-exact payment output for 0.5 BTC.
const PAYMENT = { address: DEST, value: '50000000' };

function makeHarness({ params, encoderOpts }) {
    const createTx = vi.fn(async () => ({ psbt: 'PSBT', encoding: 'OP_RETURN' }));
    const createAction = vi.fn(() => ({ actionString: 'SEND|0|JDOG|1|dest', action: 'SEND', version: 0 }));
    const sdk = {
        encoder: { createTx, broadcastTx: vi.fn(async () => ({})) },
        actions: { createAction },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
    };
    return {
        createTx,
        createAction,
        args: {
            sdkRegistry: { get: () => sdk },
            chainRegistry: { get: () => DESCRIPTOR },
            chainId: 'bitcoin-regtest',
            actionData: { action: 'SEND', params },
            encoderOpts,
            signer,
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        },
    };
}

// What advancedAction hands submitAction: no customOutputs at all.
const ADVANCED_OPTS = { pubkey: 'pub', sourceAddress: SOURCE, change: SOURCE };

const NATIVE_PARAMS = { TICK: 'BTC', AMOUNT: '0.5', DESTINATION: DEST };

describe('the atomic branch pays a bare native send', () => {

    it('adds the destination output for a caller that supplied none', async () => {
        const h = makeHarness({ params: NATIVE_PARAMS, encoderOpts: { ...ADVANCED_OPTS } });
        await submitWithSigner(h.args);
        const built = h.createTx.mock.calls[0][0];
        expect(built.customOutputs).toEqual([PAYMENT]);
        // The action string stays suppressed: this is a plain payment.
        expect(built.data).toBeUndefined();
        expect(h.createAction).not.toHaveBeenCalled();
    });

    // The silent-loss window: an ADS donation makes customOutputs non-empty, so
    // the SDK encoder's MISSING_DATA refusal no longer fires and the build
    // succeeds while paying nobody.
    it('pays the recipient alongside a donation output rather than instead of it', async () => {
        const h = makeHarness({
            params: NATIVE_PARAMS,
            encoderOpts: { ...ADVANCED_OPTS, customOutputs: [DONATION] },
        });
        await submitWithSigner(h.args);
        expect(h.createTx.mock.calls[0][0].customOutputs).toEqual([DONATION, PAYMENT]);
    });

    // sendToken already folds the payment in. Folding again would pay twice.
    it('does not double-pay a caller that already supplied the output', async () => {
        const h = makeHarness({
            params: NATIVE_PARAMS,
            encoderOpts: { ...ADVANCED_OPTS, customOutputs: [PAYMENT] },
        });
        await submitWithSigner(h.args);
        expect(h.createTx.mock.calls[0][0].customOutputs).toEqual([PAYMENT]);
    });

    // A token send carries a real action and settles through it; nothing here
    // may touch its outputs.
    it('leaves a token send exactly as it was', async () => {
        const h = makeHarness({
            params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: DEST },
            encoderOpts: { ...ADVANCED_OPTS },
        });
        await submitWithSigner(h.args);
        const built = h.createTx.mock.calls[0][0];
        expect(built.customOutputs).toBeUndefined();
        expect(built.data).toBe('SEND|0|JDOG|1|dest');
    });
});
