// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const CHAIN = 'bitcoin-regtest';
const WALLET = 'wallet-1';
const SOURCE = 'bcrt1qwallet';
const DESTINATION = 'bcrt1qrecipient';
const ORIGINAL = 'aa'.repeat(32);
const CANCEL = 'bb'.repeat(32);
const REPLACEMENT = 'cc'.repeat(32);
const INPUT = '11'.repeat(32);

const decomposition = (outputs) => ({
    inputs: [{
        prevTxHash: INPUT,
        prevTxIndex: 0,
        sequence: 0xfffffffd,
        value: 10000,
        scriptPubKeyHex: `0014${'22'.repeat(20)}`,
    }],
    outputs,
});

const originalPlan = decomposition([
    { address: null, scriptType: 'unknown', scriptPubKeyHex: '6a0100', value: 0 },
    { address: DESTINATION, scriptType: 'p2wpkh', value: 7000 },
    { address: SOURCE, scriptType: 'p2wpkh', value: 2000 },
]);
const cancelPlan = decomposition([{ address: SOURCE, scriptType: 'p2wpkh', value: 8000 }]);

function pending(txid, psbtHex, over = {}) {
    return {
        id: `pending-${txid.slice(0, 4)}`,
        chain: 'bitcoin',
        network: 'regtest',
        fromAddress: SOURCE,
        toAddress: DESTINATION,
        action: 'SEND',
        actionSummary: 'Send XCHAIN',
        psbtHex,
        txHex: '00'.repeat(250),
        txid,
        status: 'broadcast',
        rbf: true,
        rbfReplacement: null,
        ...over,
    };
}

function harness(initial = [pending(ORIGINAL, 'original-psbt')]) {
    const rows = new Map(initial.map((row) => [row.id, row]));
    const put = vi.fn(async (row) => { rows.set(row.id, row); return row; });
    const createTx = vi.fn(async () => ({ psbt: 'replacement-psbt', encoding: 'OP_RETURN' }));
    const broadcastTx = vi.fn(async () => ({ txid: REPLACEMENT }));
    const signPsbt = vi.fn(async () => ({
        signedPsbtHex: 'signed-replacement', txHex: 'signed-tx', txid: REPLACEMENT,
    }));
    const decodeActionStringFromPsbt = vi.fn(() => ({
        ok: true, actionString: 'SEND|0|XCHAIN|1|destination',
    }));
    const decomposePsbt = vi.fn((hex) => {
        if (hex === 'original-psbt') return originalPlan;
        if (hex === 'cancel-psbt') return cancelPlan;
        if (hex === 'replacement-psbt') {
            const args = createTx.mock.calls.at(-1)[0];
            const fixed = args.customOutputs.reduce((sum, output) => sum + Number(output.value), 0);
            const change = 10000 - fixed - Number(args.fee);
            return decomposition([
                ...(args.data ? [{
                    address: null, scriptType: 'unknown', scriptPubKeyHex: '6a0100', value: 0,
                }] : []),
                ...args.customOutputs.map((output) => ({ ...output, scriptType: 'p2wpkh' })),
                ...(change > 0 ? [{ address: args.change, scriptType: 'p2wpkh', value: change }] : []),
            ]);
        }
        throw new Error(`unexpected PSBT ${hex}`);
    });
    const sdk = {
        encoder: { createTx, broadcastTx },
        decoder: { decodeActionStringFromPsbt },
        wallet: { decomposePsbt },
    };
    const vault = {
        accounts: { findBy: vi.fn(async () => [{ id: 'account-1', walletId: WALLET }]) },
        addresses: { list: vi.fn(async () => [{
            id: 'address-1',
            accountId: 'account-1',
            address: SOURCE,
            publicKey: '02'.padEnd(66, '1'),
            derivationPath: "m/84'/1'/0'/0/0",
            source: 'hd',
        }]) },
        pendingTxs: { list: vi.fn(async () => [...rows.values()]), put },
        settings: { get: vi.fn(async () => ({})) },
    };
    const descriptor = {
        id: CHAIN,
        coin: 'bitcoin',
        networkKind: 'regtest',
        displayName: 'Bitcoin Regtest',
        feeStrategy: { rbfSupported: true },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry: { get: (id) => (id === CHAIN ? descriptor : null) },
        sdkRegistry: { get: () => sdk },
        signerPool: { get: () => ({ signPsbt }), has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return {
        host, rows, put, createTx, broadcastTx, signPsbt, decomposePsbt, decodeActionStringFromPsbt,
    };
}

const call = (host, request) => host.handle({ type: 'tx.replace', request: {
    chainId: CHAIN, walletId: WALLET, originalTxHash: ORIGINAL, strategy: 'speedup', ...request,
} });

describe('tx.replace background route', () => {
    it('plans, signs, audits, and broadcasts a speedup', async () => {
        const h = harness();
        const response = await call(h.host, {});

        expect(response).toMatchObject({
            ok: true,
            result: { replacementTxHash: REPLACEMENT, feeIncrease: '0.00001' },
        });
        expect(h.createTx).toHaveBeenCalledWith(expect.objectContaining({
            data: 'SEND|0|XCHAIN|1|destination',
            fee: 2000,
            rbf: true,
            options: { exactInputs: true },
            customOutputs: [{ address: DESTINATION, value: 7000 }],
        }));
        expect(h.signPsbt).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN,
            psbtHex: 'replacement-psbt',
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
        }));
        expect(h.broadcastTx).toHaveBeenCalledWith('signed-tx');
        expect([...h.rows.values()]).toEqual(expect.arrayContaining([
            expect.objectContaining({ txid: ORIGINAL, status: 'rbf-replaced', rbfReplacement: REPLACEMENT }),
            expect.objectContaining({ txid: REPLACEMENT, status: 'broadcast', psbtHex: 'replacement-psbt' }),
        ]));
    });

    it('cancels entirely to the wallet without reproducing action data', async () => {
        const h = harness();
        const response = await call(h.host, { strategy: 'cancel' });

        expect(response.ok, JSON.stringify(response.error)).toBe(true);
        expect(h.createTx.mock.calls[0][0]).not.toHaveProperty('data');
        expect(h.createTx.mock.calls[0][0].customOutputs).toEqual([{ address: SOURCE, value: 8000 }]);
        expect(h.decodeActionStringFromPsbt).not.toHaveBeenCalled();
    });

    it('restores the original payment while replacing the cancel transaction', async () => {
        const h = harness([
            pending(ORIGINAL, 'original-psbt', { status: 'rbf-replaced', rbfReplacement: CANCEL }),
            pending(CANCEL, 'cancel-psbt', { id: 'pending-cancel', toAddress: SOURCE }),
        ]);
        const response = await call(h.host, {
            strategy: 'restore', originalTxHash: CANCEL, restoreTxHash: ORIGINAL,
        });

        expect(response.ok, JSON.stringify(response.error)).toBe(true);
        expect(h.createTx).toHaveBeenCalledWith(expect.objectContaining({
            data: 'SEND|0|XCHAIN|1|destination',
            customOutputs: [{ address: DESTINATION, value: 7000 }],
        }));
        expect(h.rows.get('pending-cancel')).toMatchObject({
            status: 'rbf-replaced', rbfReplacement: REPLACEMENT,
        });
    });

    it('fails closed before signing when the transaction is not replaceable', async () => {
        const h = harness([pending(ORIGINAL, 'original-psbt', { rbf: false })]);
        const response = await call(h.host, {});

        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/did not signal/);
        expect(h.signPsbt).not.toHaveBeenCalled();
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });

    it('refuses an encoder response that diverts a replacement output', async () => {
        const h = harness();
        h.decomposePsbt.mockImplementation((hex) => (
            hex === 'original-psbt'
                ? originalPlan
                : decomposition([{ address: 'bcrt1qattacker', value: 8000 }])
        ));
        const response = await call(h.host, {});

        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/changed a replacement payment/);
        expect(h.signPsbt).not.toHaveBeenCalled();
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });

    it('refuses an encoder response with an extra action carrier', async () => {
        const h = harness();
        h.decomposePsbt.mockImplementation((hex) => (
            hex === 'original-psbt'
                ? originalPlan
                : decomposition([
                    { address: null, scriptPubKeyHex: '6a0100', value: 0 },
                    { address: null, scriptPubKeyHex: '6a0101', value: 0 },
                    { address: DESTINATION, value: 7000 },
                    { address: SOURCE, value: 1000 },
                ])
        ));
        const response = await call(h.host, {});

        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/changed the replacement action carrier/);
        expect(h.signPsbt).not.toHaveBeenCalled();
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });

    it('records a signed replacement as failed when broadcast rejects', async () => {
        const h = harness();
        h.broadcastTx.mockRejectedValueOnce(new Error('mempool conflict'));
        const response = await call(h.host, {});

        expect(response.ok).toBe(false);
        expect([...h.rows.values()]).toEqual(expect.arrayContaining([
            expect.objectContaining({ txid: REPLACEMENT, status: 'failed', error: 'mempool conflict' }),
            expect.objectContaining({ txid: ORIGINAL, status: 'broadcast', rbfReplacement: null }),
        ]));
    });
});
