// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { useContractManifest } from '../../../packages/core/src/shared/hooks/useContractManifest.js';

const UNAVAILABLE = { permissions: null, maxTakeBps: null, status: 'unavailable' };

function wrapperFor(messaging) {
    return function Wrapper({ children }) {
        return (
            <MessagingContext.Provider value={{ shell: 'web', messaging }}>
                {children}
            </MessagingContext.Provider>
        );
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((settle) => { resolve = settle; });
    return { promise, resolve };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useContractManifest', () => {
    it('normalizes a declared manifest', async () => {
        const messaging = {
            getContractManifest: vi.fn(async () => ({
                permissions: ['SEND'], maxTakeBps: 250, status: 'declared',
            })),
        };
        const { result } = renderHook(() => useContractManifest({
            chainId: 'bitcoin-regtest', contractActionIndex: 'manifest-normalize-1',
        }), { wrapper: wrapperFor(messaging) });

        expect(result.current).toEqual(UNAVAILABLE);
        await waitFor(() => expect(result.current).toEqual({
            permissions: ['SEND'], maxTakeBps: 250, status: 'declared',
        }));
        expect(messaging.getContractManifest).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest', contractActionIndex: 'manifest-normalize-1',
        });
    });

    it('does not fetch while skipped or when a lookup key is missing', () => {
        const messaging = { getContractManifest: vi.fn() };
        const skipped = renderHook(() => useContractManifest({
            chainId: 'bitcoin-regtest', contractActionIndex: 'manifest-skip-1', skip: true,
        }), { wrapper: wrapperFor(messaging) });
        const missing = renderHook(() => useContractManifest({
            chainId: null, contractActionIndex: 'manifest-missing-1',
        }), { wrapper: wrapperFor(messaging) });

        expect(skipped.result.current).toEqual(UNAVAILABLE);
        expect(missing.result.current).toEqual(UNAVAILABLE);
        expect(messaging.getContractManifest).not.toHaveBeenCalled();
    });

    it('clears the previous manifest while a new contract is loading', async () => {
        const next = deferred();
        const messaging = {
            getContractManifest: vi.fn()
                .mockResolvedValueOnce({ permissions: [], maxTakeBps: 0, status: 'declared' })
                .mockReturnValueOnce(next.promise),
        };
        const { result, rerender } = renderHook(
            ({ contractActionIndex }) => useContractManifest({
                chainId: 'bitcoin-regtest', contractActionIndex,
            }),
            {
                initialProps: { contractActionIndex: 'manifest-switch-1' },
                wrapper: wrapperFor(messaging),
            },
        );
        await waitFor(() => expect(result.current.status).toBe('declared'));

        rerender({ contractActionIndex: 'manifest-switch-2' });
        expect(result.current).toEqual(UNAVAILABLE);

        await act(async () => {
            next.resolve({ permissions: null, maxTakeBps: null, status: 'unrestricted' });
        });
        expect(result.current.status).toBe('unrestricted');
    });
});
