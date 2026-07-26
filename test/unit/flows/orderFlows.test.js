// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-17 ORDER management flows: the cancel (ORDER v1) and edit (ORDER v2)
// wire params, plus the cross-pair query passthroughs. The cancel wire is
// a REGRESSION GUARD: an earlier draft emitted a nonexistent `CANCEL`
// action with `OFFER_ACTION_INDEX`, which the real SDK rejects with
// UNKNOWN_ACTION (only the web dev-mock let it through, so no test caught
// it). Cancel is ORDER VERSION 1 with ORDER_ACTION_INDEX; edit is ORDER
// VERSION 2 with only the changed fields (blank = leave-unchanged).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'order-tx-1' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address, publicKey: from.publicKey,
        derivationPath: from.derivationPath || null, addressId: from.addressId || null,
    })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { cancelOrder, editOrder } from '../../../packages/core/src/flows/orderAction.js';
import {
    ordersForAddress,
    orderCancelsForAddress,
    orderDetail,
    orderLifecycleFor,
} from '../../../packages/core/src/flows/marketQueries.js';

const FROM = { address: 'addr-1', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };
function base(extra = {}) {
    return {
        vault: {}, walletId: 'w1', password: 'pw', chainRegistry: {}, sdkRegistry: {},
        chainId: 'bitcoin-regtest', from: FROM, ...extra,
    };
}

beforeEach(() => {
    vi.mocked(submitAction).mockClear();
    vi.mocked(submitAction).mockResolvedValue({ txid: 'order-tx-1' });
});

describe('cancelOrder (ORDER v1)', () => {
    it('emits ORDER v1 with ORDER_ACTION_INDEX, never a CANCEL action or OFFER_ACTION_INDEX', async () => {
        await cancelOrder(base({ orderActionIndex: '1759' }));
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData.action).toBe('ORDER');
        expect(call.actionData.params).toEqual({ VERSION: '1', ORDER_ACTION_INDEX: '1759' });
        // Regression guard: the removed bug.
        expect(call.actionData.action).not.toBe('CANCEL');
        expect(call.actionData.params).not.toHaveProperty('OFFER_ACTION_INDEX');
    });

    it('includes MEMO when provided', async () => {
        await cancelOrder(base({ orderActionIndex: '42', memo: 'done' }));
        expect(vi.mocked(submitAction).mock.calls[0][0].actionData.params).toEqual(
            { VERSION: '1', ORDER_ACTION_INDEX: '42', MEMO: 'done' },
        );
    });

    it('accepts the index via params.ORDER_ACTION_INDEX too', async () => {
        await cancelOrder(base({ params: { ORDER_ACTION_INDEX: '7' } }));
        expect(vi.mocked(submitAction).mock.calls[0][0].actionData.params.ORDER_ACTION_INDEX).toBe('7');
    });

    it('requires an order index', async () => {
        await expect(cancelOrder(base({}))).rejects.toThrow(/orderActionIndex is required/);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('forwards prebuiltPsbt', async () => {
        const prebuilt = { psbtHex: 'de', encoding: 'op_return', actionString: 'ORDER|1|42', version: 1 };
        await cancelOrder(base({ orderActionIndex: '42', prebuiltPsbt: prebuilt }));
        expect(vi.mocked(submitAction).mock.calls[0][0].prebuiltPsbt).toBe(prebuilt);
    });
});

describe('editOrder (ORDER v2)', () => {
    it('emits ORDER v2 with only the changed fields (blank = leave-unchanged)', async () => {
        await editOrder(base({ orderActionIndex: '1759', params: { EXPIRATION: '1787668145', ALLOW_LIST: '', BLOCK_LIST: '' } }));
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData.action).toBe('ORDER');
        // ALLOW_LIST/BLOCK_LIST were blank -> omitted entirely.
        expect(call.actionData.params).toEqual({ VERSION: '2', ORDER_ACTION_INDEX: '1759', EXPIRATION: '1787668145' });
    });

    it('carries allow/block list indexes and MEMO when set', async () => {
        await editOrder(base({ orderActionIndex: '9', params: { ALLOW_LIST: '100', BLOCK_LIST: '200', MEMO: 'gated' } }));
        expect(vi.mocked(submitAction).mock.calls[0][0].actionData.params).toEqual(
            { VERSION: '2', ORDER_ACTION_INDEX: '9', ALLOW_LIST: '100', BLOCK_LIST: '200', MEMO: 'gated' },
        );
    });

    it('requires an order index', async () => {
        await expect(editOrder(base({ params: { EXPIRATION: '1787668145' } }))).rejects.toThrow(/orderActionIndex is required/);
    });

    it('rejects an all-blank edit (fee-burning no-op)', async () => {
        await expect(editOrder(base({ orderActionIndex: '9', params: { MEMO: 'only a memo' } })))
            .rejects.toThrow(/at least one of EXPIRATION, ALLOW_LIST, BLOCK_LIST/);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('forwards prebuiltPsbt', async () => {
        const prebuilt = { psbtHex: 'ab', encoding: 'op_return', actionString: 'ORDER|2|9', version: 2 };
        await editOrder(base({ orderActionIndex: '9', params: { EXPIRATION: '1787668145' }, prebuiltPsbt: prebuilt }));
        expect(vi.mocked(submitAction).mock.calls[0][0].prebuiltPsbt).toBe(prebuilt);
    });
});

describe('order query passthroughs', () => {
    function fakeRegistry(sdk) {
        return { get: vi.fn(() => sdk) };
    }

    it('ordersForAddress queries getOrders(addr, "address")', async () => {
        const sdk = { getOrders: vi.fn(async () => ({ data: [] })) };
        await ordersForAddress({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', address: 'addr-1', opts: { limit: 5 } });
        expect(sdk.getOrders).toHaveBeenCalledWith('addr-1', 'address', { limit: 5 });
    });

    it('orderCancelsForAddress queries getOrderCancels(addr, "address")', async () => {
        const sdk = { getOrderCancels: vi.fn(async () => ({ data: [] })) };
        await orderCancelsForAddress({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', address: 'addr-1' });
        expect(sdk.getOrderCancels).toHaveBeenCalledWith('addr-1', 'address', undefined);
    });

    it('orderDetail queries getAction(index)', async () => {
        const sdk = { getAction: vi.fn(async () => ({ state: { status: 'open' } })) };
        await orderDetail({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', actionIndex: 1759 });
        expect(sdk.getAction).toHaveBeenCalledWith('1759');
    });

    it('each query validates its required args', async () => {
        await expect(ordersForAddress({ sdkRegistry: {}, chainId: 'c' })).rejects.toThrow(/address is required/);
        await expect(orderCancelsForAddress({ sdkRegistry: {}, chainId: 'c' })).rejects.toThrow(/address is required/);
        await expect(orderDetail({ sdkRegistry: {}, chainId: 'c' })).rejects.toThrow(/actionIndex is required/);
    });
});

// PC-21 trade lifecycle: orderLifecycleFor dispatches kind -> SDK method.
describe('orderLifecycleFor (PC-21)', () => {
    function fakeRegistry(sdk) {
        return { get: vi.fn(() => sdk) };
    }

    it('dispatches address-scoped kinds with type "address"', async () => {
        const sdk = {
            getOrderEdits: vi.fn(async () => ({ data: [] })),
            getOrderExpires: vi.fn(async () => ({ data: [] })),
            getOrderCancels: vi.fn(async () => ({ data: [] })),
        };
        const reg = fakeRegistry(sdk);
        await orderLifecycleFor({ sdkRegistry: reg, chainId: 'c', kind: 'edits', query: 'addr-1', opts: { limit: 5 } });
        expect(sdk.getOrderEdits).toHaveBeenCalledWith('addr-1', 'address', { limit: 5 });
        await orderLifecycleFor({ sdkRegistry: reg, chainId: 'c', kind: 'expires', query: 'addr-1' });
        expect(sdk.getOrderExpires).toHaveBeenCalledWith('addr-1', 'address', undefined);
        await orderLifecycleFor({ sdkRegistry: reg, chainId: 'c', kind: 'cancels', query: 'addr-1' });
        expect(sdk.getOrderCancels).toHaveBeenCalledWith('addr-1', 'address', undefined);
    });

    it('matches read the recent block feed with an empty query allowed', async () => {
        const sdk = { getOrderMatches: vi.fn(async () => ({ data: [] })) };
        await orderLifecycleFor({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', kind: 'matches' });
        expect(sdk.getOrderMatches).toHaveBeenCalledWith('', 'block', undefined);
    });

    it('requires a query for non-match kinds and rejects unknown kinds', async () => {
        await expect(orderLifecycleFor({ sdkRegistry: { get: () => ({}) }, chainId: 'c', kind: 'edits' }))
            .rejects.toThrow(/query is required/);
        await expect(orderLifecycleFor({ sdkRegistry: { get: () => ({}) }, chainId: 'c', kind: 'bogus', query: 'x' }))
            .rejects.toThrow(/unknown kind/);
    });
});
