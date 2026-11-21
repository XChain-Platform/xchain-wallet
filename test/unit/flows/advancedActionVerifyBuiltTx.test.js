// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, it, expect, vi } from 'vitest';
import { advancedAction } from '../../../packages/core/src/flows/advancedAction.js';

const CHAIN_ID = 'bitcoin-regtest';
const SOURCE = 'bcrt1qsource';
const ATTACKER = 'bcrt1qattacker';
const ACTION_STRING = 'ISSUE|0|TEST|1000|1';
const OP_RETURN = { address: null, scriptPubKeyHex: '6a0b4953535545', scriptType: 'unknown', value: 0 };
const CHANGE = { address: SOURCE, scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 90000 };
const foreignOutput = { address: ATTACKER, scriptPubKeyHex: '0014bb', scriptType: 'p2wpkh', value: 1000 };

function harness(outputs) {
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({
            signedPsbtHex: psbtHex,
            txHex: `TX(${psbtHex})`,
            txid: `txid-${psbtHex}`,
        })),
    };
    const sdk = {
        config: { network: 'regtest' },
        actions: {
            createAction: vi.fn(() => ({ actionString: ACTION_STRING, action: 'ISSUE', version: 0 })),
        },
        encoder: {
            createTx: vi.fn(async () => ({ psbt: 'BUILT', encoding: 'OP_RETURN' })),
            broadcastTx: vi.fn(async () => ({})),
        },
        wallet: {
            decomposePsbt: vi.fn(() => ({ inputs: [{}], outputs })),
        },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: true, actionString: ACTION_STRING })),
        },
    };
    const chainRegistry = {
        get: vi.fn(() => ({ id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' })),
    };
    const vault = {
        settings: { get: vi.fn(async () => ({})) },
    };

    return {
        signer,
        sdk,
        run: () => advancedAction({
            vault,
            walletId: 'wallet-1',
            signer,
            chainRegistry,
            sdkRegistry: { get: () => sdk },
            chainId: CHAIN_ID,
            from: {
                address: SOURCE,
                publicKey: '02aa',
                derivationPath: "m/84'/1'/0'/0/0",
            },
            action: 'issue',
            params: { TICK: 'TEST', MAX: '1000', DIVISIBLE: '1' },
            trackPendingTx: false,
        }),
    };
}

describe('advancedAction built transaction verification', () => {
    it('refuses an encoder build with an unapproved output before signing or broadcasting', async () => {
        const h = harness([OP_RETURN, foreignOutput, CHANGE]);

        await expect(h.run()).rejects.toMatchObject({
            name: 'TamperDetectedError',
            message: expect.stringMatching(/did not approve/),
        });
        expect(h.signer.signPsbt).not.toHaveBeenCalled();
        expect(h.sdk.encoder.broadcastTx).not.toHaveBeenCalled();
    });

    it('signs and broadcasts an honest encoder build', async () => {
        const h = harness([OP_RETURN, CHANGE]);

        const result = await h.run();

        expect(h.signer.signPsbt).toHaveBeenCalledTimes(1);
        expect(h.signer.signPsbt.mock.calls[0][0].psbtHex).toBe('BUILT');
        expect(h.sdk.encoder.broadcastTx).toHaveBeenCalledTimes(1);
        expect(result.txid).toBe('txid-BUILT');
    });
});
