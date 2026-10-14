// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const renderMetrics = vi.hoisted(() => ({ blockLabels: vi.fn() }));

vi.mock('../../../packages/core/src/i18n/index.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        t: (key, values) => {
            if (key === 'history.row.block') renderMetrics.blockLabels();
            return actual.t(key, values);
        },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';
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
    const readRows = typeof rows === 'function' ? rows : () => rows;
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ address: ADDRESS }],
        }),
        getAddressHistory: vi.fn(() => Promise.resolve(readRows())),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        listContacts: vi.fn().mockResolvedValue([]),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({ verifyProofs: false }),
    };
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="performance-wallet" accountId="account-1" />
        </MessagingProvider>,
    );
    return { messaging, view };
}

beforeEach(() => {
    globalThis.localStorage?.setItem('xc:historyGroupingMode', 'flat');
    renderMetrics.blockLabels.mockClear();
});

afterEach(() => {
    cleanup();
    globalThis.localStorage?.removeItem('xc:historyGroupingMode');
    vi.useRealTimers();
});

describe('History large-list performance', () => {
    it('bounds a 5,000-entry render while filters and export retain the full set', async () => {
        const rows = historyRows();
        const startedAt = performance.now();
        const { view } = mountHistory(rows);

        await screen.findByText('Block 100,000', {}, { timeout: 20_000 });
        const elapsedMs = performance.now() - startedAt;
        const renderedRows = view.container.querySelectorAll('[data-history-key]');

        console.info(`History 5,000-entry render: ${elapsedMs.toFixed(1)} ms`);
        expect(elapsedMs).toBeLessThan(slowTimeout(1_800));
        expect(renderedRows).toHaveLength(100);
        expect(screen.getByText('100 of 5,000 history items shown')).toBeInTheDocument();

        const initialBlockLabels = renderMetrics.blockLabels.mock.calls.length;
        fireEvent.click(renderedRows[0].querySelector('button[data-history-row]'));
        await waitFor(() => {
            expect(renderedRows[0].querySelector('button[data-history-row]'))
                .toHaveAttribute('aria-expanded', 'true');
        });
        expect(renderMetrics.blockLabels.mock.calls.length - initialBlockLabels).toBe(1);

        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        expect(screen.getByText(`${ENTRY_COUNT.toLocaleString()} filtered rows will be exported.`))
            .toBeInTheDocument();
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

    it('retains expanded rows when a refresh inserts and overlaps a page boundary', async () => {
        const original = historyRows().slice(0, 250);
        let response = original;
        const { messaging, view } = mountHistory(() => response);

        await waitFor(() => {
            expect(view.container.querySelectorAll('[data-history-key]')).toHaveLength(100);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Show more history' }));
        await waitFor(() => {
            expect(view.container.querySelectorAll('[data-history-key]')).toHaveLength(200);
        });
        const previouslyShown = [...view.container.querySelectorAll('[data-history-key]')]
            .map((node) => node.getAttribute('data-history-key'));

        response = [
            {
                ...original[0],
                action_index: '5001',
                block_index: 100_001,
                timestamp: NOW_S + 1,
                tx_hash: 'new-history-row',
            },
            ...original.slice(0, 100),
            original[99],
            ...original.slice(100),
        ];
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + BALANCE_POLL_INTERVAL_MS);
        act(() => { window.dispatchEvent(new Event('focus')); });

        await waitFor(() => expect(messaging.getAddressHistory).toHaveBeenCalledTimes(2));
        await waitFor(() => {
            expect(view.container.querySelectorAll('[data-history-key]')).toHaveLength(201);
        });
        const refreshedKeys = [...view.container.querySelectorAll('[data-history-key]')]
            .map((node) => node.getAttribute('data-history-key'));
        expect(new Set(refreshedKeys).size).toBe(refreshedKeys.length);
        expect(refreshedKeys).toContain(`${CHAIN}:5001:${ADDRESS}`);
        expect(previouslyShown.every((key) => refreshedKeys.includes(key))).toBe(true);
    });
});
