// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
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

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

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

describe('History export shortcut (§34.2)', () => {
    it('opens the export dialog on e when rows are visible', async () => {
        mountHistory([historyRow()]);

        const button = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.keyDown(document.body, { key: 'e' });

        expect(await screen.findByRole('dialog', { name: 'Export history' })).toBeInTheDocument();
        expect(screen.getByText('Fiat currency (EUR)')).toBeInTheDocument();
    });

    it('leaves the export dialog closed on e when there is no history', async () => {
        mountHistory([]);

        const button = await screen.findByRole('button', { name: 'Export…' });
        expect(button).toBeDisabled();
        fireEvent.keyDown(document.body, { key: 'e' });

        expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull();
    });
});

describe('large History export', () => {
    it('reports chunk progress, cancels safely, and emits valid JSON on retry', async () => {
        const rows = Array.from({ length: 501 }, (_, index) => ({
            ...historyRow(),
            action_index: index + 1,
            tx_hash: `tx-${index + 1}`,
        }));
        mountHistory(rows);

        const open = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(open).toBeEnabled());
        fireEvent.click(open);
        vi.useFakeTimers();
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));

        expect(screen.getByText('Preparing 0 of 501 rows…')).toBeInTheDocument();
        await act(async () => { await vi.advanceTimersByTimeAsync(16); });
        expect(screen.getByText('Preparing 250 of 501 rows…')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull();

        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:history-test');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        vi.stubGlobal('Blob', NodeBlob);
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        fireEvent.click(screen.getByLabelText(/^JSON/));
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });

        expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull();
        const blob = createObjectURL.mock.calls[0][0];
        expect(blob.type).toBe('application/json');
        const exported = JSON.parse(await blob.text());
        expect(exported.entries).toHaveLength(501);
        expect(exported.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
