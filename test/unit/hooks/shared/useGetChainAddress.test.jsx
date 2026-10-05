// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { useGetChainAddress } from '../../../../packages/core/src/shared/hooks/useGetChainAddress.js';

vi.mock('react', { spy: true });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function mount(messaging, getChainId, walletId = 'w1') {
    return renderHook(
        (props) => useGetChainAddress(props),
        { initialProps: { messaging, walletId, getChainId } },
    );
}

describe('useGetChainAddress without anything to fetch', () => {
    it('stays empty and never calls messaging when getChainId is absent', async () => {
        const messaging = { getNewestAddress: vi.fn() };
        const { result } = mount(messaging, null);

        await act(async () => {});

        expect(result.current.getAddress).toBe('');
        expect(messaging.getNewestAddress).not.toHaveBeenCalled();
    });

    it('stays empty when messaging has no getNewestAddress', async () => {
        const { result } = mount({}, 'bitcoin');

        await act(async () => {});

        expect(result.current.getAddress).toBe('');
    });
});

describe('useGetChainAddress fetch results', () => {
    it('fills the address and calls with walletId and getChainId', async () => {
        const messaging = {
            getNewestAddress: vi.fn().mockResolvedValue({ address: 'bc1x' }),
        };
        const { result } = mount(messaging, 'bitcoin');

        await waitFor(() => expect(result.current.getAddress).toBe('bc1x'));
        expect(messaging.getNewestAddress).toHaveBeenCalledWith('w1', 'bitcoin');
    });

    it('stays empty when the result carries no address', async () => {
        const messaging = {
            getNewestAddress: vi.fn().mockResolvedValue({}),
        };
        const { result } = mount(messaging, 'bitcoin');

        await waitFor(() => expect(messaging.getNewestAddress).toHaveBeenCalled());
        await act(async () => {});

        expect(result.current.getAddress).toBe('');
    });

    it('stays empty and does not throw when the call rejects', async () => {
        const messaging = {
            getNewestAddress: vi.fn().mockRejectedValue(new Error('offline')),
        };
        const { result } = mount(messaging, 'bitcoin');

        await waitFor(() => expect(messaging.getNewestAddress).toHaveBeenCalled());
        await act(async () => {});

        expect(result.current.getAddress).toBe('');
    });
});

describe('useGetChainAddress touched state', () => {
    it('setGetAddress sets the value and stops later chain fetches', async () => {
        const messaging = {
            getNewestAddress: vi.fn().mockResolvedValue({ address: 'bc1x' }),
        };
        const { result, rerender } = mount(messaging, 'bitcoin');
        await waitFor(() => expect(result.current.getAddress).toBe('bc1x'));
        messaging.getNewestAddress.mockClear();

        act(() => result.current.setGetAddress('typed'));
        rerender({ messaging, walletId: 'w1', getChainId: 'litecoin' });
        await act(async () => {});

        expect(result.current.getAddress).toBe('typed');
        expect(messaging.getNewestAddress).not.toHaveBeenCalled();
    });

    it('resetGetAddress clears the value and fetches again on a chain change', async () => {
        const messaging = {
            getNewestAddress: vi.fn((walletId, chain) => Promise.resolve(
                { address: chain === 'bitcoin' ? 'bc1x' : 'ltc1y' },
            )),
        };
        const { result, rerender } = mount(messaging, 'bitcoin');
        await waitFor(() => expect(result.current.getAddress).toBe('bc1x'));
        act(() => result.current.setGetAddress('typed'));

        act(() => result.current.resetGetAddress());
        rerender({ messaging, walletId: 'w1', getChainId: 'litecoin' });

        await waitFor(() => expect(result.current.getAddress).toBe('ltc1y'));
        expect(messaging.getNewestAddress).toHaveBeenLastCalledWith('w1', 'litecoin');
    });
});

describe('useGetChainAddress after unmount', () => {
    it('sets nothing and logs no console error when a late result lands', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { useState } = await vi.importActual('react');
        let addressSetter;
        vi.spyOn(React, 'useState').mockImplementation((initialValue) => {
            const [value, setValue] = useState(initialValue);
            if (initialValue !== '') return [value, setValue];
            addressSetter ??= vi.fn(setValue);
            return [value, addressSetter];
        });
        let resolveLookup;
        const messaging = {
            getNewestAddress: vi.fn(() => new Promise((resolve) => { resolveLookup = resolve; })),
        };
        const { result, unmount } = mount(messaging, 'bitcoin');
        await waitFor(() => expect(messaging.getNewestAddress).toHaveBeenCalled());

        unmount();
        addressSetter.mockClear();
        await act(async () => { resolveLookup({ address: 'bc1x' }); });

        expect(addressSetter).not.toHaveBeenCalled();
        expect(result.current.getAddress).toBe('');
        expect(errorSpy).not.toHaveBeenCalled();
    });
});
