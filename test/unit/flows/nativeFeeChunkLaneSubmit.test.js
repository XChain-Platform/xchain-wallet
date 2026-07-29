// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
//  / : submitWithSigner puts the native-coin protocol fee on the
// transaction that carries the ACTION, and still declares it to the phase-1
// build so the reveal can afford it.
//
// Both halves are load-bearing and they pull in opposite directions:
//   - emitted on the COMMIT, the indexer (which reads the reveal's outputs)
//     rejects the action for not paying, and the fee is spent anyway ;
//   - withheld from the phase-1 BUILD, the encoder reserves nothing in the
//     script output the reveal spends, and the reveal cannot balance
//     ("Outputs are spending more than Inputs") once the quote outgrows the
//     commit's incidental slack (, measured on litecoin-regtest).
// So it is PASSED to createTx and EMITTED on spendP2sh, and only ever paid once
// because the encoder skips emitting customOutputs on a chunk-lane commit.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const FEE_DEST = 'mfeesJdVLx23zhtsCveA8EEfmHX7qSV2Ls';
const FEE_SATS = 6946667;

function makeHarness({ encoding = 'P2SH', requiredFeeSats = FEE_SATS } = {}) {
    const createTx = vi.fn(async () => ({ psbt: 'COMMIT-PSBT', encoding }));
    const spendP2sh = vi.fn(async () => ({ psbt: 'REVEAL-PSBT' }));
    const broadcastTx = vi.fn(async () => ({}));
    const createAction = vi.fn(() => ({
        actionString: `DEPLOY|0|${'Q'.repeat(400)}|100000`, action: 'DEPLOY', version: 0,
    }));
    const sdk = {
        encoder: { createTx, spendP2sh, broadcastTx },
        actions: { createAction },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
        quoteNativeFee: vi.fn(async () => ({
            supported: true, valid: null, feeDestination: FEE_DEST, requiredFeeSats,
        })),
    };
    const signer = {
        signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
    };
    return {
        sdk, signer, createTx, spendP2sh, signPsbt: signer.signPsbt,
        args: {
            sdkRegistry: { get: () => sdk },
            chainId: 'litecoin-regtest',
            actionData: { action: 'DEPLOY', params: { VERSION: '0', CODE: 'x', GAS_LIMIT: '100000' } },
            encoderOpts: { pubkey: 'pub', change: 'chg', payFeeInNativeCoin: true },
            signer,
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        },
    };
}

describe('submitWithSigner native-fee placement on the chunk lane', () => {

    it('declares the fee output to the phase-1 build so the commit reserves its value', async () => {
        const h = makeHarness();
        await submitWithSigner(h.args);
        expect(h.createTx.mock.calls[0][0].customOutputs)
            .toContainEqual({ address: FEE_DEST, value: FEE_SATS });
    });

    it('emits it on the reveal, the transaction the indexer checks', async () => {
        const h = makeHarness();
        await submitWithSigner(h.args);
        expect(h.spendP2sh).toHaveBeenCalledOnce();
        expect(h.spendP2sh.mock.calls[0][0].customOutputs)
            .toEqual([{ address: FEE_DEST, value: FEE_SATS }]);
    });

    // A P2WSH payload is the same two-phase shape as P2SH.
    it('treats P2WSH the same way', async () => {
        const h = makeHarness({ encoding: 'P2WSH' });
        await submitWithSigner(h.args);
        expect(h.spendP2sh.mock.calls[0][0].customOutputs)
            .toEqual([{ address: FEE_DEST, value: FEE_SATS }]);
    });

    // Single-transaction encodings have no reveal to move it to, and the
    // transaction just built already carries it.
    it('leaves it on the only transaction when the encoder chose OP_RETURN', async () => {
        const h = makeHarness({ encoding: 'OP_RETURN' });
        await submitWithSigner(h.args);
        expect(h.createTx.mock.calls[0][0].customOutputs)
            .toContainEqual({ address: FEE_DEST, value: FEE_SATS });
        expect(h.spendP2sh).not.toHaveBeenCalled();
    });

    // A free action has no output to place, and a zero-value one would be dust.
    it('adds no output at all for a zero fee', async () => {
        const h = makeHarness({ requiredFeeSats: 0 });
        await submitWithSigner(h.args);
        expect(h.createTx.mock.calls[0][0].customOutputs).toEqual([]);
        expect(h.spendP2sh.mock.calls[0][0].customOutputs).toBeUndefined();
    });
});
