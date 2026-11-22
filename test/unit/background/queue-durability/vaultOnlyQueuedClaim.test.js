// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A send that queued but whose queue snapshot never saved survives a restart
// only as a 'queued' vault record. Its coins and the name it sells must still
// be held by the next claim, before anyone opens a queue screen, or a new send
// signs the same inputs and the stranded one can be retried into a conflict.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Transaction } from 'bitcoinjs-lib';

const { sendTokenMock, orderActionMock } = vi.hoisted(() => ({
    sendTokenMock: vi.fn(),
    orderActionMock: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, sendToken: sendTokenMock, orderAction: orderActionMock } };
});

import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';

const COIN_A = 'aa'.repeat(32);
const PSBT_INPUTS = {
    'psbt-a': [{ prevTxHash: COIN_A, prevTxIndex: 0 }],
    'psbt-c': [{ prevTxHash: 'cc'.repeat(32), prevTxIndex: 1 }],
};

// Signed bytes spending COIN_A:0. Admission reads only the outpoints, so no signature is needed.
function queuedSpendOfCoinA() {
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput(Buffer.from(COIN_A, 'hex'), 0, 0xfffffffd);
    tx.addOutput(Buffer.from(`0014${'11'.repeat(20)}`, 'hex'), 10000);
    return tx.toHex();
}
const RAW_A = queuedSpendOfCoinA();

const QUEUED_RECORD = {
    id: 'ptx-stranded',
    status: 'queued',
    txHex: RAW_A,
    txid: Transaction.fromHex(RAW_A).getId(),
    fromAddress: 'source-one',
    chain: 'bitcoin',
    network: 'mainnet',
    actionSummary: 'Sell ALPHA',
    createdAt: '2020-01-01T00:00:00.000Z',
    params: { GIVE_OWNERSHIP: 1, GIVE_TICK: 'ALPHA' },
};

function makeVault({
    unreadableWallet = null, queuedWallet = 'wallet-one', recordStatus = 'queued', failPendingReads = false,
} = {}) {
    const queuedRecord = {
        ...QUEUED_RECORD,
        status: recordStatus,
        fromAddress: queuedWallet === 'wallet-two' ? 'source-two' : 'source-one',
    };
    return {
        settings: { get: async () => ({ activeNetwork: 'mainnet' }) },
        wallets: {
            list: async () => [{ id: 'wallet-one' }, ...(
                unreadableWallet || queuedWallet === 'wallet-two' ? [{ id: 'wallet-two' }] : []
            )],
            get: async (id) => {
                if (id === unreadableWallet) throw new Error('wallet record could not be decrypted');
                return { id, importedKeys: [] };
            },
        },
        accounts: {
            get: async (id) => ({
                'acct-one': { id, walletId: 'wallet-one' },
                'acct-two': { id, walletId: 'wallet-two' },
            }[id] ?? null),
            findBy: async (field, value) => ({
                'wallet-one': [{ id: 'acct-one', walletId: 'wallet-one' }],
                'wallet-two': [{ id: 'acct-two', walletId: 'wallet-two' }],
            }[value] ?? []),
        },
        addresses: {
            list: async () => [
                { id: 'addr-one', address: 'source-one', accountId: 'acct-one', chain: 'bitcoin', network: 'mainnet' },
                { id: 'addr-two', address: 'source-two', accountId: 'acct-two', chain: 'bitcoin', network: 'mainnet' },
            ],
        },
        pendingTxs: {
            put: async () => {},
            get: async (id) => (id === queuedRecord.id ? { ...queuedRecord } : null),
            list: async () => [{ ...queuedRecord }],
            findBy: async (field, value) => {
                if (failPendingReads) throw new Error('pending transaction table is unavailable');
                return field === 'status' && value === recordStatus ? [{ ...queuedRecord }] : [];
            },
        },
    };
}

function makeHost(vaultOpts) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: makeVault(vaultOpts),
        chainRegistry: {
            chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'mainnet' ? 'bitcoin-mainnet' : null),
            get: (id) => (id === 'bitcoin-mainnet' ? { id, coin: 'bitcoin', networkKind: 'mainnet' } : null),
            descriptorFor: (id) => (id === 'bitcoin-mainnet' ? { id, coin: 'bitcoin', networkKind: 'mainnet' } : null),
            list: () => [],
        },
        sdkRegistry: {
            for: () => ({}),
            get: () => ({
                wallet: { decomposePsbt: (hex) => ({ inputs: PSBT_INPUTS[hex] ?? [] }) },
                encoder: { getUTXOs: async () => ({ utxos: [] }) },
            }),
        },
    });
}

function actionRequest(type, psbtHex, params) {
    return {
        type,
        request: {
            walletId: 'wallet-one',
            chainId: 'bitcoin-mainnet',
            from: { address: 'source-one' },
            to: 'recipient-one',
            tick: 'BTC',
            amount: '0.0003',
            ...(params ? { params } : {}),
            prebuiltPsbt: { psbtHex },
        },
    };
}

beforeEach(() => {
    sendTokenMock.mockReset();
    orderActionMock.mockReset();
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('a queued send the vault alone still holds', () => {
    it('holds its coins against a new send before any queue screen opens', async () => {
        const host = makeHost();

        const refused = await host.handle(actionRequest('action.send', 'psbt-a'));
        expect(refused).toMatchObject({ ok: false, error: { name: 'InputsAlreadySpentError' } });
        expect(sendTokenMock).not.toHaveBeenCalled();
        const listed = await host.handle({ type: 'broadcast.queue.list', request: { walletId: 'wallet-one' } });
        expect(listed.result.map((entry) => entry.pendingTxId)).toEqual([QUEUED_RECORD.id]);
    });

    it('holds the name it sells against a second sale before any queue screen opens', async () => {
        const host = makeHost();

        const refused = await host.handle(actionRequest('action.order', 'psbt-c', { GIVE_OWNERSHIP: 1, GIVE_TICK: 'alpha' }));
        expect(refused).toMatchObject({ ok: false, error: { name: 'NameSaleInFlightError' } });
        expect(orderActionMock).not.toHaveBeenCalled();
    });

    it('holds coins from an interrupted broadcasting record', async () => {
        const host = makeHost({ recordStatus: 'broadcasting' });

        await expect(host.handle(actionRequest('action.send', 'psbt-a')))
            .resolves.toMatchObject({ ok: false, error: { name: 'InputsAlreadySpentError' } });
        expect(sendTokenMock).not.toHaveBeenCalled();
    });

    it('lets a send over other coins through', async () => {
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-c' });
        const host = makeHost();

        await expect(host.handle(actionRequest('action.send', 'psbt-c'))).resolves.toEqual({ ok: true, result: { txid: 'tx-c' } });
    });

    it('holds a record owned by an unreadable wallet without blocking unrelated coins', async () => {
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-c' });
        const host = makeHost({ unreadableWallet: 'wallet-two', queuedWallet: 'wallet-two' });

        await expect(host.handle(actionRequest('action.send', 'psbt-a')))
            .resolves.toMatchObject({ ok: false, error: { name: 'InputsAlreadySpentError' } });
        await expect(host.handle(actionRequest('action.send', 'psbt-c'))).resolves.toEqual({ ok: true, result: { txid: 'tx-c' } });
        expect(sendTokenMock).toHaveBeenCalledTimes(1);
    });

    it('refuses admission when durable queued records cannot be checked', async () => {
        const host = makeHost({ failPendingReads: true });

        await expect(host.handle(actionRequest('action.send', 'psbt-c')))
            .resolves.toMatchObject({ ok: false, error: { name: 'QueuedSendCheckFailedError' } });
        expect(sendTokenMock).not.toHaveBeenCalled();
    });
});
