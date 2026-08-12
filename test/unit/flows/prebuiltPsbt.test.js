// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// submitWithSigner.prebuiltPsbt byte-identity (§5.3.4). The whole
// point of the single-encode pipeline: the PSBT handed to the signer is
// EXACTLY the one composeForConfirm built and the modal checked - never a
// rebuild.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

function makeHarness() {
    const createTx = vi.fn(async () => ({ psbt: 'REBUILT-DIFFERENT', encoding: 'OP_RETURN' }));
    const createAction = vi.fn(() => ({ actionString: 'REBUILT', action: 'SEND', version: 0 }));
    const broadcastTx = vi.fn(async () => ({}));
    const decomposePsbt = vi.fn(() => ({ inputs: [{}], outputs: [] }));
    const sdk = {
        encoder: { createTx, broadcastTx },
        actions: { createAction },
        wallet: { decomposePsbt },
    };
    const sdkRegistry = { get: () => sdk };
    const signPsbt = vi.fn(async ({ psbtHex }) => ({ signedPsbtHex: 's', txHex: 'TX(' + psbtHex + ')', txid: 'txid-' + psbtHex }));
    const signer = { signPsbt };
    return { sdk, sdkRegistry, signer, createTx, createAction, broadcastTx, signPsbt };
}

describe('submitWithSigner prebuiltPsbt', () => {

    it('signs the prebuilt PSBT byte-identically and never calls createAction/createTx', async () => {
        const h = makeHarness();
        const result = await submitWithSigner({
            sdkRegistry: h.sdkRegistry,
            chainId: 'btc',
            actionData: { action: 'SEND', params: {} },
            encoderOpts: { pubkey: 'pub', change: 'chg' },
            signer: h.signer,
            signingPaths: [{ inputIndex: 0, path: "m/0" }],
            prebuiltPsbt: { psbtHex: 'THE-APPROVED-PSBT', encoding: 'OP_RETURN', actionString: 'SEND|0|JDOG|1|addr', version: 0 },
        });
        // The signer received the approved PSBT verbatim.
        expect(h.signPsbt).toHaveBeenCalledOnce();
        expect(h.signPsbt.mock.calls[0][0].psbtHex).toBe('THE-APPROVED-PSBT');
        // No rebuild happened.
        expect(h.createAction).not.toHaveBeenCalled();
        expect(h.createTx).not.toHaveBeenCalled();
        // The result carries the approved action string, not a rebuild.
        expect(result.actionString).toBe('SEND|0|JDOG|1|addr');
        expect(result.encoding).toBe('OP_RETURN');
    });

    it('legacy path (no prebuiltPsbt) still rebuilds via createAction + createTx', async () => {
        const h = makeHarness();
        await submitWithSigner({
            sdkRegistry: h.sdkRegistry,
            chainId: 'btc',
            actionData: { action: 'SEND', params: {} },
            encoderOpts: { pubkey: 'pub', change: 'chg' },
            signer: h.signer,
            signingPaths: [{ inputIndex: 0, path: "m/0" }],
        });
        expect(h.createAction).toHaveBeenCalledOnce();
        expect(h.createTx).toHaveBeenCalledOnce();
        expect(h.signPsbt.mock.calls[0][0].psbtHex).toBe('REBUILT-DIFFERENT');
    });
});
