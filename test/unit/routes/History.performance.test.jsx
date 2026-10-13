// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { slowTimeout } from '../../helpers/testEnvSpeed.js';

const CHAIN = 'litecoin-regtest';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const ENTRY_COUNT = 5_000;
const NOW_S = Math.floor(Date.now() / 1000);

function historyRows() {
    return Array.from({ length: ENTRY_COUNT }, (_, i) => ({
        action: 'SEND',
        action_index: String(ENTRY_COUNT - i),
        block_index: 100_000 - i,
        timestamp: NOW_S - i,
        tx_hash: `history-perf-${i}`,
        status: 'valid',
        details: {
            action_format: 0,
            source: ADDRESS,
            destination: `rltc1qdestination${i}`,
            tick: 'LTC',
            amount: '1',
        },
    }));
}

function mountHistory(rows) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ address: ADDRESS }],
        }),
        getAddressHistory: vi.fn().mockResolvedValue(rows),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({ verifyProofs: false }),
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="performance-wallet" accountId="account-1" />
        </MessagingProvider>,
    );
}

beforeEach(() => {
    globalThis.localStorage?.setItem('xc:historyGroupingMode', 'flat');
});

afterEach(() => {
    cleanup();
    globalThis.localStorage?.removeItem('xc:historyGroupingMode');
});

describe('History large-list performance', () => {
    it('bounds a 5,000-entry render while filters and export retain the full set', async () => {
        const rows = historyRows();
        const startedAt = performance.now();
        const view = mountHistory(rows);

        await screen.findByText('Block 100,000', {}, { timeout: 20_000 });
        const elapsedMs = performance.now() - startedAt;
        const renderedRows = view.container.querySelectorAll('[data-history-key]');

        console.info(`History 5,000-entry render: ${elapsedMs.toFixed(1)} ms`);
        expect(elapsedMs).toBeLessThan(slowTimeout(1_800));
        expect(renderedRows).toHaveLength(100);
        expect(screen.getByText('100 of 5,000 history items shown')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        expect(screen.getByText('5,000 filtered rows will be exported.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        const showMore = screen.getByRole('button', { name: 'Show more history' });
        showMore.focus();
        expect(document.activeElement).toBe(showMore);
        fireEvent.click(showMore);
        await waitFor(() => {
            expect(view.container.querySelectorAll('[data-history-key]')).toHaveLength(200);
        });

        fireEvent.change(screen.getByLabelText('Search history'), {
            target: { value: 'rltc1qdestination4999' },
        });
        await waitFor(() => {
            const matches = view.container.querySelectorAll('[data-history-key]');
            expect(matches).toHaveLength(1);
            expect(matches[0]).toHaveAttribute(
                'data-history-key',
                `${CHAIN}:1:${ADDRESS}`,
            );
        });
        expect(screen.queryByRole('button', { name: 'Show more history' })).toBeNull();
    });
});
