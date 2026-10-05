// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useContractOwnerWithdraw } from '../../../packages/core/src/shared/hooks/useContractOwnerWithdraw.js';
import {
    contractOwnerWithdraw,
    extractSingle,
} from '../../../packages/core/src/shared/routes/contractResponseShape.js';

vi.mock('../../../packages/core/src/shared/routes/contractResponseShape.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        extractSingle: vi.fn(actual.extractSingle),
        contractOwnerWithdraw: vi.fn(actual.contractOwnerWithdraw),
    };
});

const CHAIN_ID = 'bitcoin-regtest';
const ACTION_INDEX = '12';

function deferred() {
    let resolve;
    const promise = new Promise((settle) => { resolve = settle; });
    return { promise, resolve };
}

function trackedResponse(ownerWithdraw) {
    let inspected = false;
    return {
        response: {
            get data() {
                inspected = true;
                return [{ owner_withdraw: ownerWithdraw }];
            },
        },
        wasInspected: () => inspected,
    };
}

function mountHook(messaging, overrides = {}) {
    const props = { chainId: CHAIN_ID, contractActionIndex: ACTION_INDEX, ...overrides };
    return renderHook(
        (args) => useContractOwnerWithdraw({ messaging, ...args }),
        { initialProps: props },
    );
}

afterEach(() => { vi.clearAllMocks(); });

describe('useContractOwnerWithdraw', () => {
    it('starts null while the contract lookup is pending', () => {
        const pending = deferred();
        const messaging = { getContractByActionIndex: vi.fn(() => pending.promise) };
        const { result } = mountHook(messaging);

        expect(result.current).toBe(null);
        expect(messaging.getContractByActionIndex).toHaveBeenCalledWith({
            chainId: CHAIN_ID,
            contractActionIndex: ACTION_INDEX,
        });
    });

    it('stays null and skips messaging when either lookup key is missing', () => {
        const messaging = { getContractByActionIndex: vi.fn() };
        const withoutChain = mountHook(messaging, { chainId: null });
        const withoutIndex = mountHook(messaging, { contractActionIndex: null });

        expect(withoutChain.result.current).toBe(null);
        expect(withoutIndex.result.current).toBe(null);
        expect(messaging.getContractByActionIndex).not.toHaveBeenCalled();
    });

    it('stays null when the messaging route is unavailable', () => {
        const { result } = mountHook({});
        expect(result.current).toBe(null);
    });

    it('normalizes a resolved response and returns its boolean', async () => {
        const row = { owner_withdraw: true };
        const response = { data: [row] };
        const messaging = { getContractByActionIndex: vi.fn(async () => response) };
        const { result } = mountHook(messaging);

        await waitFor(() => expect(result.current).toBe(true));
        expect(extractSingle).toHaveBeenCalledWith(response);
        expect(contractOwnerWithdraw).toHaveBeenCalledWith(row);
        expect(extractSingle.mock.invocationCallOrder[0])
            .toBeLessThan(contractOwnerWithdraw.mock.invocationCallOrder[0]);
    });

    it('leaves the answer null when the lookup rejects', async () => {
        const messaging = {
            getContractByActionIndex: vi.fn().mockRejectedValue(new Error('unavailable')),
        };
        const { result } = mountHook(messaging);

        await act(async () => { await Promise.resolve(); });
        expect(result.current).toBe(null);
    });

    it('resets to null when the action index changes before returning the new answer', async () => {
        const next = deferred();
        const messaging = {
            getContractByActionIndex: vi.fn()
                .mockResolvedValueOnce({ data: [{ owner_withdraw: true }] })
                .mockReturnValueOnce(next.promise),
        };
        const { result, rerender } = mountHook(messaging);
        await waitFor(() => expect(result.current).toBe(true));

        rerender({ chainId: CHAIN_ID, contractActionIndex: '13' });
        expect(result.current).toBe(null);

        await act(async () => { next.resolve({ data: [{ owner_withdraw: false }] }); });
        expect(result.current).toBe(false);
    });

    it('ignores a response that lands after unmount', async () => {
        const pending = deferred();
        const tracked = trackedResponse(true);
        const messaging = { getContractByActionIndex: vi.fn(() => pending.promise) };
        const { unmount } = mountHook(messaging);

        unmount();
        await act(async () => { pending.resolve(tracked.response); });

        expect(tracked.wasInspected()).toBe(false);
        expect(extractSingle).not.toHaveBeenCalled();
    });

    it('ignores an old response after the action index changes', async () => {
        const oldRequest = deferred();
        const newRequest = deferred();
        const tracked = trackedResponse(true);
        const messaging = {
            getContractByActionIndex: vi.fn()
                .mockReturnValueOnce(oldRequest.promise)
                .mockReturnValueOnce(newRequest.promise),
        };
        const { result, rerender } = mountHook(messaging);

        rerender({ chainId: CHAIN_ID, contractActionIndex: '13' });
        await act(async () => { newRequest.resolve({ data: [{ owner_withdraw: false }] }); });
        expect(result.current).toBe(false);

        await act(async () => { oldRequest.resolve(tracked.response); });
        expect(result.current).toBe(false);
        expect(tracked.wasInspected()).toBe(false);
    });
});
