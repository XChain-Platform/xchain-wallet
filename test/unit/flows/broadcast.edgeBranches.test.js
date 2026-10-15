// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'broadcast-tx' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { broadcastAction } from '../../../packages/core/src/flows/broadcastAction.js';
import {
    BROADCAST_FAILED_TRANSIENT_UNSAVED_NAME,
    _extractReason,
    broadcastFailureKindFromError,
    classifyBroadcastFailure,
} from '../../../packages/core/src/flows/broadcastPermanence.js';
import {
    broadcastsForAddress,
    latestFeedCreateForAddress,
} from '../../../packages/core/src/flows/broadcastQueries.js';

const FROM = {
    address: 'source-address', publicKey: '02aa', derivationPath: "m/84'/1'/0'/0/0",
};

function actionOpts(params, extra = {}) {
    return {
        vault: {},
        walletId: 'wallet-1',
        chainRegistry: { get: () => ({}) },
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        from: FROM,
        params,
        ...extra,
    };
}

describe('broadcastAction guards and summary branches', () => {
    beforeEach(() => { vi.mocked(submitAction).mockClear(); });

    it.each([
        [undefined, /opts is required/],
        [actionOpts(null), /params is required/],
        [actionOpts({}), /MESSAGE or params.BROADCAST_ACTION_INDEX is required/],
        [actionOpts({ MESSAGE: '', BROADCAST_ACTION_INDEX: 7 }), /MESSAGE or params.BROADCAST_ACTION_INDEX is required/],
    ])('rejects invalid input %#', async (input, message) => {
        await expect(broadcastAction(input)).rejects.toThrow(message);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it.each([
        [{ MESSAGE: 'temperature', VALUE: '21.5' }, 'Broadcast "temperature" (value 21.5)'],
        [{ MESSAGE: 'heartbeat', VALUE: '' }, 'Broadcast "heartbeat"'],
        [{ BROADCAST_ACTION_INDEX: '42', VALUE: '1' }, 'Broadcast feed result #42'],
    ])('builds the pending summary for %#', async (params, summary) => {
        await broadcastAction(actionOpts(params));
        expect(vi.mocked(submitAction).mock.calls[0][0].pendingTxMeta.actionSummary).toBe(summary);
    });

    it('preserves explicit false and zero options for an imported signer', async () => {
        await broadcastAction(actionOpts({ MESSAGE: 'hello' }, {
            from: {
                address: 'imported-address', publicKey: '03bb', derivationPath: null, addressId: 'addr-1',
            },
            fee: 0,
            feePerKb: 0,
            rbf: false,
            payFeeInNativeCoin: false,
            trackPendingTx: false,
        }));

        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.encoderOpts).toMatchObject({
            sourceAddress: 'imported-address',
            change: 'imported-address',
            fee: 0,
            feePerKb: 0,
            rbf: false,
            payFeeInNativeCoin: false,
        });
        expect(call.signingPaths).toEqual([{ inputIndex: 0, addressId: 'addr-1' }]);
        expect(call.pendingTxMeta).toBeUndefined();
    });
});

describe('broadcast query response and boundary branches', () => {
    it.each([
        [{ chainId: 'c', address: 'a' }, /sdkRegistry is required/],
        [{ sdkRegistry: {}, address: 'a' }, /chainId is required/],
        [{ sdkRegistry: {}, chainId: 'c' }, /address is required/],
    ])('validates broadcastsForAddress input %#', async (input, message) => {
        await expect(broadcastsForAddress(input)).rejects.toThrow(message);
    });

    it('forwards pagination and returns the SDK response unchanged', async () => {
        const response = { data: [{ action_index: 1 }] };
        const getBroadcasts = vi.fn(async () => response);
        await expect(broadcastsForAddress({
            sdkRegistry: { get: () => ({ getBroadcasts }) },
            chainId: 'c',
            address: 'a',
            opts: { page: 3 },
        })).resolves.toBe(response);
        expect(getBroadcasts).toHaveBeenCalledWith('a', 'address', { page: 3 });
    });

    it.each([
        [{ chainId: 'c', address: 'a' }, /messaging is required/],
        [{ messaging: {}, address: 'a' }, /chainId is required/],
        [{ messaging: {}, chainId: 'c' }, /address is required/],
    ])('validates latest-feed input %#', async (input, message) => {
        await expect(latestFeedCreateForAddress(input)).rejects.toThrow(message);
    });

    it('reads data and rows envelopes, accepts uppercase fields, and sorts the matching page', async () => {
        const older = { ACTION_FORMAT: '2', STATUS: 'valid', block_index: 10 };
        const newer = { action_format: 2, status: 'valid', block_index: 20 };
        const getBroadcastsForAddress = vi.fn()
            .mockResolvedValueOnce({ data: [{ action_format: 3, status: 'valid' }] })
            .mockResolvedValueOnce({ rows: [older, newer] });

        await expect(latestFeedCreateForAddress({
            messaging: { getBroadcastsForAddress }, chainId: 'c', address: 'a',
        })).resolves.toBe(newer);
        expect(getBroadcastsForAddress).toHaveBeenCalledTimes(2);
    });

    it('returns null without querying when maxPages is zero', async () => {
        const getBroadcastsForAddress = vi.fn();
        await expect(latestFeedCreateForAddress({
            messaging: { getBroadcastsForAddress }, chainId: 'c', address: 'a', maxPages: 0,
        })).resolves.toBeNull();
        expect(getBroadcastsForAddress).not.toHaveBeenCalled();
    });

    it('treats an unknown response envelope as an empty page', async () => {
        const getBroadcastsForAddress = vi.fn(async () => ({ items: [{}] }));
        await expect(latestFeedCreateForAddress({
            messaging: { getBroadcastsForAddress }, chainId: 'c', address: 'a',
        })).resolves.toBeNull();
    });
});

describe('broadcast permanence extraction fallbacks', () => {
    it('recognizes a transient failure whose queue persistence also failed', () => {
        expect(broadcastFailureKindFromError({ name: BROADCAST_FAILED_TRANSIENT_UNSAVED_NAME }))
            .toBe('transient');
    });

    it('ignores cyclic and unreadable error fields without throwing', () => {
        const unreadable = new Proxy({}, {
            get() { throw new Error('getter failed'); },
        });
        const cyclic = { message: 'network unavailable' };
        cyclic.cause = cyclic;

        expect(_extractReason(unreadable)).toBe('');
        expect(classifyBroadcastFailure(unreadable)).toBe('transient');
        expect(_extractReason(cyclic)).toBe('network unavailable');
    });

    it('bounds nested error traversal before an adversarial tail', () => {
        const chain = Array.from({ length: 17 }, () => ({}));
        for (let index = 0; index < chain.length - 1; index += 1) chain[index].cause = chain[index + 1];
        chain[16].message = 'bad-txns-inputs-missingorspent';

        expect(classifyBroadcastFailure(chain[0])).toBe('transient');
    });
});
