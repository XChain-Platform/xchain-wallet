// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The phase-2 reveal is built with what the phase-1 commit was built with.
//
// On the prebuilt path submitWithSigner does no rebuild, so `effectiveEncoderOpts`
// is the SUBMIT flow's opts, not the ones composeForConfirm handed the encoder.
// Building the reveal from those sent its surplus sweep (P2SH) or floor pad
// (P2WSH) to the spending address while the commit's change went to the freshly
// rotated internal one - the rotation defeated and the address reused on chain.
// Flows that set no change at all (DEPLOY passes pubkey/fee only) fell through
// to the encoder's caller-address default, with the same reuse.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const SPENDER = 'bcrt1qspender';
const ROTATED = 'bcrt1qrotatedinternal';

function makeHarness({ encoderOpts, prebuiltPsbt, encoding = 'P2SH' }) {
    const createTx = vi.fn(async () => ({ psbt: 'COMMIT', encoding }));
    const spendP2sh = vi.fn(async () => ({ psbt: 'REVEAL' }));
    const sdk = {
        encoder: { createTx, spendP2sh, broadcastTx: vi.fn(async () => ({})) },
        actions: { createAction: vi.fn(() => ({ actionString: 'DEPLOY|0|x|1', action: 'DEPLOY', version: 0 })) },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
    };
    return {
        spendP2sh,
        args: {
            sdkRegistry: { get: () => sdk },
            chainRegistry: { get: () => ({ id: 'litecoin-regtest', coin: 'litecoin' }) },
            chainId: 'litecoin-regtest',
            actionData: { action: 'DEPLOY', params: { VERSION: '0', CODE: 'x', GAS_LIMIT: '1' } },
            encoderOpts,
            prebuiltPsbt,
            signer,
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        },
    };
}

function envelope(extra = {}) {
    return {
        psbtHex: 'COMMIT', encoding: 'P2SH', actionString: 'DEPLOY|0|x|1', version: 0,
        deferredFeeOutput: null, deferredOutputs: [],
        ...extra,
    };
}

describe('the prebuilt reveal is built with the commit compose-side opts', () => {

    // The sendToken shape: the submit flow names the SPENDING address as change
    // while the compose rotated onto a fresh internal one.
    it('sweeps to the rotated change the commit used, not the submit-side one', async () => {
        const h = makeHarness({
            encoderOpts: { pubkey: 'pub', change: SPENDER, sourceAddress: SPENDER },
            prebuiltPsbt: envelope({ revealOpts: { change: ROTATED, rawData: null } }),
        });
        await submitWithSigner(h.args);
        expect(h.spendP2sh).toHaveBeenCalledOnce();
        expect(h.spendP2sh.mock.calls[0][0].change).toBe(ROTATED);
    });

    // The DEPLOY shape: the confirm-only flow sets no change at all, so the
    // encoder fell through to resolveCallerAddress(pubkey).
    it('uses the carried change when the submit flow set none', async () => {
        const h = makeHarness({
            encoderOpts: { pubkey: 'pub' },
            prebuiltPsbt: envelope({ revealOpts: { change: ROTATED, rawData: null } }),
        });
        await submitWithSigner(h.args);
        expect(h.spendP2sh.mock.calls[0][0].change).toBe(ROTATED);
    });

    it('carries the compose-side rawData too', async () => {
        const h = makeHarness({
            encoderOpts: { pubkey: 'pub', change: SPENDER },
            prebuiltPsbt: envelope({ revealOpts: { change: ROTATED, rawData: 'RAW' } }),
        });
        await submitWithSigner(h.args);
        expect(h.spendP2sh.mock.calls[0][0].rawData).toBe('RAW');
    });

    // An envelope built before the carry existed must behave exactly as it did.
    it('falls back to the submit-side opts for an envelope with no revealOpts', async () => {
        const h = makeHarness({
            encoderOpts: { pubkey: 'pub', change: SPENDER, rawData: 'SUBMIT-RAW' },
            prebuiltPsbt: envelope(),
        });
        await submitWithSigner(h.args);
        expect(h.spendP2sh.mock.calls[0][0].change).toBe(SPENDER);
        expect(h.spendP2sh.mock.calls[0][0].rawData).toBe('SUBMIT-RAW');
    });

    // ...and so must a null carry, which is what an off-chunk-lane compose emits.
    it('falls back when the carried change is null', async () => {
        const h = makeHarness({
            encoderOpts: { pubkey: 'pub', change: SPENDER },
            prebuiltPsbt: envelope({ revealOpts: { change: null, rawData: null } }),
        });
        await submitWithSigner(h.args);
        expect(h.spendP2sh.mock.calls[0][0].change).toBe(SPENDER);
    });

    // The atomic path builds both halves itself and has nothing to carry.
    it('leaves the atomic path on its own opts', async () => {
        const h = makeHarness({
            encoderOpts: { pubkey: 'pub', change: SPENDER },
            prebuiltPsbt: undefined,
        });
        await submitWithSigner(h.args);
        expect(h.spendP2sh.mock.calls[0][0].change).toBe(SPENDER);
    });
});
