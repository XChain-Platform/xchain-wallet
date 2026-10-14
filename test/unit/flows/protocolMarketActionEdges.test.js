// Copyright (c) 2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isNativeGiveOrder: vi.fn(),
    recordAutopayConsent: vi.fn(),
    submitAction: vi.fn(),
}));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: mocks.submitAction,
}));
vi.mock('../../../packages/core/src/flows/autopayConsent.js', () => ({
    isNativeGiveOrder: mocks.isNativeGiveOrder,
    recordAutopayConsent: mocks.recordAutopayConsent,
}));

import { dispenserAction } from '../../../packages/core/src/flows/dispenserAction.js';
import { cancelOrder, editOrder, orderAction } from '../../../packages/core/src/flows/orderAction.js';

const FROM = {
    address: 'bcrt1qmarketowner',
    publicKey: `03${'cd'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/2",
};
const ORDER = {
    VERSION: '0',
    GIVE_TICK: 'SELL',
    GIVE_AMOUNT: '2',
    GET_TICK: 'BUY',
    GET_AMOUNT: '3',
};

function opts(params, extra = {}) {
    return {
        vault: {},
        walletId: 'wallet-1',
        password: 'secret',
        chainRegistry: {},
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        from: FROM,
        params,
        ...extra,
    };
}

function submission() {
    return mocks.submitAction.mock.calls.at(-1)[0];
}

beforeEach(() => {
    mocks.submitAction.mockReset();
    mocks.submitAction.mockResolvedValue({ txid: 'market-tx' });
    mocks.isNativeGiveOrder.mockReset();
    mocks.isNativeGiveOrder.mockReturnValue(false);
    mocks.recordAutopayConsent.mockReset();
    mocks.recordAutopayConsent.mockResolvedValue({});
});

describe('ORDER guard and description edges', () => {
    it.each([
        ['opts', undefined, 'orderAction: opts is required'],
        ['params', opts(null), 'orderAction: params is required'],
        ['both tick sides', opts({ GIVE_TICK: '', GET_TICK: '', GIVE_AMOUNT: '1', GET_AMOUNT: '1' }), 'at least one of params.GIVE_TICK or params.GET_TICK'],
        ['give amount', opts({ GIVE_TICK: 'A', GET_TICK: 'B', GET_AMOUNT: '1' }), 'params.GIVE_AMOUNT is required'],
        ['get amount', opts({ GIVE_TICK: 'A', GET_TICK: 'B', GIVE_AMOUNT: '1' }), 'params.GET_AMOUNT is required'],
    ])('rejects a missing %s before submission', async (_name, input, message) => {
        await expect(orderAction(input)).rejects.toThrow(message);
        expect(mocks.submitAction).not.toHaveBeenCalled();
    });

    it('allows ownership on both sides without amount fields', async () => {
        const params = {
            GIVE_TICK: 'ART',
            GIVE_OWNERSHIP: '1',
            GET_TICK: 'NAME',
            GET_OWNERSHIP: 1,
        };
        await orderAction(opts(params));

        expect(submission().actionData).toEqual({ action: 'ORDER', params });
        expect(submission().pendingTxMeta.actionSummary)
            .toBe('Place order: give ownership of ART, get ownership of NAME');
    });

    it('uses coin labels when a native side has an empty ticker', async () => {
        const params = {
            GIVE_TICK: '',
            GIVE_COIN: 'BTC',
            GIVE_AMOUNT: '0.1',
            GET_TICK: 'UNIT',
            GET_AMOUNT: '4',
        };
        await orderAction(opts(params));
        expect(submission().pendingTxMeta.actionSummary)
            .toBe('Place order: give 0.1 BTC, get 4 UNIT');
    });

    it.each([
        [cancelOrder, 'cancelOrder: opts is required'],
        [editOrder, 'editOrder: opts is required'],
    ])('rejects missing management options before source normalization', async (action, message) => {
        await expect(action()).rejects.toThrow(message);
    });

    it('omits an empty cancel memo and can suppress pending metadata', async () => {
        await cancelOrder(opts({ ORDER_ACTION_INDEX: '8', MEMO: '' }, { trackPendingTx: false }));
        expect(submission().actionData).toEqual({
            action: 'ORDER',
            params: { VERSION: '1', ORDER_ACTION_INDEX: '8' },
        });
        expect(submission().pendingTxMeta).toBeUndefined();
    });

    it('accepts the detach boundary for an order list edit', async () => {
        await editOrder(opts({ ALLOW_LIST: '0', BLOCK_LIST: '', MEMO: '' }, {
            orderActionIndex: '8',
        }));
        expect(submission().actionData.params).toEqual({
            VERSION: '2', ORDER_ACTION_INDEX: '8', ALLOW_LIST: '0',
        });
    });
});

describe('ORDER auto-pay result edges', () => {
    it('arms auto-pay from a nested broadcast txid', async () => {
        mocks.isNativeGiveOrder.mockReturnValue(true);
        mocks.submitAction.mockResolvedValue({ broadcast: { txid: 'nested-tx' } });

        const result = await orderAction(opts(ORDER, { autopay: { enabled: true } }));

        expect(mocks.recordAutopayConsent).toHaveBeenCalledWith({
            vault: expect.any(Object),
            walletId: 'wallet-1',
            chainId: 'bitcoin-regtest',
            sourceAddress: FROM.address,
            txid: 'nested-tx',
            params: ORDER,
        });
        expect(result).toMatchObject({ autopayArmed: true });
    });

    it('reports a missing broadcast txid without attempting a consent write', async () => {
        mocks.isNativeGiveOrder.mockReturnValue(true);
        mocks.submitAction.mockResolvedValue({ psbtHex: 'unsigned' });

        await expect(orderAction(opts(ORDER, { autopay: { enabled: true } }))).resolves.toMatchObject({
            autopayArmed: false,
            autopayConsentError: 'no txid on broadcast result',
        });
        expect(mocks.recordAutopayConsent).not.toHaveBeenCalled();
    });

    it.each([
        [new Error('vault sealed'), 'vault sealed'],
        ['storage offline', 'storage offline'],
    ])('keeps a broadcast successful when consent storage rejects %#', async (failure, message) => {
        mocks.isNativeGiveOrder.mockReturnValue(true);
        mocks.recordAutopayConsent.mockRejectedValue(failure);

        await expect(orderAction(opts(ORDER, { autopay: { enabled: true } }))).resolves.toMatchObject({
            txid: 'market-tx',
            autopayArmed: false,
            autopayConsentError: message,
        });
    });

    it('does not inspect native-order eligibility when auto-pay is disabled', async () => {
        await orderAction(opts(ORDER, { autopay: { enabled: false } }));
        expect(mocks.isNativeGiveOrder).not.toHaveBeenCalled();
        expect(mocks.recordAutopayConsent).not.toHaveBeenCalled();
    });
});

describe('DISPENSER guard and summary edges', () => {
    it.each([
        ['opts', undefined, 'dispenserAction: opts is required'],
        ['params', opts(null), 'dispenserAction: params is required'],
        ['create ticker', opts({ GIVE_AMOUNT: '1', GET_AMOUNT: '1', GET_TICK: 'BUY' }), 'params.GIVE_TICK is required for create'],
        ['create give amount', opts({ GIVE_TICK: 'SELL', GET_AMOUNT: '1', GET_TICK: 'BUY' }), 'params.GIVE_AMOUNT is required for create'],
        ['create get amount', opts({ GIVE_TICK: 'SELL', GIVE_AMOUNT: '1', GET_TICK: 'BUY' }), 'params.GET_AMOUNT is required for create'],
        ['create payment asset', opts({ GIVE_TICK: 'SELL', GIVE_AMOUNT: '1', GET_AMOUNT: '1' }), 'params.GET_TICK (token-paid) or params.GET_COIN (coin-paid) is required for create'],
        ['index version', opts({ VERSION: '0', DISPENSER_ACTION_INDEX: '4' }), 'DISPENSER_ACTION_INDEX requires VERSION 1 or 2'],
    ])('rejects a missing or invalid %s', async (_name, input, message) => {
        await expect(dispenserAction(input)).rejects.toThrow(message);
        expect(mocks.submitAction).not.toHaveBeenCalled();
    });

    it('allows an ownership dispenser without GIVE_AMOUNT', async () => {
        const params = {
            GIVE_TICK: 'ART',
            GIVE_OWNERSHIP: '1',
            GET_AMOUNT: '2',
            GET_COIN: 'BTC',
        };
        await dispenserAction(opts(params));

        expect(submission().actionData).toEqual({ action: 'DISPENSER', params });
        expect(submission().pendingTxMeta.actionSummary)
            .toBe('Open dispenser: sell ownership of ART for 2 BTC');
    });

    it('uses the escrow fallback in a balance dispenser summary', async () => {
        await dispenserAction(opts({
            GIVE_TICK: 'SELL', GIVE_AMOUNT: '1', GET_AMOUNT: '2', GET_TICK: 'BUY',
        }));
        expect(submission().pendingTxMeta.actionSummary)
            .toBe('Open dispenser: 1 SELL per fill (escrow ?)');
    });

    it.each([
        ['1', 'Cancel dispenser #4'],
        ['2', 'Edit dispenser #4'],
    ])('describes a v%s index operation', async (version, actionSummary) => {
        await dispenserAction(opts({ VERSION: version, DISPENSER_ACTION_INDEX: '4' }));
        expect(submission().pendingTxMeta.actionSummary).toBe(actionSummary);
    });
});
