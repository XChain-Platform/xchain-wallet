// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Two surfaces of one wallet can each hold a review built over the same coins
// once the encoder's reservation lapses. The background refuses the second
// before signing while the first send is signing, broadcasting or recently
// broadcast, so it can neither replace the first payment nor sit doomed in
// the queue.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendTokenMock, orderActionMock, broadcastTxMock, quoteMaxSendableMock } = vi.hoisted(() => ({
    sendTokenMock: vi.fn(),
    orderActionMock: vi.fn(),
    broadcastTxMock: vi.fn(),
    quoteMaxSendableMock: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: {
            ...actual.flows,
            sendToken: sendTokenMock,
            orderAction: orderActionMock,
            quoteMaxSendable: quoteMaxSendableMock,
        },
    };
});

import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { OWN_SPEND_HOLD_MS, createOwnSpendLedger } from '../../../packages/extension/src/background/ownSpends.js';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { QUIT_DEFERRING_MESSAGE_TYPES } from '../../../packages/desktop/main/quitGuard.js';

// Each fake PSBT names the outpoints it spends.
const PSBT_INPUTS = {
    'psbt-a': [{ prevTxHash: 'aa'.repeat(32), prevTxIndex: 0 }],
    'psbt-b': [{ prevTxHash: 'AA'.repeat(32), prevTxIndex: 0 }],
    'psbt-c': [{ prevTxHash: 'cc'.repeat(32), prevTxIndex: 1 }],
};

// What the tracker reports at the source address: the coin psbt-a spends and one more.
const SOURCE_UTXOS = [
    { txid: 'aa'.repeat(32), vout: 0, value: 100000 },
    { txid: 'cc'.repeat(32), vout: 1, value: 50000 },
];

function makeHost() {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: {
            settings: { get: async () => ({ activeNetwork: 'mainnet' }) },
            wallets: { list: async () => [] },
        },
        chainRegistry: {
            get: (id) => (id === 'bitcoin-mainnet' ? { id, networkKind: 'mainnet' } : null),
            list: () => [],
        },
        sdkRegistry: {
            for: () => ({}),
            get: () => ({
                wallet: { decomposePsbt: (hex) => ({ inputs: PSBT_INPUTS[hex] ?? [] }) },
                encoder: {
                    broadcastTx: broadcastTxMock,
                    getUTXOs: async () => ({ utxos: SOURCE_UTXOS.map((row) => ({ ...row })) }),
                },
            }),
        },
    });
}

function sendRequest(psbtHex, to, amount) {
    return {
        type: 'action.send',
        request: {
            walletId: 'wallet-one',
            chainId: 'bitcoin-mainnet',
            from: { address: 'source-one' },
            to,
            tick: 'BTC',
            amount,
            prebuiltPsbt: { psbtHex },
        },
    };
}

const SPENT = {
    ok: false,
    error: {
        name: 'InputsAlreadySpentError',
        message: 'One of the coins this transaction spends has already been used. Start over to build a new one.',
    },
};

let clock;
beforeEach(() => {
    clock = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    sendTokenMock.mockReset();
    orderActionMock.mockReset();
    broadcastTxMock.mockReset();
    quoteMaxSendableMock.mockReset();
    quoteMaxSendableMock.mockResolvedValue(null);
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('sends over the same coins from two surfaces', () => {
    it('refuses a different send over coins another send just broadcast', async () => {
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-a' });
        const host = makeHost();

        await expect(host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003')))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-a' } });
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004')))
            .resolves.toEqual(SPENT);
        expect(sendTokenMock).toHaveBeenCalledTimes(1);
    });

    it('refuses the second while the first is still signing', async () => {
        let finish;
        sendTokenMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        const host = makeHost();

        const first = host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));
        await vi.waitFor(() => expect(sendTokenMock).toHaveBeenCalledTimes(1));
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004')))
            .resolves.toEqual(SPENT);
        finish({ txid: 'tx-a' });
        await expect(first).resolves.toEqual({ ok: true, result: { txid: 'tx-a' } });
        expect(sendTokenMock).toHaveBeenCalledTimes(1);
    });

    it('still names a matching send started in the same turn as already in progress', async () => {
        let finish;
        sendTokenMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        const host = makeHost();

        const first = host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));
        const second = host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));
        await expect(second).resolves.toMatchObject({ ok: false, error: { name: 'SendAlreadyInProgressError' } });
        finish({ txid: 'tx-a' });
        await expect(first).resolves.toEqual({ ok: true, result: { txid: 'tx-a' } });
        expect(sendTokenMock).toHaveBeenCalledTimes(1);
    });

    it('frees the coins when the first send ends without a broadcast', async () => {
        sendTokenMock
            .mockRejectedValueOnce(Object.assign(new Error('Wrong password'), { name: 'InvalidPasswordError' }))
            .mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        await expect(host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003')))
            .resolves.toMatchObject({ ok: false, error: { name: 'InvalidPasswordError' } });
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004')))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-b' } });
    });

    it('lets sends over other coins through, and the held coins go after the hold', async () => {
        sendTokenMock
            .mockResolvedValueOnce({ txid: 'tx-a' })
            .mockResolvedValueOnce({ txid: 'tx-c' })
            .mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        await host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));
        await expect(host.handle(sendRequest('psbt-c', 'recipient-two', '0.0004')))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-c' } });
        clock += OWN_SPEND_HOLD_MS - 1;
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004')))
            .resolves.toEqual(SPENT);
        clock += 1;
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004')))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-b' } });
    });
});

// A signed transaction spending outpoint aa..aa:0, as the queue holds it.
const RAW_A = '02000000' + '01' + 'aa'.repeat(32) + '00000000' + '00' + 'fdffffff'
    + '01' + '1027000000000000' + '16' + '0014' + '11'.repeat(20) + '00000000';

// The send signs, the node cannot be reached, and the signed bytes go to the queue.
function queueTheSend() {
    sendTokenMock.mockImplementationOnce(async (opts) => {
        await opts.onBroadcastFailure({ signedTxHex: RAW_A, txid: 'tx-q', chainId: 'bitcoin-mainnet', signedAt: 1 });
        throw Object.assign(new Error('broadcast failed (phase1): ECONNREFUSED'), { name: 'BroadcastFailedTransientError' });
    });
}
async function queuedIds(host) {
    const listed = await host.handle({ type: 'broadcast.queue.list', request: { walletId: 'wallet-one' } });
    return (listed.result ?? []).map((entry) => entry.id);
}

describe('a send waiting in the broadcast queue', () => {
    it('keeps its coins until the user discards it', async () => {
        queueTheSend();
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        await expect(host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003')))
            .resolves.toMatchObject({ ok: false, error: { name: 'BroadcastFailedTransientError' } });
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004'))).resolves.toEqual(SPENT);
        clock += OWN_SPEND_HOLD_MS * 4;
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004'))).resolves.toEqual(SPENT);

        const [id] = await queuedIds(host);
        await host.handle({ type: 'broadcast.queue.discard', request: { walletId: 'wallet-one', id } });
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004')))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-b' } });
    });

    it('still goes out from the queue, and holds its coins once it has', async () => {
        queueTheSend();
        broadcastTxMock.mockResolvedValueOnce({ txid: 'tx-q' });
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        await host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));
        const [id] = await queuedIds(host);
        await expect(host.handle({ type: 'broadcast.queue.broadcast', request: { walletId: 'wallet-one', id } }))
            .resolves.toMatchObject({ ok: true, result: { txid: 'tx-q' } });
        expect(await queuedIds(host)).toEqual([]);
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004'))).resolves.toEqual(SPENT);
        clock += OWN_SPEND_HOLD_MS;
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004')))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-b' } });
    });

    it('frees its coins when the node refuses it for good', async () => {
        queueTheSend();
        broadcastTxMock.mockRejectedValueOnce(new Error('bad-txns-inputs-missingorspent'));
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        await host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));
        const [id] = await queuedIds(host);
        await expect(host.handle({ type: 'broadcast.queue.broadcast', request: { walletId: 'wallet-one', id } }))
            .resolves.toMatchObject({ ok: false, error: { name: 'BroadcastFailedPermanentError' } });
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004')))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-b' } });
    });

    it('holds coins named by queued bytes in the ledger itself', async () => {
        const ledger = createOwnSpendLedger();
        const coin = [{ txid: 'aa'.repeat(32), vout: 0 }];
        await expect(ledger.claim('bitcoin-mainnet', coin, { queued: coin }))
            .rejects.toMatchObject({ name: 'InputsAlreadySpentError' });
        await expect(ledger.claim('bitcoin-testnet', coin, { queued: [] })).resolves.toBeTruthy();
    });
});

function actionRequest(type, psbtHex) {
    return {
        type,
        request: {
            walletId: 'wallet-one',
            chainId: 'bitcoin-mainnet',
            from: { address: 'source-one' },
            prebuiltPsbt: { psbtHex },
        },
    };
}

describe('every action the background signs over the same coins', () => {
    it('refuses an order over coins a send just spent, before the order signs', async () => {
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-a' });
        const host = makeHost();

        await host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));
        await expect(host.handle(actionRequest('action.order', 'psbt-b'))).resolves.toEqual(SPENT);
        expect(orderActionMock).not.toHaveBeenCalled();
    });

    it('refuses a send over coins an order is spending, and frees them when the order fails', async () => {
        let finish;
        orderActionMock
            .mockReturnValueOnce(new Promise((resolve, reject) => { finish = reject; }));
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        const order = host.handle(actionRequest('action.order', 'psbt-a'));
        await vi.waitFor(() => expect(orderActionMock).toHaveBeenCalledTimes(1));
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004'))).resolves.toEqual(SPENT);
        finish(Object.assign(new Error('Wrong password'), { name: 'InvalidPasswordError' }));
        await expect(order).resolves.toMatchObject({ ok: false, error: { name: 'InvalidPasswordError' } });
        await expect(host.handle(sendRequest('psbt-b', 'recipient-two', '0.0004')))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-b' } });
    });

    it('claims the coins on every signing route the desktop shell waits for at quit', async () => {
        const routes = [...QUIT_DEFERRING_MESSAGE_TYPES]
            .filter((type) => /^action\.[A-Za-z]+$/.test(type) && type !== 'action.send');
        expect(routes.length).toBeGreaterThan(40);
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-a' });
        const host = makeHost();
        await host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));

        const unclaimed = [];
        for (const type of routes) {
            const reply = await host.handle(actionRequest(type, 'psbt-b'));
            if (reply?.error?.name !== 'InputsAlreadySpentError') unclaimed.push(type);
        }
        expect(unclaimed).toEqual([]);
    });
});

describe('Max on the Send form', () => {
    const quote = (host) => host.handle({
        type: 'action.quoteMaxSendable',
        request: {
            walletId: 'wallet-one',
            chainId: 'bitcoin-mainnet',
            from: { address: 'source-one', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0" },
            to: 'recipient-two',
        },
    });
    const pricedCoins = () => quoteMaxSendableMock.mock.calls.at(-1)[0].encoderOpts.utxos;

    it('prices only the coins no other send holds', async () => {
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-a' });
        const host = makeHost();

        await quote(host);
        expect(pricedCoins()).toBeUndefined();
        await host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));
        await quote(host);
        expect(pricedCoins()).toEqual([SOURCE_UTXOS[1]]);
    });

    it('leaves out the coins of a send waiting in the broadcast queue', async () => {
        queueTheSend();
        const host = makeHost();

        await host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));
        await quote(host);
        expect(pricedCoins()).toEqual([SOURCE_UTXOS[1]]);
    });

    it('offers nothing when other sends hold every coin at the address', async () => {
        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-a' }).mockResolvedValueOnce({ txid: 'tx-c' });
        const host = makeHost();

        await host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003'));
        await host.handle(sendRequest('psbt-c', 'recipient-one', '0.0001'));
        quoteMaxSendableMock.mockClear();
        const res = await quote(host);

        expect(res.result).toMatchObject({ maxSats: '0', coinsHeld: true });
        expect(quoteMaxSendableMock).not.toHaveBeenCalled();
    });
});

describe('the refusal on the Send screen', () => {
    it('says the coins are spent and nothing was signed', () => {
        expect(submitFailureMessage(SPENT.error, { verb: 'send' })).toBe(
            'One of the coins this transaction spends has already been used. Start over to build a new one. Nothing was signed.',
        );
    });
});

describe('claims kept in a store', () => {
    function memoryStore() {
        let saved = [];
        return {
            load: async () => saved.map((e) => ({ ...e })),
            save: async (entries) => { saved = entries.map((e) => ({ ...e })); },
        };
    }
    const coin = [{ txid: 'aa'.repeat(32), vout: 0 }];

    it('still refuses the coins after the worker restarts', async () => {
        const store = memoryStore();
        const before = createOwnSpendLedger({ store });
        await before.keep(await before.claim('bitcoin-mainnet', coin));

        const after = createOwnSpendLedger({ store });
        await expect(after.claim('bitcoin-mainnet', coin)).rejects.toMatchObject({ name: 'InputsAlreadySpentError' });
    });

    it('keeps a claim made while the stored claims are still loading', async () => {
        let finishLoad;
        const store = {
            load: () => new Promise((resolve) => { finishLoad = resolve; }),
            save: async () => {},
        };
        const ledger = createOwnSpendLedger({ store });
        const first = ledger.claim('bitcoin-mainnet', coin);
        const second = ledger.claim('bitcoin-mainnet', coin);
        await vi.waitFor(() => expect(finishLoad).toBeTypeOf('function'));
        finishLoad([]);

        await expect(first).resolves.toBeTruthy();
        await expect(second).rejects.toMatchObject({ name: 'InputsAlreadySpentError' });
    });
});
