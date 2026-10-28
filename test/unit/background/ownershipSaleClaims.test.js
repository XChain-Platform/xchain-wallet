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
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

const PSBT_INPUTS = {
    'psbt-a': [{ prevTxHash: 'aa'.repeat(32), prevTxIndex: 0 }],
    'psbt-b': [{ prevTxHash: 'AA'.repeat(32), prevTxIndex: 0 }],
    'psbt-c': [{ prevTxHash: 'cc'.repeat(32), prevTxIndex: 1 }],
    'psbt-d': [{ prevTxHash: 'dd'.repeat(32), prevTxIndex: 2 }],
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
});
