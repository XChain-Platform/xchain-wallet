// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the P2SH/P2WSH chunk lane refuses a signer that cannot sign the
// reveal BEFORE phase 1 is signed or broadcast.
//
// The reveal is dispatched after the phase-1 commit is on chain, and the
// hardware/remote signers drop the `reveal` flag and fail inside their vendor
// format layer, so a refusal at the signer would complete the commit and never
// the reveal: coin spent into a script nothing can open. Signer.js says the
// guard has to be a pre-dispatch capability check in submitWithSigner; these
// pin that it is there, that it fires before any signing, and that the software
// lane is untouched.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner, HardwareChunkLaneError } from '../../../packages/core/src/sdk/submitWithSigner.js';
import { isWatcherChunkLane, submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

function harness({ encoding = 'P2SH' } = {}) {
    const encoder = {
        createTx: vi.fn(async () => ({ psbt: '70736274ff', encoding })),
        broadcastTx: vi.fn(async () => ({})),
        spendP2sh: vi.fn(async () => ({ psbt: '70736274ee' })),
    };
    const sdkRegistry = {
        get: () => ({
            encoder,
            actions: { createAction: () => ({ actionString: 'DEPLOY|0|x', action: 'DEPLOY', version: 0 }) },
            wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
        }),
    };
    return { sdkRegistry, encoder };
}

const call = (h, signer) => submitWithSigner({
    sdkRegistry: h.sdkRegistry,
    chainId: 'BTC',
    chainRegistry: { get: () => ({}) },
    actionData: { action: 'DEPLOY', params: {} },
    encoderOpts: { pubkey: '03abc', change: 'chg' },
    signer,
    signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
});

const signerOf = (kind) => ({
    kind,
    signPsbt: vi.fn(async () => ({ txHex: 'signed-hex', txid: 'TXID' })),
});

describe('submitWithSigner chunk-lane capability gate', () => {
    it.each(['trezor', 'ledger'])('refuses a %s signer before anything is signed or broadcast', async (kind) => {
        const h = harness();
        const signer = signerOf(kind);
        await expect(call(h, signer)).rejects.toBeInstanceOf(HardwareChunkLaneError);
        expect(signer.signPsbt).not.toHaveBeenCalled();
        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
        expect(h.encoder.spendP2sh).not.toHaveBeenCalled();
    });

    it('fails closed on a signer with no kind at all (P2WSH too)', async () => {
        const h = harness({ encoding: 'P2WSH' });
        const signer = { signPsbt: vi.fn(async () => ({ txHex: 'x', txid: 'y' })) };
        await expect(call(h, signer)).rejects.toThrow(/cannot sign that revealing transaction/);
        expect(signer.signPsbt).not.toHaveBeenCalled();
        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
    });

    it('lets the software signer through and still signs the reveal after phase 1', async () => {
        const h = harness();
        const signer = signerOf('software');
        await call(h, signer);
        expect(signer.signPsbt).toHaveBeenCalledTimes(2);
        expect(signer.signPsbt.mock.calls[1][0].reveal).toBe(true);
        expect(h.encoder.broadcastTx).toHaveBeenCalledTimes(2);
    });

    it('does not gate single-transaction encodings for a hardware signer', async () => {
        const h = harness({ encoding: 'OP_RETURN' });
        const signer = signerOf('ledger');
        await call(h, signer);
        expect(signer.signPsbt).toHaveBeenCalledTimes(1);
        expect(h.encoder.broadcastTx).toHaveBeenCalledTimes(1);
    });

    it('the error is user-facing and reaches the form whole', () => {
        const err = new HardwareChunkLaneError({ action: 'DEPLOY', encoding: 'P2SH', signerKind: 'ledger' });
        expect(err.userFacing).toBe(true);
        expect(isWatcherChunkLane(err)).toBe(true);
        expect(submitFailureMessage(err, { fallback: 'Deploy failed.' })).toBe(err.message);
        expect(err.message).toMatch(/A ledger signer cannot sign that revealing transaction/);
    });
});
