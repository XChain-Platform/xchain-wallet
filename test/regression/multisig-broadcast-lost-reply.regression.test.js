// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: a finalized multisig spend whose broadcast reply is lost.
//
//   [P1] 2026-10-27: The node takes the finalized transaction but the
//        encoder answers 500 (or drops the connection). Every Try again then
//        meets "txn-already-in-mempool", so the session stays "Finalized,
//        ready to broadcast" with a raw node code and a retry that cannot
//        succeed, while the spend is already on the network.

import { describe, expect, it, vi } from 'vitest';
import { finalizeMultisigSigningSession } from '../../packages/core/src/flows/multisigSigning.js';
import { signedTxFor } from '../helpers/signedTx.js';

// Real finalized bytes and the prevouts their PSBT records: the broadcast
// verifies every signature before it sends.
const SIGNED = signedTxFor({ inputs: [{ type: 'p2wsh-multisig' }] });

const FINALIZED = {
    id: 'session-1',
    walletId: 'wallet-1',
    chainId: 'bitcoin-regtest',
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosignerPubkeys: [`02${'aa'.repeat(32)}`, `03${'bb'.repeat(32)}`],
    msgHash: '11'.repeat(32),
    psbtHex: '00',
    nonces: [],
    partialSigs: [],
    signatures: [],
    aggNonce: null,
    aggregatedSchnorrSig: null,
    status: 'finalized',
    finalizedTxHex: SIGNED.txHex,
    txid: 'f'.repeat(64),
    actionSummary: '',
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
};

function memoryVault(record) {
    const records = new Map([[record.id, structuredClone(record)]]);
    return {
        records,
        vault: {
            multisigSigningSessions: {
                get: async (id) => structuredClone(records.get(id) || null),
                put: async (next) => { records.set(next.id, structuredClone(next)); },
            },
        },
    };
}

function rpcError(message, data) {
    const err = /** @type {any} */ (new Error(`Encoder RPC error: ${message}`));
    err.code = 'ENCODER_RPC_ERROR';
    err.details = { rpcError: { code: -32010, message, data } };
    return err;
}

const sdkWith = (broadcastTx) => ({
    get: () => ({ encoder: { broadcastTx }, wallet: { decomposePsbt: () => ({ inputs: SIGNED.prevouts }) } }),
});

const broadcast = (vault, sdkRegistry) => finalizeMultisigSigningSession({
    vault, sdkRegistry, sessionId: FINALIZED.id, broadcast: true,
});

describe('multisig broadcast after a lost reply', () => {
    it.each([
        ['txn-already-in-mempool', rpcError('txn-already-in-mempool', { reason: 'NODE_REJECTED', node_code: -27 })],
        ['txn-already-known', rpcError('txn-already-known')],
        ['transaction already in block chain', rpcError('transaction already in block chain')],
        ['node code -27 with other text', rpcError('rejected', { reason: 'NODE_REJECTED', node_code: -27 })],
    ])('records the spend as broadcast when the retry meets %s', async (_label, alreadyKnown) => {
        const { vault, records } = memoryVault(FINALIZED);
        const broadcastTx = vi.fn()
            .mockRejectedValueOnce(new Error('Request failed with status code 500'))
            .mockRejectedValueOnce(alreadyKnown);
        const sdkRegistry = sdkWith(broadcastTx);

        await expect(broadcast(vault, sdkRegistry)).rejects.toThrow(/500/);
        expect(records.get(FINALIZED.id).status).toBe('finalized');

        const retried = await broadcast(vault, sdkRegistry);
        expect(retried.status).toBe('broadcast');
        expect(retried.txid).toBe(FINALIZED.txid);
        expect(records.get(FINALIZED.id).status).toBe('broadcast');

        // A third press is a no-op: nothing more goes to the encoder.
        await broadcast(vault, sdkRegistry);
        expect(broadcastTx).toHaveBeenCalledTimes(2);
    });

    //   [P1] 2026-10-27: An encoder reply of "not-a-txid" (or any non-empty
    //        string) moves the session to the terminal "Broadcast complete:
    //        not-a-txid" with no retry, though the node never receives it.
    it.each([
        ['a string that is not a txid', 'not-a-txid'],
        ['an object with a short txid', { txid: 'abc123' }],
        ['a txid for a different transaction', { txid: 'e'.repeat(64) }],
    ])('keeps the session finalized and retryable when the reply is %s', async (_label, reply) => {
        const { vault, records } = memoryVault(FINALIZED);
        const broadcastTx = vi.fn()
            .mockResolvedValueOnce(reply)
            .mockResolvedValueOnce({ txid: FINALIZED.txid.toUpperCase() });
        const sdkRegistry = sdkWith(broadcastTx);
        await expect(broadcast(vault, sdkRegistry)).rejects.toThrow(/txid/);
        expect(records.get(FINALIZED.id)).toMatchObject({ status: 'finalized', txid: FINALIZED.txid });
        const retried = await broadcast(vault, sdkRegistry);
        expect(retried).toMatchObject({ status: 'broadcast', txid: FINALIZED.txid });
    });

    it('keeps the session finalized when the node refuses the transaction itself', async () => {
        const { vault, records } = memoryVault(FINALIZED);
        const broadcastTx = vi.fn().mockRejectedValue(
            rpcError('bad-txns-inputs-missingorspent', { reason: 'NODE_REJECTED', node_code: -25 }),
        );
        const sdkRegistry = sdkWith(broadcastTx);
        await expect(broadcast(vault, sdkRegistry)).rejects.toThrow(/missingorspent/);
        expect(records.get(FINALIZED.id).status).toBe('finalized');
    });
});
