// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { useBtcAddressesPresent } from '../../../packages/core/src/shared/hooks/useBtcAddressesPresent.js';
import { useGovernanceAddressesPresent } from '../../../packages/core/src/shared/hooks/useGovernanceAddressesPresent.js';
import { chainIdsWithAction } from '../../../packages/core/src/shared/hooks/useSupportedChains.js';
import { useVmAddressesPresent } from '../../../packages/core/src/shared/hooks/useVmAddressesPresent.js';

function wrapperFor(messaging) {
    return function Wrapper({ children }) {
        return (
            <MessagingContext.Provider value={{ shell: 'web', messaging }}>
                {children}
            </MessagingContext.Provider>
        );
    };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('address-presence hooks', () => {
    it('finds a Bitcoin address and resets while no wallet is selected', async () => {
        const messaging = {
            getAddressesByChain: vi.fn(async () => ({
                'bitcoin-regtest': [{ address: 'bcrt1qexample' }],
            })),
        };
        const { result, rerender } = renderHook(
            ({ walletId }) => useBtcAddressesPresent(walletId),
            { initialProps: { walletId: 'wallet-1' }, wrapper: wrapperFor(messaging) },
        );

        expect(result.current).toBe(null);
        await waitFor(() => expect(result.current).toBe(true));
        expect(messaging.getAddressesByChain).toHaveBeenCalledWith('wallet-1');

        rerender({ walletId: null });
        expect(result.current).toBe(null);
    });

    it('reports false when the address lookup fails', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockRejectedValue(new Error('locked')),
        };
        const { result } = renderHook(() => useBtcAddressesPresent('wallet-1'), {
            wrapper: wrapperFor(messaging),
        });

        await waitFor(() => expect(result.current).toBe(false));
    });

    it('finds an address on a governance-capable chain', async () => {
        const chainId = chainIdsWithAction('VOTE')[0];
        expect(chainId).toBeTruthy();
        const messaging = {
            getAddressesByChain: vi.fn(async () => ({ [chainId]: [{ address: 'vote-address' }] })),
        };
        const { result } = renderHook(() => useGovernanceAddressesPresent('wallet-1'), {
            wrapper: wrapperFor(messaging),
        });

        await waitFor(() => expect(result.current).toBe(true));
    });

    it('finds an address on a contract-capable chain', async () => {
        const chainId = chainIdsWithAction('DEPLOY')[0];
        expect(chainId).toBeTruthy();
        const messaging = {
            getAddressesByChain: vi.fn(async () => ({ [chainId]: [{ address: 'vm-address' }] })),
        };
        const { result } = renderHook(() => useVmAddressesPresent('wallet-1'), {
            wrapper: wrapperFor(messaging),
        });

        await waitFor(() => expect(result.current).toBe(true));
    });
});
