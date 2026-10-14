// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// `verifyBuiltTx`: the atomic path holds the encoder's PSBT to the confirm
// pipeline's tamper checks before any signer sees it.
//
// A dApp signAction is approved as an intent, then built by the encoder
// service and signed. Without this the bytes were never compared to the
// approved action. Here the encoder is a fake whose answer each case controls:
// an honest build signs exactly the bytes it returned, and a build with a
// swapped destination, a changed amount, an extra output or rewritten action
// bytes is refused before `signPsbt` is called.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const DESCRIPTOR = { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' };
const SOURCE = 'bcrt1qsource';
const DEST = 'bcrt1qdest';
const ATTACKER = 'bcrt1qattacker';
const OPRETURN = { address: null, scriptPubKeyHex: '6a0b53454e44', scriptType: 'unknown', value: 0 };
const CHANGE = { address: SOURCE, scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 90000 };
const out = (address, value) => ({ address, scriptPubKeyHex: '0014bb', scriptType: 'p2wpkh', value });

const TOKEN_SEND = { action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: DEST } };
const NATIVE_SEND = { action: 'SEND', params: { TICK: 'BTC', AMOUNT: '0.5', DESTINATION: DEST } };
const SWEEP = {
    action: 'SWEEP',
    params: { DESTINATION: DEST, BALANCES: '1', OWNERSHIPS: '1', ORDERS: '0', SWAPS: '0', DISPENSERS: '0' },
};
const ACTION_STRING = {
    SEND: `SEND|0|JDOG|1|${DEST}`,
    SWEEP: `SWEEP|0|${DEST}|1|1|0|0|0`,
};

/**
 * @param {{ actionData: object, outputs: object[], decoded?: string, verifyBuiltTx?: boolean, customOutputs?: object[] }} spec
 */
function harness({ actionData, outputs, decoded, verifyBuiltTx = true, customOutputs }) {
    const actionString = ACTION_STRING[actionData.action];
    const sdk = {
        config: { network: 'regtest' },
        encoder: {
            createTx: vi.fn(async () => ({ psbt: 'BUILT', encoding: 'OP_RETURN' })),
            broadcastTx: vi.fn(async () => ({})),
        },
        actions: { createAction: vi.fn(() => ({ actionString, action: actionData.action, version: 0 })) },
        wallet: { decomposePsbt: vi.fn(() => ({ inputs: [{}], outputs })) },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: true, actionString: decoded ?? actionString })),
        },
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
    };
    return {
        sdk,
        signer,
        run: () => submitWithSigner({
            sdkRegistry: { get: () => sdk },
            chainRegistry: { get: () => DESCRIPTOR },
            chainId: DESCRIPTOR.id,
            actionData,
            encoderOpts: {
                pubkey: 'pub',
                sourceAddress: SOURCE,
                change: SOURCE,
                ...(customOutputs ? { customOutputs } : {}),
            },
            signer,
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
            verifyBuiltTx,
        }),
    };
}

async function expectRefusedUnsigned(h, pattern) {
    await expect(h.run()).rejects.toMatchObject({ name: 'TamperDetectedError', message: expect.stringMatching(pattern) });
    expect(h.signer.signPsbt).not.toHaveBeenCalled();
    expect(h.sdk.encoder.broadcastTx).not.toHaveBeenCalled();
}

describe('verifyBuiltTx: an honest build signs exactly as before', () => {
    it('token SEND', async () => {
        const h = harness({ actionData: TOKEN_SEND, outputs: [OPRETURN, CHANGE] });
        const res = await h.run();
        expect(h.signer.signPsbt).toHaveBeenCalledTimes(1);
        expect(h.signer.signPsbt.mock.calls[0][0].psbtHex).toBe('BUILT');
        expect(res.txid).toBe('txid-BUILT');
    });

    it('native-coin SEND (a bare payment: one output to the recipient)', async () => {
        const h = harness({ actionData: NATIVE_SEND, outputs: [out(DEST, '50000000'), CHANGE] });
        await h.run();
        expect(h.signer.signPsbt.mock.calls[0][0].psbtHex).toBe('BUILT');
    });

    it('SWEEP', async () => {
        const h = harness({ actionData: SWEEP, outputs: [OPRETURN, CHANGE] });
        await h.run();
        expect(h.signer.signPsbt.mock.calls[0][0].psbtHex).toBe('BUILT');
    });

    it('a token SEND carrying a requested extra output (a donation) still signs', async () => {
        const h = harness({
            actionData: TOKEN_SEND,
            customOutputs: [{ address: 'bcrt1qdonate', value: '1000' }],
            outputs: [OPRETURN, out('bcrt1qdonate', 1000), CHANGE],
        });
        await h.run();
        expect(h.signer.signPsbt).toHaveBeenCalledTimes(1);
    });
});

describe('verifyBuiltTx: a build that is not what was approved is refused unsigned', () => {
    it('native SEND with the destination swapped', async () => {
        await expectRefusedUnsigned(
            harness({ actionData: NATIVE_SEND, outputs: [out(ATTACKER, '50000000'), CHANGE] }),
            /did not approve/,
        );
    });

    it('native SEND with the amount changed', async () => {
        await expectRefusedUnsigned(
            harness({ actionData: NATIVE_SEND, outputs: [out(DEST, '5000000'), CHANGE] }),
            /did not approve/,
        );
    });

    it('native SEND missing the recipient output entirely', async () => {
        await expectRefusedUnsigned(
            harness({ actionData: NATIVE_SEND, outputs: [CHANGE] }),
            /missing/,
        );
    });

    it('token SEND with an extra output to a foreign address', async () => {
        await expectRefusedUnsigned(
            harness({ actionData: TOKEN_SEND, outputs: [OPRETURN, out(ATTACKER, 20000), CHANGE] }),
            /did not approve/,
        );
    });

    it('token SEND whose action bytes name another destination', async () => {
        await expectRefusedUnsigned(
            harness({ actionData: TOKEN_SEND, outputs: [OPRETURN, CHANGE], decoded: `SEND|0|JDOG|1|${ATTACKER}` }),
            /does not match what you approved/,
        );
    });

    it('token SEND whose action bytes change the amount', async () => {
        await expectRefusedUnsigned(
            harness({ actionData: TOKEN_SEND, outputs: [OPRETURN, CHANGE], decoded: `SEND|0|JDOG|1000|${DEST}` }),
            /does not match what you approved/,
        );
    });

    it('SWEEP whose action bytes sweep to another destination', async () => {
        await expectRefusedUnsigned(
            harness({ actionData: SWEEP, outputs: [OPRETURN, CHANGE], decoded: `SWEEP|0|${ATTACKER}|1|1|0|0|0` }),
            /does not match what you approved/,
        );
    });

    it('SWEEP with an extra output', async () => {
        await expectRefusedUnsigned(
            harness({ actionData: SWEEP, outputs: [OPRETURN, out(ATTACKER, 546), CHANGE] }),
            /did not approve/,
        );
    });

    it('a second carrier output', async () => {
        await expectRefusedUnsigned(
            harness({ actionData: TOKEN_SEND, outputs: [OPRETURN, OPRETURN, CHANGE] }),
            /did not approve/,
        );
    });
});

describe('verifyBuiltTx is opt-in', () => {
    it('leaves every other atomic caller exactly as it was', async () => {
        const h = harness({
            actionData: TOKEN_SEND,
            outputs: [OPRETURN, out(ATTACKER, 20000), CHANGE],
            verifyBuiltTx: false,
        });
        await h.run();
        expect(h.signer.signPsbt).toHaveBeenCalledTimes(1);
        expect(h.sdk.decoder.decodeActionStringFromPsbt).not.toHaveBeenCalled();
    });
});
