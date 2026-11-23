// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A chunk-lane label in any case is a two-transaction action: the commit is
// never broadcast on its own, and a signer that cannot sign the reveal is
// refused before anything is signed. A TAPROOT label in any case is a pair
// that must be complete, and completeness keeps the exact label.

import { describe, it, expect, vi } from 'vitest';
import {
    submitWithSigner, HardwareChunkLaneError, isEnvelopePair, isCompleteEnvelope, assertCompleteEnvelope,
} from '../../../packages/core/src/sdk/submitWithSigner.js';

function harness(encoding) {
    const encoder = {
        createTx: vi.fn(async () => ({ psbt: '70736274ff', encoding })),
        broadcastTx: vi.fn(async () => ({})),
        spendP2sh: vi.fn(async () => ({ psbt: '70736274ee' })),
    };
    const sdkRegistry = {
        get: () => ({
            encoder,
            actions: { createAction: () => ({ actionString: 'DEPLOY|0|x', action: 'DEPLOY', version: 0 }) },
            wallet: {
                decomposePsbt: () => ({
                    inputs: [{ prevTxHash: 'TXID', prevTxIndex: 0, scriptType: 'p2sh', redeemScriptHex: '0100' }],
                    outputs: [{ scriptType: 'p2sh', scriptPubKeyHex: '6a00', value: 0 }],
                }),
            },
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

describe('submitWithSigner chunk-lane label case', () => {
    it.each(['p2sh', 'p2wsh', 'P2sh'])('treats a %s answer as two-phase, so a signer without reveal support is refused unsigned', async (encoding) => {
        const h = harness(encoding);
        const signer = { kind: 'ledger', signPsbt: vi.fn(async () => ({ txHex: 'signed-hex', txid: 'TXID' })) };
        await expect(call(h, signer)).rejects.toBeInstanceOf(HardwareChunkLaneError);
        expect(signer.signPsbt).not.toHaveBeenCalled();
        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
    });
});

describe('envelope label case', () => {
    it('reads a lowercase taproot label as an envelope pair that must be complete', () => {
        const built = { encoding: 'taproot', psbt: 'x' };
        expect(isEnvelopePair(built)).toBe(true);
        expect(isCompleteEnvelope(built)).toBe(false);
        expect(() => assertCompleteEnvelope(built, 'SEND')).toThrow();
    });
});
