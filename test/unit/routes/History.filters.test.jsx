// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';

const LTC = 'litecoin-regtest';
const DOGE = 'dogecoin-regtest';
const LTC_ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const DOGE_ADDRESS = 'nZ1TestDogecoinAddress11111111111111';
const FIXED_NOW = new Date(2026, 9, 13, 12, 0, 0, 0);

function isoLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function secondsAt(dayOffset, hour = 12) {
    const date = new Date(FIXED_NOW);
    date.setDate(date.getDate() + dayOffset);
    date.setHours(hour, 30, 0, 0);
    return Math.floor(date.getTime() / 1000);
}

function historyRow({ actionIndex, action = 'SEND', blockIndex = 100, timestamp, tick, source }) {
    return {
        action,
        action_index: String(actionIndex),
        block_index: blockIndex,
        timestamp,
        tx_hash: `deadbeef${actionIndex}`,
        status: 'valid',
        details: { tick, source, memo: tick === 'ALPHA' ? 'alpha payment' : '' },
    };
}

function mountHistory(rowsByChain) {
    let settings = { fiatCurrency: 'USD', showFiatInHistory: false };
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [LTC]: [{ address: LTC_ADDRESS }],
            [DOGE]: [{ address: DOGE_ADDRESS }],
        }),
        getAddressHistory: vi.fn(({ chainId }) => Promise.resolve(rowsByChain[chainId] || [])),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn(() => Promise.resolve(settings)),
        updateSettings: vi.fn((patch) => {
            settings = { ...settings, ...patch };
            return Promise.resolve(settings);
        }),
    };
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <History walletId="w1" accountId="a1" />
            </ToastHost>
        </MessagingProvider>,
    );
    return { messaging, view };
}

function rowKeys(view) {
    return [...view.container.querySelectorAll('[data-history-key]')]
        .map((node) => node.getAttribute('data-history-key'));
}

function chooseOption(triggerName, optionName) {
    const trigger = screen.getByRole('button', { name: triggerName });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: optionName }));
    if (trigger.getAttribute('aria-expanded') === 'true') fireEvent.click(trigger);
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    globalThis.localStorage?.removeItem('xc:chainFilter:history:w1');
    globalThis.localStorage?.removeItem('xc:historyGroupingMode:w1');
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('History filters', () => {
    it('combines every filter dimension and preserves the controls across a refresh poll', async () => {
        const rows = {
            [LTC]: [
                historyRow({ actionIndex: 1, timestamp: secondsAt(0), tick: 'ALPHA', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 2, blockIndex: 0, timestamp: secondsAt(0), tick: 'ALPHA', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 3, action: 'MINT', timestamp: secondsAt(0), tick: 'ALPHA', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 4, timestamp: secondsAt(0), tick: 'BETA', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 5, timestamp: secondsAt(-1), tick: 'ALPHA', source: LTC_ADDRESS }),
            ],
            [DOGE]: [
                historyRow({ actionIndex: 6, timestamp: secondsAt(0), tick: 'ALPHA', source: DOGE_ADDRESS }),
            ],
        };
        const { messaging, view } = mountHistory(rows);
        await waitFor(() => expect(rowKeys(view)).toHaveLength(6));

        const today = isoLocal(FIXED_NOW);
        fireEvent.change(screen.getByLabelText('From date'), { target: { value: today } });
        fireEvent.change(screen.getByLabelText('To date'), { target: { value: today } });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(5));

        fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'alpha' } });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(4));

        fireEvent.click(screen.getByRole('button', { name: 'Additional details' }));
        chooseOption(/^All chains$/, 'Litecoin');
        await waitFor(() => expect(rowKeys(view)).toHaveLength(3));

        chooseOption(/^All action types$/, 'Send');
        await waitFor(() => expect(rowKeys(view)).toHaveLength(2));

        chooseOption(/^All statuses$/, 'Confirmed');
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:1:${LTC_ADDRESS}`]));

        expect(screen.getByRole('radio', { name: 'Grouped' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('radio', { name: 'Flat' }));
        fireEvent.click(screen.getByRole('button', { name: 'Show fiat' }));
        await screen.findByRole('button', { name: 'Fiat: USD' });

        const callsBeforeRefresh = messaging.getAddressHistory.mock.calls.length;
        vi.setSystemTime(Date.now() + BALANCE_POLL_INTERVAL_MS);
        act(() => { window.dispatchEvent(new Event('focus')); });
        await waitFor(() => {
            expect(messaging.getAddressHistory.mock.calls.length).toBe(callsBeforeRefresh + 2);
        });

        expect(screen.getByLabelText('Search history')).toHaveValue('alpha');
        expect(screen.getByLabelText('From date')).toHaveValue(today);
        expect(screen.getByLabelText('To date')).toHaveValue(today);
        expect(screen.getByRole('button', { name: 'Additional details' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: 'Litecoin' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Confirmed' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Flat' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('button', { name: 'Fiat: USD' })).toBeInTheDocument();
        expect(rowKeys(view)).toEqual([`${LTC}:1:${LTC_ADDRESS}`]);
    });

    it('keeps date bounds ordered and treats empty bounds and today as open or inclusive', async () => {
        const { view } = mountHistory({
            [LTC]: [
                historyRow({ actionIndex: 10, timestamp: secondsAt(0, 23), tick: 'TODAY', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 11, timestamp: secondsAt(-1), tick: 'YESTERDAY', source: LTC_ADDRESS }),
            ],
        });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(2));

        const today = isoLocal(FIXED_NOW);
        const tomorrowDate = new Date(FIXED_NOW);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrow = isoLocal(tomorrowDate);

        fireEvent.change(screen.getByLabelText('From date'), { target: { value: tomorrow } });
        expect(screen.getByLabelText('From date')).toHaveValue(tomorrow);
        expect(screen.getByLabelText('To date')).toHaveValue(tomorrow);
        await screen.findByText('No results for these filters');

        fireEvent.change(screen.getByLabelText('From date'), { target: { value: '' } });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(2));

        fireEvent.change(screen.getByLabelText('To date'), { target: { value: today } });
        fireEvent.change(screen.getByLabelText('From date'), { target: { value: today } });
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:10:${LTC_ADDRESS}`]));

        fireEvent.change(screen.getByLabelText('To date'), { target: { value: '' } });
        expect(screen.getByLabelText('To date')).toHaveValue('');
        expect(rowKeys(view)).toEqual([`${LTC}:10:${LTC_ADDRESS}`]);

        fireEvent.change(screen.getByLabelText('From date'), { target: { value: '' } });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(2));
    });

    it('reports network and special-filter misses, and Reset filters resets and can undo them', async () => {
        const { view } = mountHistory({
            [LTC]: [
                historyRow({ actionIndex: 20, timestamp: secondsAt(0), tick: 'ALPHA', source: LTC_ADDRESS }),
            ],
        });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(1));

        fireEvent.click(screen.getByRole('button', { name: 'Additional details' }));
        chooseOption(/^No special filters$/, 'Cross-chain only');
        chooseOption(/^All chains$/, 'Dogecoin');

        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
        expect(globalThis.localStorage?.getItem('xc:chainFilter:history:w1')).toContain(DOGE);

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:20:${LTC_ADDRESS}`]));
        expect(screen.getByRole('button', { name: 'All chains' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'No special filters' })).toBeInTheDocument();
        expect(screen.getByLabelText('From date')).toHaveValue('');
        expect(screen.getByLabelText('To date')).toHaveValue('');
        expect(globalThis.localStorage?.getItem('xc:chainFilter:history:w1')).toBeNull();

        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Dogecoin' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cross-chain only' })).toBeInTheDocument();
        expect(globalThis.localStorage?.getItem('xc:chainFilter:history:w1')).toContain(DOGE);

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        await waitFor(() => expect(rowKeys(view)).toHaveLength(1));

        chooseOption(/^All chains$/, 'Dogecoin');
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        await waitFor(() => expect(rowKeys(view)).toHaveLength(1));
        chooseOption(/^No special filters$/, 'Cross-chain only');
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
    });
});
