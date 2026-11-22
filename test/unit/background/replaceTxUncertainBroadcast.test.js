// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { networks, Transaction } from 'bitcoinjs-lib';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import {
    rbfFailureMessage,
    RBF_REPLACEMENT_QUEUED_MESSAGE,
} from '../../../packages/core/src/shared/utils/rbfFailureMessage.js';

const CHAIN = 'bitcoin-regtest';
const WALLET = 'wallet-1';
const SOURCE = 'bcrt1qwallet';
const DESTINATION = 'bcrt1qrecipient';
const ORIGINAL = 'aa'.repeat(32);
const OTHER = 'dd'.repeat(32);
const INPUT = '11'.repeat(32);
const SIGNED = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
const SIGNED_TX = SIGNED.txHex;
const REPLACEMENT = Transaction.fromHex(SIGNED_TX).getId();

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

function pending() {
    return {
        id: 'pending-aaaa',
        chain: 'bitcoin',
        network: 'regtest',
        fromAddress: SOURCE,
        toAddress: DESTINATION,
        action: 'SEND',
        actionSummary: 'Send XCHAIN',
        psbtHex: 'original-psbt',
        txHex: '00'.repeat(250),
        txid: ORIGINAL,
        status: 'broadcast',
        rbf: true,
        rbfReplacement: null,
    };
}

function makeDecomposePsbt(createTx) {
    return vi.fn((hex) => {
        if (hex === 'original-psbt') return originalPlan;
        if (hex !== 'replacement-psbt') throw new Error(`unexpected PSBT ${hex}`);
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
    });
}

function makeVault(rows, put) {
    return {
        wallets: { get: vi.fn(async () => ({ id: WALLET, importedKeys: [] })) },
        accounts: { findBy: vi.fn(async () => [{ id: 'account-1', walletId: WALLET }]) },
        addresses: { list: vi.fn(async () => [{
            id: 'address-1',
            accountId: 'account-1',
            address: SOURCE,
            publicKey: '02'.padEnd(66, '1'),
            derivationPath: "m/84'/1'/0'/0/0",
            source: 'hd',
        }]) },
        pendingTxs: {
            list: vi.fn(async () => [...rows.values()]),
            get: vi.fn(async (id) => rows.get(id) ?? null),
            findBy: vi.fn(async (field, value) => [...rows.values()].filter((row) => row[field] === value)),
            put,
            update: vi.fn(async (id, decide) => {
                const next = decide(rows.get(id) ?? null);
                if (next == null) return false;
                await put(next);
                return true;
            }),
        },
        settings: { get: vi.fn(async () => ({ activeNetwork: 'regtest' })) },
    };
}

function harness() {
    const row = pending();
    const rows = new Map([[row.id, row]]);
    const put = vi.fn(async (next) => { rows.set(next.id, next); return next; });
    const createTx = vi.fn(async () => ({ psbt: 'replacement-psbt', encoding: 'OP_RETURN' }));
    const broadcastTx = vi.fn(async () => ({ txid: REPLACEMENT }));
    const signPsbt = vi.fn(async () => ({
        signedPsbtHex: 'signed-replacement', txHex: SIGNED_TX, txid: REPLACEMENT,
    }));
    const decomposePsbt = makeDecomposePsbt(createTx);
    const tracker = trackerFor(SIGNED.prevouts, networks.regtest);
    const sdk = {
        encoder: { createTx, broadcastTx, getUTXOs: tracker.getUTXOs },
        decoder: { decodeActionStringFromPsbt: vi.fn(() => ({
            ok: true, actionString: 'SEND|0|XCHAIN|1|destination',
        })) },
        wallet: { decomposePsbt, getBitcoinNetwork: () => networks.regtest },
    };
    const vault = makeVault(rows, put);
    const host = createBackgroundHost({
        vault,
        chainRegistry: {
            get: (id) => (id === CHAIN ? {
                id: CHAIN, coin: 'bitcoin', networkKind: 'regtest', displayName: 'Bitcoin Regtest',
                feeStrategy: { rbfSupported: true },
            } : null),
            chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? CHAIN : null),
        },
        sdkRegistry: { get: () => sdk },
        signerPool: { get: () => ({ signPsbt }), has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, rows, put, broadcastTx, signPsbt };
}

const call = (host, request = {}) => host.handle({ type: 'tx.replace', request: {
    chainId: CHAIN,
    walletId: WALLET,
    originalTxHash: ORIGINAL,
    strategy: 'speedup',
    ...request,
} });

const queueOf = async (host) => (await host.handle({
    type: 'broadcast.queue.list', request: { walletId: WALLET },
})).result;

describe('tx.replace after a broadcast that resolved without its txid', () => {
    const cases = [['returns no txid', {}, /did not return a txid/],
        ['returns another txid', { txid: OTHER }, /did not match signed transaction/]];

    it.each(cases)('queues the replacement as uncertain, never failed, when the encoder %s', async (_label, reply, message) => {
        const h = harness();
        h.broadcastTx.mockResolvedValueOnce(reply);
        const response = await call(h.host);

        expect(response.ok).toBe(false);
        expect(response.error.name).toBe('BroadcastFailedTransientError');
        expect(response.error.message).toMatch(message);
        expect(rbfFailureMessage(response.error, 'fallback')).toBe(RBF_REPLACEMENT_QUEUED_MESSAGE);
        const statuses = h.put.mock.calls.map(([row]) => row)
            .filter((row) => row.txid === REPLACEMENT).map((row) => row.status);
        expect(statuses).not.toContain('failed');
        expect([...h.rows.values()]).toEqual(expect.arrayContaining([
            expect.objectContaining({ txid: REPLACEMENT, status: 'queued' }),
            expect.objectContaining({ txid: ORIGINAL, status: 'broadcast', rbfReplacement: null }),
        ]));
        expect(await queueOf(h.host)).toEqual([expect.objectContaining({
            signedTxHex: SIGNED_TX,
            txid: REPLACEMENT,
            rbfReplacesPendingTxId: 'pending-aaaa',
            resumedClaim: true,
        })]);
    });

    it('retires the original when the re-send of an uncertain replacement is already known', async () => {
        const h = harness();
        h.broadcastTx.mockResolvedValueOnce({});
        await call(h.host);
        const [entry] = await queueOf(h.host);
        h.broadcastTx.mockRejectedValueOnce(new Error('Encoder RPC error: txn-already-known'));

        const sent = await h.host.handle({
            type: 'broadcast.queue.broadcast', request: { walletId: WALLET, id: entry.id },
        });
        expect(sent.ok, JSON.stringify(sent.error)).toBe(true);
        expect([...h.rows.values()]).toEqual(expect.arrayContaining([
            expect.objectContaining({ txid: REPLACEMENT, status: 'broadcast' }),
            expect.objectContaining({ txid: ORIGINAL, status: 'rbf-replaced', rbfReplacement: REPLACEMENT }),
        ]));
        expect(await queueOf(h.host)).toEqual([]);
    });

    it.each(cases)('tracks the signed txid when the re-send of an uncertain replacement again %s', async (_label, reply) => {
        const h = harness();
        h.broadcastTx.mockResolvedValue(reply);
        await call(h.host);
        const [entry] = await queueOf(h.host);

        await h.host.handle({
            type: 'broadcast.queue.broadcast', request: { walletId: WALLET, id: entry.id },
        });
        const rows = [...h.rows.values()];
        expect(rows.some((row) => row.txid === OTHER || row.rbfReplacement === OTHER)).toBe(false);
        expect(rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ txid: REPLACEMENT, status: 'broadcast' }),
            expect.objectContaining({ txid: ORIGINAL, status: 'rbf-replaced', rbfReplacement: REPLACEMENT }),
        ]));
    });

    it('refuses replacement queue metadata whose txid differs from its signed bytes', async () => {
        const h = harness();
        h.broadcastTx.mockResolvedValueOnce({});
        await call(h.host);
        const [entry] = await queueOf(h.host);
        entry.txid = OTHER;
        h.broadcastTx.mockResolvedValueOnce({ txid: REPLACEMENT });

        const sent = await h.host.handle({
            type: 'broadcast.queue.broadcast', request: { walletId: WALLET, id: entry.id },
        });

        expect(sent.ok).toBe(false);
        expect(sent.error.message).toMatch(/txid does not match its signed transaction bytes/);
        expect(h.broadcastTx).toHaveBeenCalledTimes(1);
        expect([...h.rows.values()].some((row) => row.txid === OTHER || row.rbfReplacement === OTHER)).toBe(false);
        expect([...h.rows.values()]).toEqual(expect.arrayContaining([
            expect.objectContaining({ txid: REPLACEMENT, status: 'queued' }),
            expect.objectContaining({ txid: ORIGINAL, status: 'broadcast', rbfReplacement: null }),
        ]));
    });

    it('derives replacement identity when only the durable record retains the original link', async () => {
        const h = harness();
        h.broadcastTx.mockResolvedValueOnce({});
        await call(h.host);
        const [entry] = await queueOf(h.host);
        delete entry.rbfReplacesPendingTxId;
        h.broadcastTx.mockResolvedValueOnce({ txid: OTHER });

        const sent = await h.host.handle({
            type: 'broadcast.queue.broadcast', request: { walletId: WALLET, id: entry.id },
        });

        expect(sent.ok, JSON.stringify(sent.error)).toBe(true);
        expect(sent.result.txid).toBe(REPLACEMENT);
        expect([...h.rows.values()].some((row) => row.txid === OTHER || row.rbfReplacement === OTHER)).toBe(false);
        expect([...h.rows.values()]).toEqual(expect.arrayContaining([
            expect.objectContaining({ txid: REPLACEMENT, status: 'broadcast' }),
            expect.objectContaining({ txid: ORIGINAL, status: 'rbf-replaced', rbfReplacement: REPLACEMENT }),
        ]));
    });

    it('refuses a second speed-up while an uncertain replacement is queued', async () => {
        const h = harness();
        h.broadcastTx.mockResolvedValueOnce({ txid: OTHER });
        await call(h.host);
        const again = await call(h.host);

        expect(again.ok).toBe(false);
        expect(again.error.message).toMatch(/already waiting in the queued-transactions banner/);
        expect(h.signPsbt).toHaveBeenCalledTimes(1);
    });
});
