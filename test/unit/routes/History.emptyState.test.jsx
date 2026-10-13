// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A wallet with no activity at all says so, even with a search typed;
// "No matches for the current filters" is reserved for a filter that hides
// rows that exist.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';

function mount(props = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi' }] }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="w1" accountId="a1" {...props} />
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('History empty state', () => {
    it('says there is no activity yet when the wallet has no history', async () => {
        mount({ onReceive: vi.fn() });
        // History re-renders once the per-chain loads settle; wait on the
        // settled screen rather than the first node that matched.
        await waitFor(() => expect(screen.getByText('No activity yet')).toBeInTheDocument());
        expect(screen.queryByText(/No matches/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Receive' })).toBeNull();
    });

    it('keeps saying so when a search is typed on a wallet with no history', async () => {
        mount();
        await screen.findByText('No activity yet');
        fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'abc' } });
        expect(await screen.findByText('No activity yet')).toBeInTheDocument();
        expect(screen.queryByText(/No matches/)).toBeNull();
        expect(screen.queryByText(/Adjust or clear/)).toBeNull();
    });
});
