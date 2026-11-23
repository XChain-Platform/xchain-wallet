// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An order or a dispenser spends coins like a send, so the background claims
// its inputs the same way. A sale of a name also claims the name: the network
// refuses a second listing while the first holds it in escrow, so a second
// surface selling the same name over other coins is refused before it signs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { orderActionMock, dispenserActionMock } = vi.hoisted(() => ({
    orderActionMock: vi.fn(),
    dispenserActionMock: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: { ...actual.flows, orderAction: orderActionMock, dispenserAction: dispenserActionMock },
    };
});

import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { OWN_SPEND_HOLD_MS } from '../../../packages/extension/src/background/ownSpends.js';
import { createBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { BroadcastFailedError } from '../../../packages/core/src/sdk/submitWithSigner.js';
import { RevealInputsRefusedError } from '../../../packages/core/src/sdk/p2shRevealInputs.js';

const PSBT_INPUTS = {
    'psbt-a': [{ prevTxHash: 'aa'.repeat(32), prevTxIndex: 0 }],
    'psbt-b': [{ prevTxHash: 'AA'.repeat(32), prevTxIndex: 0 }],
    'psbt-c': [{ prevTxHash: 'cc'.repeat(32), prevTxIndex: 1 }],
    'psbt-d': [{ prevTxHash: 'dd'.repeat(32), prevTxIndex: 2 }],
};

function makeHost(broadcastQueueStorage = null, broadcastQueueStore = undefined) {
    return createBackgroundHost({
        broadcastQueueStorage,
        ...(broadcastQueueStore ? { broadcastQueueStore } : {}),
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: {
            settings: { get: async () => ({ activeNetwork: 'mainnet' }) },
            wallets: { list: async () => [] },
            addresses: { list: async () => [] },
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

const SALE = Object.freeze({ VERSION: '0', GIVE_COIN: 'BTC', GIVE_TICK: 'ALPHA', GIVE_OWNERSHIP: '1', GET_COIN: 'BTC', GET_AMOUNT: '0.001' });
const TOKEN_ORDER = Object.freeze({ VERSION: '0', GIVE_COIN: 'BTC', GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '5', GET_COIN: 'BTC', GET_AMOUNT: '0.001' });

function request(type, psbtHex, params) {
    return {
        type,
        request: {
            walletId: 'wallet-one',
            chainId: 'bitcoin-mainnet',
            from: { address: 'source-one' },
            params,
            prebuiltPsbt: { psbtHex },
        },
    };
}

let clock;
beforeEach(() => {
    clock = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    orderActionMock.mockReset();
    dispenserActionMock.mockReset();
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('spend claims require a complete queue inventory', () => {
    it.each([
        ['rejects', async () => { throw new Error('read refused'); }],
        ['returns no snapshot', async () => null],
    ])('fails closed when queue storage %s', async (_label, load) => {
        const host = makeHost({
            load: vi.fn(load),
            loadSettlements: vi.fn(async () => []),
            save: vi.fn(async () => {}),
            saveSettlements: vi.fn(async () => {}),
        });

        const coins = await host.handle(request('action.order', 'psbt-a', TOKEN_ORDER));
        const name = await host.handle(request('action.order', 'psbt-c', SALE));

        expect(coins.error?.name).toBe('BroadcastQueueUnavailableError');
        expect(name.error?.name).toBe('BroadcastQueueUnavailableError');
        expect(submitFailureMessage(coins.error, { fallback: 'x' })).toBe(
            "Couldn't check pending sends. Nothing was signed. Try again.",
        );
        expect(orderActionMock).not.toHaveBeenCalled();
    });

    it('fails closed while the store is fenced after a lease release', async () => {
        // A released lease fences the store before another tab takes the key,
        // and the store reads nothing until the next lease reloads it. Its map
        // is not the whole queue then, and another tab may be spending these coins.
        const storage = {
            load: vi.fn(async () => ({})),
            loadSettlements: vi.fn(async () => []),
            save: vi.fn(async () => {}),
            saveSettlements: vi.fn(async () => {}),
        };
        const store = createBroadcastQueueStore({ storage });
        store.dormant = true;
        const host = makeHost(storage, store);

        const coins = await host.handle(request('action.order', 'psbt-a', TOKEN_ORDER));

        expect(coins.error?.name).toBe('BroadcastQueueUnavailableError');
        expect(storage.load).not.toHaveBeenCalled();
        expect(orderActionMock).not.toHaveBeenCalled();
    });
});

describe('orders and sales claim what they spend', () => {
    it('refuses a second sale of the same name from another surface over other coins', async () => {
        orderActionMock.mockResolvedValueOnce({ txid: 'tx-a' });
        const host = makeHost();

        await expect(host.handle(request('action.order', 'psbt-a', SALE)))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-a' } });
        const second = await host.handle(request('action.order', 'psbt-c', SALE));
        expect(second.ok).toBe(false);
        expect(second.error.name).toBe('NameSaleInFlightError');
        expect(submitFailureMessage(second.error, { fallback: 'x' }))
            .toBe('ALPHA is already listed for sale from this wallet. Nothing was signed.');
        expect(orderActionMock).toHaveBeenCalledTimes(1);
    });

    it('refuses a dispenser sale of a name an order sale is still signing', async () => {
        let finish;
        orderActionMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        const host = makeHost();

        const first = host.handle(request('action.order', 'psbt-a', SALE));
        await vi.waitFor(() => expect(orderActionMock).toHaveBeenCalledTimes(1));
        const second = await host.handle(request('action.dispenser', 'psbt-c', SALE));
        expect(second.error?.name).toBe('NameSaleInFlightError');
        finish({ txid: 'tx-a' });
        await expect(first).resolves.toEqual({ ok: true, result: { txid: 'tx-a' } });
        expect(dispenserActionMock).not.toHaveBeenCalled();
    });

    it('refuses an order over coins another order just broadcast', async () => {
        orderActionMock.mockResolvedValueOnce({ txid: 'tx-a' });
        const host = makeHost();

        await host.handle(request('action.order', 'psbt-a', TOKEN_ORDER));
        const second = await host.handle(request('action.order', 'psbt-b', TOKEN_ORDER));
        expect(second.error?.name).toBe('InputsAlreadySpentError');
        expect(orderActionMock).toHaveBeenCalledTimes(1);
    });

    it('frees the name and coins of a sale that ends without a broadcast', async () => {
        orderActionMock
            .mockRejectedValueOnce(Object.assign(new Error('Incorrect password'), { name: 'InvalidPasswordError' }))
            .mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        const refused = await host.handle(request('action.order', 'psbt-a', SALE));
        expect(refused.ok).toBe(false);
        await expect(host.handle(request('action.order', 'psbt-a', SALE)))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-b' } });
    });

    it('lets the name be sold again once the hold lapses', async () => {
        orderActionMock.mockResolvedValueOnce({ txid: 'tx-a' }).mockResolvedValueOnce({ txid: 'tx-d' });
        const host = makeHost();

        await host.handle(request('action.order', 'psbt-a', SALE));
        clock += OWN_SPEND_HOLD_MS + 1;
        await expect(host.handle(request('action.order', 'psbt-d', SALE)))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-d' } });
    });

    it('sells different names from two surfaces at once', async () => {
        orderActionMock.mockResolvedValueOnce({ txid: 'tx-a' }).mockResolvedValueOnce({ txid: 'tx-c' });
        const host = makeHost();

        await host.handle(request('action.order', 'psbt-a', SALE));
        await expect(host.handle(request('action.order', 'psbt-c', { ...SALE, GIVE_TICK: 'BETA' })))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-c' } });
    });

    it('keeps a queued sale name guarded until its entry is discarded', async () => {
        orderActionMock.mockImplementationOnce(async (opts) => {
            await opts.onBroadcastFailure({
                chainId: 'bitcoin-mainnet',
                signedTxHex: 'signed-sale',
                txid: 'queued-sale',
                soldNames: ['ALPHA'],
            });
            throw Object.assign(new Error('broadcast failed (phase1): timeout'), {
                name: 'BroadcastFailedTransientError',
            });
        }).mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        await expect(host.handle(request('action.order', 'psbt-a', SALE)))
            .resolves.toMatchObject({ ok: false, error: { name: 'BroadcastFailedTransientError' } });
        await expect(host.handle(request('action.order', 'psbt-c', SALE)))
            .resolves.toMatchObject({ ok: false, error: { name: 'NameSaleInFlightError' } });
        const listed = await host.handle({
            type: 'broadcast.queue.list', request: { walletId: 'wallet-one' },
        });
        await host.handle({
            type: 'broadcast.queue.discard',
            request: { walletId: 'wallet-one', id: listed.result[0].id },
        });
        await expect(host.handle(request('action.order', 'psbt-c', SALE)))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-b' } });
    });
});

describe('a sale whose commit went out keeps its name', () => {
    const failure = (phase) => new BroadcastFailedError({
        cause: new Error('txn-mempool-conflict'),
        signedTxHex: '00',
        txid: `reveal-${phase}`,
        chainId: 'bitcoin-mainnet',
        signedAt: 1_700_000_000_000,
        encoding: 'taproot',
        phase,
    });

    it.each([
        ['action.order', orderActionMock],
        ['action.dispenser', dispenserActionMock],
    ])('keeps the name of a %s whose envelope reveal was refused', async (type, mock) => {
        mock.mockRejectedValueOnce(failure('envelope_reveal'));
        const host = makeHost();

        const first = await host.handle(request(type, 'psbt-a', SALE));
        expect(first.ok).toBe(false);
        const second = await host.handle(request(type, 'psbt-c', SALE));
        expect(second.error?.name).toBe('NameSaleInFlightError');
        expect(mock).toHaveBeenCalledTimes(1);
    });

    it('keeps the name of a sale whose phase-2 spend was refused', async () => {
        orderActionMock.mockRejectedValueOnce(failure('phase2'));
        const host = makeHost();

        await host.handle(request('action.order', 'psbt-a', SALE));
        const second = await host.handle(request('action.order', 'psbt-c', SALE));
        expect(second.error?.name).toBe('NameSaleInFlightError');
    });

    it('frees the name of a sale whose first broadcast failed', async () => {
        orderActionMock.mockRejectedValueOnce(failure('phase1')).mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        await host.handle(request('action.order', 'psbt-a', SALE));
        await expect(host.handle(request('action.order', 'psbt-c', SALE)))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-b' } });
    });

    it('frees the name of a sale whose reveal inputs were refused before anything was sent', async () => {
        orderActionMock
            .mockRejectedValueOnce(new RevealInputsRefusedError({
                reason: 'spends a coin it does not own', inputIndex: 0, phase1Txid: 'commit-a',
                phase1TxHex: '00', chainId: 'bitcoin-mainnet', encoding: 'p2sh',
            }))
            .mockResolvedValueOnce({ txid: 'tx-b' });
        const host = makeHost();

        await host.handle(request('action.order', 'psbt-a', SALE));
        await expect(host.handle(request('action.order', 'psbt-c', SALE)))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-b' } });
    });

    it('lets the name be sold again once the hold on a refused envelope reveal lapses', async () => {
        orderActionMock.mockRejectedValueOnce(failure('envelope_reveal')).mockResolvedValueOnce({ txid: 'tx-d' });
        const host = makeHost();

        await host.handle(request('action.order', 'psbt-a', SALE));
        clock += OWN_SPEND_HOLD_MS + 1;
        await expect(host.handle(request('action.order', 'psbt-d', SALE)))
            .resolves.toEqual({ ok: true, result: { txid: 'tx-d' } });
    });
});
