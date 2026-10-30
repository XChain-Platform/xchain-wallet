// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A node that refuses a transaction's scripts refuses those bytes on every
// retry, so the wallet retires the row as failed instead of queueing a
// transaction that can never confirm. Driven end to end through submitAction
// with a TrezorSigner whose reply carries a witness the node rejects.

import { describe, it, expect } from 'vitest';
import { classifyBroadcastFailure } from '../../../packages/core/src/flows/broadcastPermanence.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';
import { decomposedFor, signedReplyFor } from '../../helpers/hwSignedReply.js';

// Bitcoin Core's script-check rejects across its naming generations.
const SCRIPT_REJECTS = [
    'mandatory-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation)',
    'non-mandatory-script-verify-flag (Non-canonical DER signature)',
    'mempool-script-verify-flag-failed (Invalid Schnorr signature)',
    'block-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation)',
    'sendrawtransaction RPC error: {"code":-26,"message":"mandatory-script-verify-flag-failed (Witness program hash mismatch)"}',
];

// A reply whose signature verifies locally, so the refusal under test is the
// node's: a script rule the wallet does not model refuses it on every retry.
const decomposed = decomposedFor({
    inputs: [{ scriptType: 'p2wpkh', txid: 'ab'.repeat(32), value: 100_000 }],
    outputs: [{ address: 'bc1qout', scriptPubKeyHex: `0014${'cc'.repeat(20)}`, value: 90_000 }],
});
const SIGNED_TX = signedReplyFor(decomposed);

function memCollection() {
    const m = new Map();
    return {
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        get: async (id) => m.get(id) ?? null,
        list: async () => Array.from(m.values()),
    };
}

describe('script-check broadcast rejects', () => {
    it.each(SCRIPT_REJECTS)('classifies %s as permanent', (reason) => {
        expect(classifyBroadcastFailure(new Error(reason))).toBe('permanent');
    });

    it('keeps an unrelated mempool refusal transient', () => {
        expect(classifyBroadcastFailure(new Error('mempool min fee not met'))).toBe('transient');
    });

    it('retires a hardware-signed send the node refuses on script checks', async () => {
        const broadcasts = [];
        const connect = {
            getFeatures: async () => ({ success: true, payload: { device_id: 'dev1' } }),
            signTransaction: async () => ({ success: true, payload: { serializedTx: SIGNED_TX } }),
        };
        const sdk = {
            encoder: {
                broadcastTx: async (hex) => {
                    broadcasts.push(hex);
                    throw new Error('non-mandatory-script-verify-flag (Witness program hash mismatch)');
                },
            },
            wallet: { decomposePsbt: () => decomposed, txidOf: () => 'f'.repeat(64) },
        };
        const sdkRegistry = { get: () => sdk };
        const signer = new TrezorSigner({
            id: 's1', displayName: 'Trezor', model: 'T2T1', deviceIdentifier: 'dev1', connect, sdkRegistry,
        });
        const pendingTxs = memCollection();
        let error = null;
        try {
            await submitAction({
                vault: { pendingTxs, settings: { get: async () => ({}), put: async () => {} } },
                walletId: 'w1',
                chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind: 'mainnet' }) },
                sdkRegistry,
                chainId: 'bitcoin-mainnet',
                // A bare native payment: the one action a mainnet chain accepts before launch.
                actionData: { action: 'SEND', params: { TICK: 'BTC', AMOUNT: '0.0009', DESTINATION: 'bc1qout' } },
                encoderOpts: { pubkey: '02aa' },
                signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
                signer,
                prebuiltPsbt: { psbtHex: '70736274ff00', encoding: 'OP_RETURN', actionString: 'x' },
                pendingTxMeta: { fromAddress: 'a', toAddress: 'b', actionSummary: 's' },
            });
        } catch (err) {
            error = err;
        }
        expect(broadcasts).toEqual([SIGNED_TX]);
        expect(error?.name).toBe('BroadcastFailedPermanentError');
        const rows = await pendingTxs.list();
        expect(rows.map((row) => row.status)).toEqual(['failed']);
    });
});
