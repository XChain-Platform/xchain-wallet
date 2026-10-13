// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';

function mountHistory(rows) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getAddressHistory: vi.fn().mockResolvedValue(rows),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'EUR' }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="w1" accountId="a1" />
        </MessagingProvider>,
    );
}

function historyRow() {
    return {
        action: 'SEND',
        action_index: 12,
        block_index: 100,
        timestamp: Math.floor(Date.now() / 1000),
        tx_hash: 'abc123',
        details: {
            source: ADDRESS,
            destination: 'mrecipient',
            tick: 'LTC',
            amount: '1.25',
            memo: 'visible row',
        },
    };
}

afterEach(() => cleanup());

describe('History export button', () => {
    it('is enabled for visible rows and disabled with a reason when filters hide them', async () => {
        mountHistory([historyRow()]);

        const button = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(button).toBeEnabled());

        fireEvent.change(screen.getByLabelText('Search history'), {
            target: { value: 'no such transaction' },
        });

        await waitFor(() => expect(button).toBeDisabled());
        expect(screen.getByText('No rows match the current filters.')).toBeInTheDocument();
        expect(button).toHaveAttribute('aria-describedby', 'history-export-disabled-reason');
    });

    it('is disabled with an explanation when there is no history', async () => {
        mountHistory([]);

        const button = await screen.findByRole('button', { name: 'Export…' });
        expect(button).toBeDisabled();
        expect(screen.getByText('There are no history rows to export.')).toBeInTheDocument();
    });
});
