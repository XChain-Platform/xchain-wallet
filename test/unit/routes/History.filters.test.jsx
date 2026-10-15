// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

const LTC = 'litecoin-regtest';
const DOGE = 'dogecoin-regtest';
const LTC_ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const DOGE_ADDRESS = 'nZ1TestDogecoinAddress11111111111111';
const FIXED_NOW = new Date(2026, 9, 13, 12, 0, 0, 0);
const historyCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/History.module.css'),
    'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');
const tokenDetailCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/TokenDetail.module.css'),
    'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');
const tokenDetailSource = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/TokenDetail.jsx'),
    'utf8',
);

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    return match?.[2] || '';
}

function mediaBlock(text, query) {
    const start = text.indexOf(`@media ${query}`);
    if (start < 0) return '';
    const open = text.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === '{') depth += 1;
        if (text[index] === '}') depth -= 1;
        if (depth === 0) return text.slice(open + 1, index);
    }
    return '';
}

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

function historyRow({ actionIndex, action = 'SEND', blockIndex = 100, timestamp, tick, source, destination, amount, txHash }) {
    return {
        action,
        action_index: String(actionIndex),
        block_index: blockIndex,
        timestamp,
        tx_hash: txHash || `deadbeef${actionIndex}`,
        status: 'valid',
        details: { tick, source, destination, amount, memo: tick === 'ALPHA' ? 'alpha payment' : '' },
    };
}

function mountHistory(rowsByChain, addressesByChain = {
    [LTC]: [{ address: LTC_ADDRESS }],
    [DOGE]: [{ address: DOGE_ADDRESS }],
}, contacts = [], watermark = null) {
    let settings = { fiatCurrency: 'USD', showFiatInHistory: false };
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(addressesByChain),
        getAddressHistory: vi.fn(({ chainId }) => Promise.resolve(rowsByChain[chainId] || [])),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        listContacts: vi.fn().mockResolvedValue(contacts),
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
    cleanup();
    vi.clearAllMocks();
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    resetBackStackForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    globalThis.localStorage?.removeItem('xc:chainFilter:history:w1');
    globalThis.localStorage?.removeItem('xc:historyGroupingMode:w1');
    globalThis.sessionStorage?.removeItem('xc:historyViewState:w1:a1');
});

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    vi.useRealTimers();
});

describe('History filters', () => {
    it('uses the same field names in the export dialog and transaction details', async () => {
        mountHistory({
            [LTC]: [
                historyRow({ actionIndex: 1, timestamp: secondsAt(0), tick: 'ALPHA', source: LTC_ADDRESS }),
            ],
        });

        const exportButton = await screen.findByRole('button', { name: 'Export…' });
        await waitFor(() => expect(exportButton).toBeEnabled());
        fireEvent.click(exportButton);

        const dialog = screen.getByRole('dialog', { name: 'Export history' });
        expect(dialog).toHaveTextContent('Action number');
        expect(dialog).toHaveTextContent('Transaction ID');
        expect(dialog).toHaveTextContent('Block');
        expect(dialog).toHaveTextContent('Date and time (UTC)');
        expect(dialog).toHaveTextContent('From');
    });

    it('renders ordinary history controls through the shared field, chip, and button contracts', async () => {
        mountHistory({
            [LTC]: [historyRow({
                actionIndex: 1,
                timestamp: secondsAt(0),
                tick: 'LTC',
                source: LTC_ADDRESS,
            })],
        }, { [LTC]: [{ address: LTC_ADDRESS }] });

        const search = await screen.findByRole('searchbox', { name: 'Search history' });
        expect(search).toHaveAttribute('id');
        expect(screen.getByRole('button', { name: '7 days' }))
            .toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Refresh history' }))
            .toHaveAttribute('aria-busy', 'false');
    });

    it('searches txid prefixes, counterparties, contacts, tickers, and amounts within date filters', async () => {
        const clientAddress = 'mClientCounterparty1111111111111111111';
        const { view } = mountHistory({
            [LTC]: [
                historyRow({
                    actionIndex: 40,
                    timestamp: secondsAt(0),
                    tick: 'SEARCHCOIN',
                    source: LTC_ADDRESS,
                    destination: clientAddress,
                    amount: '42.75',
                    txHash: 'abc123todaytransaction',
                }),
                historyRow({
                    actionIndex: 41,
                    timestamp: secondsAt(-1),
                    tick: 'SEARCHCOIN',
                    source: LTC_ADDRESS,
                    destination: 'mOtherCounterparty11111111111111111111',
                    amount: '42.75',
                    txHash: 'def456yesterdaytransaction',
                }),
            ],
        }, {
            [LTC]: [{ address: LTC_ADDRESS }],
        }, [{
            id: 'contact-1',
            name: 'Acme Payroll',
            entries: [{ chain: 'litecoin', address: clientAddress }],
        }]);
        await waitFor(() => expect(rowKeys(view)).toHaveLength(2));
        // The row keeps both ends of the counterparty on screen and the
        // whole address in its title.
        expect(screen.getByTitle(clientAddress)).toHaveTextContent('mClien…111111');
        expect(screen.queryByTitle(LTC_ADDRESS)).toBeNull();

        const search = screen.getByLabelText('Search history');
        const expectToday = async (query) => {
            fireEvent.change(search, { target: { value: query } });
            await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:40:${LTC_ADDRESS}`]));
        };

        await expectToday('abc123');
        await expectToday('ClientCounterparty');
        await expectToday('acme payroll');

        const today = isoLocal(FIXED_NOW);
        fireEvent.change(screen.getByLabelText('From date'), { target: { value: today } });
        fireEvent.change(screen.getByLabelText('To date'), { target: { value: today } });
        await expectToday('searchcoin');
        await expectToday('42.75');

        fireEvent.change(search, { target: { value: 'missing payment' } });
        expect(await screen.findByText('No results for "missing payment"')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Clear history search' }));
        expect(search).toHaveValue('');
        expect(search).toHaveFocus();
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:40:${LTC_ADDRESS}`]));
    });

    it('restores combined filters after opening a transaction', async () => {
        const rows = {
            [LTC]: [
                historyRow({ actionIndex: 50, timestamp: secondsAt(0), tick: 'ALPHA', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 51, timestamp: secondsAt(-1), tick: 'BETA', source: LTC_ADDRESS }),
            ],
        };
        const addresses = { [LTC]: [{ address: LTC_ADDRESS }] };
        let settings = { fiatCurrency: 'USD', showFiatInHistory: false };
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue(addresses),
            getAddressHistory: vi.fn().mockResolvedValue(rows[LTC]),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockResolvedValue([]),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            listContacts: vi.fn().mockResolvedValue([]),
            getSettings: vi.fn(() => Promise.resolve(settings)),
            updateSettings: vi.fn((patch) => {
                settings = { ...settings, ...patch };
                return Promise.resolve(settings);
            }),
        };
        function NavigationHarness() {
            const [detailOpen, setDetailOpen] = React.useState(false);
            return detailOpen ? (
                <button type="button" onClick={() => setDetailOpen(false)}>Back to history</button>
            ) : (
                <History
                    walletId="w1"
                    accountId="a1"
                    onSelectEntry={() => setDetailOpen(true)}
                />
            );
        }
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ToastHost><NavigationHarness /></ToastHost>
            </MessagingProvider>,
        );
        await waitFor(() => expect(rowKeys(view)).toHaveLength(2));

        const today = isoLocal(FIXED_NOW);
        fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'alpha' } });
        fireEvent.change(screen.getByLabelText('From date'), { target: { value: today } });
        fireEvent.change(screen.getByLabelText('To date'), { target: { value: today } });
        fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
        chooseOption(/^All action types$/, 'Send');
        chooseOption(/^All statuses$/, 'Confirmed');
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:50:${LTC_ADDRESS}`]));

        fireEvent.click(view.container.querySelector('button[data-history-row]'));
        fireEvent.click(screen.getByRole('button', { name: 'Back to history' }));

        expect(await screen.findByLabelText('Search history')).toHaveValue('alpha');
        expect(screen.getByLabelText('From date')).toHaveValue(today);
        expect(screen.getByLabelText('To date')).toHaveValue(today);
        expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Confirmed' })).toBeInTheDocument();
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:50:${LTC_ADDRESS}`]));
    });

    it('shows a receive address label only on incoming payments to that address', async () => {
        const sender = 'mtkxExternalSender1111111111111111111111';
        mountHistory({
            [LTC]: [
                historyRow({
                    actionIndex: 30,
                    timestamp: secondsAt(0),
                    tick: 'BTC',
                    source: sender,
                    destination: LTC_ADDRESS,
                }),
                historyRow({
                    actionIndex: 31,
                    timestamp: secondsAt(-1),
                    tick: 'BTC',
                    source: LTC_ADDRESS,
                    destination: sender,
                }),
            ],
        }, {
            [LTC]: [{ address: LTC_ADDRESS, label: 'Client invoices' }],
        });

        expect(await screen.findByText('Received at Client invoices')).toBeInTheDocument();
        expect(screen.getAllByText(/Client invoices/)).toHaveLength(1);
        expect(screen.getByRole('button', { name: /^Receive Received at Client invoices/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Send mtkxEx/ })).toBeInTheDocument();
    });

    it('offers one control to clear the search', async () => {
        mountHistory({
            [LTC]: [historyRow({ actionIndex: 30, timestamp: secondsAt(0), tick: 'BTC', source: LTC_ADDRESS })],
        }, { [LTC]: [{ address: LTC_ADDRESS }] });
        const search = await screen.findByRole('searchbox', { name: 'Search history' });
        fireEvent.change(search, { target: { value: 'zzz' } });
        expect(await screen.findByRole('button', { name: 'Clear history search' })).toBeInTheDocument();
        // A type="search" field also draws the engine's own cancel mark
        // inside it; with the Clear button beside it that made two.
        expect(ruleBody(historyCss, '.searchInput::-webkit-search-cancel-button')).toMatch(/display:\s*none/);
    });

    it('leaves a generated address name off the row, since it only repeats the coin', async () => {
        const sender = 'mtkxExternalSender1111111111111111111111';
        const view = mountHistory({
            [LTC]: [historyRow({ actionIndex: 30, timestamp: secondsAt(0), tick: 'BTC', source: sender })],
        }, {
            [LTC]: [{ address: LTC_ADDRESS, label: 'LTC Address #1' }],
        }).view;

        await waitFor(() => expect(rowKeys(view)).toHaveLength(1));
        expect(screen.queryByText(/Received at/)).toBeNull();
        expect(view.container.textContent).not.toContain('LTC Address #1');
    });

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

        fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
        expect(screen.getByRole('button', { name: 'All action types' }))
            .toHaveAttribute('aria-pressed', 'false');
        chooseOption(/^All networks$/, 'Litecoin');
        await waitFor(() => expect(rowKeys(view)).toHaveLength(3));

        chooseOption(/^All action types$/, 'Send');
        expect(screen.getByRole('button', { name: 'Send' }))
            .toHaveAttribute('aria-pressed', 'true');
        await waitFor(() => expect(rowKeys(view)).toHaveLength(2));

        chooseOption(/^All statuses$/, 'Confirmed');
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:1:${LTC_ADDRESS}`]));

        expect(screen.getByRole('radio', { name: 'Grouped' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('radio', { name: 'Flat' }));
        fireEvent.click(screen.getByRole('button', { name: 'Show fiat: Off' }));
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
        expect(screen.getByRole('button', { name: 'More filters' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: 'Litecoin' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Confirmed' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Flat' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('button', { name: 'Fiat: USD' })).toBeInTheDocument();
        expect(rowKeys(view)).toEqual([`${LTC}:1:${LTC_ADDRESS}`]);
    });

    it('refuses reversed bounds and treats empty bounds and today as open or inclusive', async () => {
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
        expect(screen.getByLabelText('From date')).toHaveValue(isoLocal(new Date(2026, 8, 14)));
        expect(screen.getByLabelText('To date')).toHaveValue(today);
        expect(screen.getByRole('alert')).toHaveTextContent('The from date must be on or before the to date.');

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

    it('offers exact local-day presets and shows an active range that can be cleared', async () => {
        const { view } = mountHistory({
            [LTC]: [
                historyRow({ actionIndex: 30, timestamp: secondsAt(-6), tick: 'SEVEN', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 31, timestamp: secondsAt(-7), tick: 'EIGHT', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 32, timestamp: secondsAt(-29), tick: 'THIRTY', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 33, timestamp: secondsAt(-30), tick: 'THIRTYONE', source: LTC_ADDRESS }),
            ],
        });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(3));

        expect(screen.getByText('Dates use local time.')).toBeInTheDocument();
        expect(screen.getByText('Date range: 09/14/2026 to 10/13/2026')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', { name: '7 days' }));
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:30:${LTC_ADDRESS}`]));
        expect(screen.getByLabelText('From date')).toHaveValue('2026-10-07');
        expect(screen.getByText('Date range: 10/07/2026 to 10/13/2026')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'All dates' }));
        await waitFor(() => expect(rowKeys(view)).toHaveLength(4));
        expect(screen.getByRole('button', { name: 'All dates' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByText(/^Date range:/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '30 days' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear date range' }));
        await waitFor(() => expect(rowKeys(view)).toHaveLength(4));
        expect(screen.queryByText(/^Date range:/)).not.toBeInTheDocument();
    });

    it('renders pending, local calendar days, future dates, and missing dates in stable sections', async () => {
        const { view } = mountHistory({
            [LTC]: [
                historyRow({ actionIndex: 1, blockIndex: 0, timestamp: secondsAt(0), tick: 'PENDING', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 2, timestamp: secondsAt(0), tick: 'TODAY', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 3, timestamp: secondsAt(-1), tick: 'YESTERDAY', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 4, timestamp: secondsAt(1), tick: 'FUTURE', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 5, timestamp: undefined, tick: 'UNDATED', source: LTC_ADDRESS }),
            ],
        }, { [LTC]: [{ address: LTC_ADDRESS }] });
        fireEvent.click(await screen.findByRole('button', { name: 'All dates' }));
        await waitFor(() => expect(rowKeys(view)).toHaveLength(5));

        const headings = [...view.container.querySelectorAll('[data-xc-section-header] h2')]
            .map((heading) => heading.textContent);
        expect(headings).toEqual([
            'Pending activity',
            expect.stringMatching(/Oct 14/),
            'Today',
            'Yesterday',
            'Date unavailable',
        ]);
    });

    it('reports network and special-filter misses, and Reset filters resets and can undo them', async () => {
        const { view } = mountHistory({
            [LTC]: [
                historyRow({ actionIndex: 20, timestamp: secondsAt(0), tick: 'ALPHA', source: LTC_ADDRESS }),
            ],
        });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(1));

        fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
        chooseOption(/^No special filters$/, 'Cross-chain only');
        chooseOption(/^All networks$/, 'Dogecoin');

        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
        expect(globalThis.localStorage?.getItem('xc:chainFilter:history:w1')).toContain(DOGE);

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:20:${LTC_ADDRESS}`]));
        expect(screen.getByRole('button', { name: 'All networks' })).toBeInTheDocument();
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

        chooseOption(/^All networks$/, 'Dogecoin');
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        await waitFor(() => expect(rowKeys(view)).toHaveLength(1));
        chooseOption(/^No special filters$/, 'Cross-chain only');
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
    });

    it('fits filters and complete row metadata in the 360px layout', async () => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });

        try {
            const { view } = mountHistory({
                [LTC]: [historyRow({
                    actionIndex: 30,
                    blockIndex: 100,
                    timestamp: secondsAt(0),
                    tick: 'LITECRED',
                    source: LTC_ADDRESS,
                    amount: '100000000',
                })],
            }, undefined, [], 175);
            await waitFor(() => expect(rowKeys(view)).toHaveLength(1));

            const amount = view.container.querySelector('[data-history-amount]');
            expect(amount).toHaveTextContent(/100,000,000 LITECRED/);

            const filterToggle = screen.getByRole('button', { name: 'Filters (1)' });
            expect(filterToggle).toHaveAttribute('aria-expanded', 'false');
            expect(screen.getByRole('group', { name: 'History filters' })).toBeInTheDocument();
            fireEvent.click(filterToggle);
            expect(filterToggle).toHaveAttribute('aria-expanded', 'true');
            const search = screen.getByRole('searchbox', { name: 'Search history' });
            expect(search).toHaveAttribute('placeholder', 'Search history');
            expect(search).toHaveAccessibleDescription('Search by action, address, token, transaction ID, or memo…');
            expect(screen.getByLabelText('From date')).toBeInTheDocument();
            expect(screen.getByLabelText('To date')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'All dates' }));
            expect(screen.getByRole('button', { name: 'Filters (0)' })).toBeInTheDocument();

            // Rows show the chain through the asset icon overlay, so the name starts at the action.
            fireEvent.click(screen.getByRole('button', { name: /(?:Send|Receive).*Confirmed/i }));
            expect(screen.getByRole('rowheader', { name: 'Time' })).toBeInTheDocument();
            fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
            expect(screen.getByRole('rowheader', { name: 'Amount' })).toBeInTheDocument();

            const phone = mediaBlock(historyCss, 'not all and (min-width: 480px)');
            expect(ruleBody(historyCss, '.phoneFilterToggle')).toMatch(/display:\s*none/);
            expect(ruleBody(phone, '.phoneFilterToggle')).toMatch(/display:\s*flex/);
            expect(ruleBody(phone, '.filterCard')).toMatch(/display:\s*none/);
            expect(ruleBody(phone, '.filterCard.filterCardOpen')).toMatch(/display:\s*flex/);

            const narrow = mediaBlock(historyCss, 'not all and (min-width: 480px)');
            // The two date fields stack into one full-width column on phones.
            expect(ruleBody(narrow, '.dateRow')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\);/);
            expect(ruleBody(narrow, '.dateSep')).toMatch(/display:\s*none/);
            expect(ruleBody(historyCss, '.filterFooter')).toMatch(/flex-wrap:\s*wrap/);
            expect(ruleBody(historyCss, '.toolbarControl')).toMatch(/flex:\s*0 0 auto/);
            expect(ruleBody(narrow, '.rowMeta')).toMatch(/flex-wrap:\s*wrap/);
            expect(ruleBody(narrow, '.pendingAmount')).toMatch(/flex:\s*1 1 100%/);
            expect(ruleBody(narrow, '.detailsTable tbody'))
                .toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
            expect(ruleBody(narrow, '.detailsTable tr + tr > td')).toMatch(/border-top:\s*0/);
            expect(ruleBody(tokenDetailCss, '.headerIcon'))
                .toMatch(/width:\s*var\(--xc-avatar-size-header\)[\s\S]*height:\s*var\(--xc-avatar-size-header\)/);
            expect(tokenDetailSource)
                .toMatch(/useNativePrice\(isNative && fiatSupported && fiatAllowed && !isDemo \? chainId : null/);
            expect(tokenDetailSource)
                .toMatch(/entry: synthesizeDemoNativePrices\(\[chainId\]\)\[chainId\]/);
        } finally {
            if (widthDescriptor) {
                Object.defineProperty(window, 'innerWidth', widthDescriptor);
            }
        }
    });
});
