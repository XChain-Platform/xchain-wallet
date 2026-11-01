// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Unit: a two-phase P2SH or P2WSH action builds and signs its reveal before the
// commit is broadcast. An encoder that fails between the two broadcasts would
// leave the commit's coin in a script with no reveal while the form reported
// that nothing had been sent.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const revealLegs = (commitTxid, encoding) => {
    const scriptType = encoding === 'P2WSH' ? 'p2wsh' : 'p2sh';
    const script = { [scriptType === 'p2wsh' ? 'witnessScriptHex' : 'redeemScriptHex']: '0100' };
    return { inputs: [{ prevTxHash: commitTxid, prevTxIndex: 0, scriptType, ...script }], outputs: [{ scriptType, scriptPubKeyHex: '6a00', value: 0 }] };
};

function harness({ encoding = 'P2SH', spendP2sh } = {}) {
    const trace = [];
    const encoder = {
        createTx: vi.fn(async () => ({ psbt: 'PHASE1', encoding })),
        broadcastTx: vi.fn(async (txHex) => { trace.push(`broadcast:${txHex}`); return {}; }),
        spendP2sh: vi.fn(spendP2sh || (async () => { trace.push('spendP2sh'); return { psbt: 'PHASE2' }; })),
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => {
            trace.push(`sign:${psbtHex}`);
            return { txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` };
        }),
    };
    const args = {
        sdkRegistry: { get: () => ({
            encoder,
            actions: { createAction: () => ({ actionString: 'DEPLOY|0|x|1', action: 'DEPLOY', version: 0 }) },
            wallet: { decomposePsbt: () => revealLegs('txid-PHASE1', encoding) },
        }) },
        chainId: 'litecoin-regtest',
        chainRegistry: { get: () => ({ id: 'litecoin-regtest', coin: 'litecoin' }) },
        actionData: { action: 'DEPLOY', params: { VERSION: '0', CODE: 'x', GAS_LIMIT: '1' } },
        encoderOpts: { pubkey: 'pub' },
        signer,
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
    };
    return { encoder, signer, args, trace };
}

describe.each(['P2SH', 'P2WSH'])('submitWithSigner %s reveal order', (encoding) => {
    it('builds and signs the reveal before the commit goes out', async () => {
        const h = harness({ encoding });
        const result = await submitWithSigner(h.args);

        expect(h.trace).toEqual([
            'sign:PHASE1',
            'spendP2sh',
            'sign:PHASE2',
            'broadcast:TX(PHASE1)',
            'broadcast:TX(PHASE2)',
        ]);
        expect(result.txid).toBe('txid-PHASE2');
    });

    it('broadcasts nothing when the encoder cannot build the reveal', async () => {
        const h = harness({
            encoding,
            spendP2sh: async () => { throw new Error('encoder unreachable'); },
        });

        await expect(submitWithSigner(h.args)).rejects.toThrow(/encoder unreachable/);
        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
    });
});
