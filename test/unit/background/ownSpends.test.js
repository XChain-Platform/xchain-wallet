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

const { sendTokenMock } = vi.hoisted(() => ({ sendTokenMock: vi.fn() }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: { ...actual.flows, sendToken: sendTokenMock },
    };
});

import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { OWN_SPEND_HOLD_MS, createOwnSpendLedger } from '../../../packages/extension/src/background/ownSpends.js';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

// Each fake PSBT names the outpoints it spends.
const PSBT_INPUTS = {
    'psbt-a': [{ prevTxHash: 'aa'.repeat(32), prevTxIndex: 0 }],
    'psbt-b': [{ prevTxHash: 'AA'.repeat(32), prevTxIndex: 0 }],
    'psbt-c': [{ prevTxHash: 'cc'.repeat(32), prevTxIndex: 1 }],
};

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
            get: () => ({ wallet: { decomposePsbt: (hex) => ({ inputs: PSBT_INPUTS[hex] ?? [] }) } }),
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
            .mockResolvedValueOnce({ queued: true, txid: 'tx-q' })
            .mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        await expect(host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003')))
            .resolves.toMatchObject({ ok: false, error: { name: 'InvalidPasswordError' } });
        await expect(host.handle(sendRequest('psbt-a', 'recipient-one', '0.0003')))
            .resolves.toEqual({ ok: true, result: { queued: true, txid: 'tx-q' } });
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
