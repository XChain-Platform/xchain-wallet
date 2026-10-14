// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { usePopupPaletteData } from '../../../packages/extension/src/popup/usePopupPaletteData.js';

afterEach(() => {
    cleanup();
});

function props(overrides = {}) {
    return {
        open: true,
        sessionState: 'unlocked',
        walletId: 'wallet-1',
        accountId: null,
        messaging: {
            listContacts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
        },
        chainRegistry: registryLib.defaultRegistry(),
        loadSites: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

describe('popup palette data edge cases', () => {
    it.each([
        { open: false, sessionState: 'unlocked', walletId: 'wallet-1' },
        { open: true, sessionState: 'locked', walletId: 'wallet-1' },
        { open: true, sessionState: 'unlocked', walletId: null },
    ])('does not load private data while its gate is closed', async (gate) => {
        const testProps = props(gate);
        const { result } = renderHook(() => usePopupPaletteData(testProps));

        await act(async () => { await Promise.resolve(); });
        expect(testProps.messaging.listContacts).not.toHaveBeenCalled();
        expect(testProps.messaging.getWalletBalances).not.toHaveBeenCalled();
        expect(testProps.loadSites).not.toHaveBeenCalled();
        expect(result.current).toEqual({ contacts: [], tokenRows: [], sites: [] });
    });

    it('keeps the palette usable when every optional data source rejects', async () => {
        const testProps = props({
            messaging: {
                listContacts: vi.fn().mockRejectedValue(new Error('contacts refused')),
                getWalletBalances: vi.fn().mockRejectedValue(new Error('balances unavailable')),
            },
            loadSites: vi.fn().mockRejectedValue(new Error('sites refused')),
        });
        const { result } = renderHook(() => usePopupPaletteData(testProps));

        await waitFor(() => {
            expect(testProps.messaging.listContacts).toHaveBeenCalledOnce();
            expect(testProps.messaging.getWalletBalances).toHaveBeenCalledOnce();
            expect(testProps.loadSites).toHaveBeenCalledOnce();
        });
        expect(result.current).toEqual({ contacts: [], tokenRows: [], sites: [] });
    });

    it('uses empty lists when contacts and connected sites return malformed values', async () => {
        const testProps = props({
            messaging: {
                listContacts: vi.fn().mockResolvedValue({ id: 'not-an-array' }),
                getWalletBalances: vi.fn().mockRejectedValue(new Error('balances unavailable')),
            },
            loadSites: vi.fn().mockResolvedValue('not-an-array'),
        });
        const { result } = renderHook(() => usePopupPaletteData(testProps));

        await waitFor(() => expect(testProps.loadSites).toHaveBeenCalledOnce());
        expect(result.current.contacts).toEqual([]);
        expect(result.current.sites).toEqual([]);
        expect(result.current.tokenRows).toEqual([]);
    });
});
