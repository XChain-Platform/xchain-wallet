// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { fact } from '../../helpers/detailFacts.js';
import filterMenuStyles from '../../../packages/core/src/shared/components/HomeListFilterMenu.module.css';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import {
    EXPORT_ITEM,
    MORE_ACTIONS,
    REFRESH_ITEM,
    chooseHistoryMenuItem,
    historyMenuItem,
    historyMoreButton,
    openHistoryMoreMenu,
} from './historyMoreMenu.js';

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

// Search, the network, the pickers, the dates and the view options sit in the
// title-line filter menu; this opens it (and leaves it open) once.
async function openFilters() {
    const trigger = await screen.findByRole('button', { name: 'History filters' });
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
}

function chooseOption(triggerName, optionName) {
    const trigger = screen.getByRole('button', { name: triggerName });
    fireEvent.click(trigger);
    // The network filter opens the full-screen network list, whose rows are
    // buttons named "Select <network>"; the other filters are listboxes.
    const networkList = screen.queryByRole('dialog', { name: 'Network' });
    if (networkList) {
        fireEvent.click(within(networkList).getByRole('button', { name: `Select ${optionName}` }));
        return;
    }
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
    it('keeps the title-bar filter unlit on the default 30-day window and lights it off the default (G04, G95)', async () => {
        const { view } = mountHistory({
            [LTC]: [historyRow({ actionIndex: 1, timestamp: secondsAt(0), tick: 'LTC', source: LTC_ADDRESS })],
        });
        const trigger = await screen.findByRole('button', { name: 'History filters' });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(1));
        expect(trigger).not.toHaveClass(filterMenuStyles.triggerActive);

        await openFilters();
        expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: '7 days' }));
        expect(screen.getByRole('button', { name: 'History filters' })).toHaveClass(filterMenuStyles.triggerActive);
    });

    it('puts the filter then the ⋯ menu on the title line, with nothing between the header and the list', async () => {
        const { view } = mountHistory({
            [LTC]: [historyRow({ actionIndex: 1, timestamp: secondsAt(0), tick: 'LTC', source: LTC_ADDRESS })],
        });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(1));

        // The title line holds two buttons: the filter, then ⋯.
        const filter = screen.getByRole('button', { name: 'History filters' });
        const more = historyMoreButton();
        const tools = more.closest('[data-history-header-actions]');
        expect(tools).not.toBeNull();
        const titleLine = screen.getByRole('heading', { name: 'History', level: 1 }).closest('div');
        expect(titleLine.contains(tools)).toBe(true);
        expect([...tools.querySelectorAll('button')]).toEqual([filter, more]);
        expect(more).toHaveAttribute('data-history-more');
        expect(more).toHaveAttribute('aria-haspopup', 'menu');
        expect(more).toHaveAttribute('aria-expanded', 'false');
        expect(more.querySelector('svg')).toBeTruthy();
        // No separate Refresh or Export button is left anywhere on the page.
        expect(screen.queryByRole('button', { name: REFRESH_ITEM })).toBeNull();
        expect(screen.queryByRole('button', { name: EXPORT_ITEM })).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();

        // ⋯ opens a menu of Export, then Refresh, each with its icon.
        const menu = openHistoryMoreMenu();
        expect(more).toHaveAttribute('aria-expanded', 'true');
        expect(tools.contains(menu)).toBe(true);
        const items = within(menu).getAllByRole('menuitem');
        expect(items.map((item) => item.textContent.trim())).toEqual(['Export…', 'Refresh history']);
        for (const item of items) {
            expect(item).toBeEnabled();
            expect(item.querySelector('svg')).toBeTruthy();
        }
        // Escape shuts it.
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();

        // Nothing sits between the header and the list: no actions row, no
        // "Updated ..." line; the list is the page's first block.
        expect(document.querySelector('[data-xc-page-actions]')).toBeNull();
        expect(screen.queryByText(/^Updated /)).toBeNull();
        const list = screen.getByRole('list', { name: 'History' });
        expect(list.parentElement.firstElementChild).toBe(list);

        // Choosing an item shuts the menu too.
        chooseHistoryMenuItem(REFRESH_ITEM);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('uses the same field names in the export dialog and transaction details', async () => {
        mountHistory({
            [LTC]: [
                historyRow({ actionIndex: 1, timestamp: secondsAt(0), tick: 'ALPHA', source: LTC_ADDRESS }),
            ],
        });

        await screen.findByRole('button', { name: MORE_ACTIONS });
        await waitFor(() => expect(historyMenuItem(EXPORT_ITEM)).toBeEnabled());
        chooseHistoryMenuItem(EXPORT_ITEM);

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

        await openFilters();
        const search = await screen.findByRole('searchbox', { name: 'Search history' });
        expect(search).toHaveAttribute('id');
        expect(screen.getByRole('button', { name: '7 days' }))
            .toHaveAttribute('aria-pressed', 'false');
        // Refresh is a kit button inside the title line's ⋯ menu.
        await waitFor(() => expect(historyMenuItem(REFRESH_ITEM)).toBeEnabled());
        expect(historyMenuItem(REFRESH_ITEM)).toHaveAttribute('aria-busy', 'false');
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
        // The row shows no counterparty address; search still matches it.
        expect(screen.queryByTitle(clientAddress)).toBeNull();
        expect(screen.queryByTitle(LTC_ADDRESS)).toBeNull();

        await openFilters();
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
        // The search has no clear button of its own now; emptying the field clears it.
        fireEvent.change(search, { target: { value: '' } });
        expect(search).toHaveValue('');
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
        await openFilters();
        fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'alpha' } });
        fireEvent.change(screen.getByLabelText('From date'), { target: { value: today } });
        fireEvent.change(screen.getByLabelText('To date'), { target: { value: today } });
        chooseOption(/^All action types$/, 'Send');
        chooseOption(/^All statuses$/, 'Confirmed');
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:50:${LTC_ADDRESS}`]));

        fireEvent.click(view.container.querySelector('button[data-history-row]'));
        fireEvent.click(screen.getByRole('button', { name: 'Back to history' }));

        // The menu opens closed again; the filters it holds were restored.
        await openFilters();
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
        // The send row names no counterparty address: action, details, time and status only.
        const sendRow = screen.getByRole('button', { name: /^Send/ });
        expect(sendRow).toBeInTheDocument();
        expect(sendRow).not.toHaveTextContent('mtkxEx');
    });

    it('offers one control to clear the search', async () => {
        mountHistory({
            [LTC]: [historyRow({ actionIndex: 30, timestamp: secondsAt(0), tick: 'BTC', source: LTC_ADDRESS })],
        }, { [LTC]: [{ address: LTC_ADDRESS }] });
        await openFilters();
        const search = await screen.findByRole('searchbox', { name: 'Search history' });
        fireEvent.change(search, { target: { value: 'zzz' } });
        // A search that matches nothing has one way out, Reset filters in the
        // empty state; the search field carries no clear button of its own.
        expect(await screen.findByText('No results for "zzz"')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Clear history search' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Reset Filters' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }));
        expect(search).toHaveValue('');
        // The box is the shared ListSearchField of every filter panel (G04),
        // which keeps the browser's own clear mark; History's old rule hiding
        // it styled a class nothing rendered and is gone.
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
        await openFilters();
        fireEvent.change(screen.getByLabelText('From date'), { target: { value: today } });
        fireEvent.change(screen.getByLabelText('To date'), { target: { value: today } });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(5));

        fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'alpha' } });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(4));

        expect(screen.getByRole('button', { name: 'All action types' }))
            .toHaveAttribute('aria-pressed', 'false');
        chooseOption('Filter by network', 'Litecoin');
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
        expect(screen.getByRole('button', { name: 'History filters' })).toHaveAttribute('aria-expanded', 'true');
        expect(globalThis.localStorage?.getItem('xc:chainFilter:history:w1')).toContain(LTC);
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

        await openFilters();
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

        await openFilters();
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

    it('lists pending, local calendar days, future dates, and missing dates in one stable flat order', async () => {
        const { view } = mountHistory({
            [LTC]: [
                historyRow({ actionIndex: 1, blockIndex: 0, timestamp: secondsAt(0), tick: 'PENDING', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 2, timestamp: secondsAt(0), tick: 'TODAY', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 3, timestamp: secondsAt(-1), tick: 'YESTERDAY', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 4, timestamp: secondsAt(1), tick: 'FUTURE', source: LTC_ADDRESS }),
                historyRow({ actionIndex: 5, timestamp: undefined, tick: 'UNDATED', source: LTC_ADDRESS }),
            ],
        }, { [LTC]: [{ address: LTC_ADDRESS }] });
        await openFilters();
        fireEvent.click(await screen.findByRole('button', { name: 'All dates' }));
        await waitFor(() => expect(rowKeys(view)).toHaveLength(5));

        // One flat list with no day headings, in the order the sections used
        // to give: pending first, then the future date, today, yesterday, and
        // the undated row last.
        expect(view.container.querySelectorAll('[data-xc-section-header]')).toHaveLength(0);
        expect(screen.getByRole('list', { name: 'History' }).querySelector('h2, h3')).toBeNull();
        expect(rowKeys(view)).toEqual([1, 4, 2, 3, 5].map((index) => `${LTC}:${index}:${LTC_ADDRESS}`));
    });

    it('reports network and special-filter misses, and Reset filters resets and can undo them', async () => {
        const { view } = mountHistory({
            [LTC]: [
                historyRow({ actionIndex: 20, timestamp: secondsAt(0), tick: 'ALPHA', source: LTC_ADDRESS }),
            ],
        });
        await waitFor(() => expect(rowKeys(view)).toHaveLength(1));

        await openFilters();
        chooseOption(/^No special filters$/, 'Cross-chain only');
        chooseOption('Filter by network', 'Dogecoin');

        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
        expect(globalThis.localStorage?.getItem('xc:chainFilter:history:w1')).toContain(DOGE);

        fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }));
        await waitFor(() => expect(rowKeys(view)).toEqual([`${LTC}:20:${LTC_ADDRESS}`]));
        expect(screen.getByRole('button', { name: 'No special filters' })).toBeInTheDocument();
        expect(screen.getByLabelText('From date')).toHaveValue('');
        expect(screen.getByLabelText('To date')).toHaveValue('');
        expect(globalThis.localStorage?.getItem('xc:chainFilter:history:w1')).toBeNull();

        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cross-chain only' })).toBeInTheDocument();
        expect(globalThis.localStorage?.getItem('xc:chainFilter:history:w1')).toContain(DOGE);

        fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }));
        await waitFor(() => expect(rowKeys(view)).toHaveLength(1));

        chooseOption('Filter by network', 'Dogecoin');
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }));
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

            // One filter button on the title line holds every control; it is
            // lit while the default last-30-days window is on.
            const filterToggle = screen.getByRole('button', { name: 'History filters' });
            expect(filterToggle).toHaveAttribute('aria-expanded', 'false');
            fireEvent.click(filterToggle);
            expect(filterToggle).toHaveAttribute('aria-expanded', 'true');
            const search = screen.getByRole('searchbox', { name: 'Search history' });
            expect(search).toHaveAttribute('placeholder', 'Search history');
            expect(screen.getByLabelText('From date')).toBeInTheDocument();
            expect(screen.getByLabelText('To date')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'All dates' }));
            expect(screen.getByRole('button', { name: 'All dates' })).toHaveAttribute('aria-pressed', 'true');

            // Rows show the chain through the asset icon overlay, so the name starts at the action.
            fireEvent.click(screen.getByRole('button', { name: /(?:Send|Receive).*Confirmed/i }));
            expect(screen.getByRole('rowheader', { name: 'Time' })).toBeInTheDocument();
            fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
            expect(fact('Amount')).toBeInTheDocument();

            // The filters live in the title-line menu at every width, so the
            // phone-only toggle and the collapsing filter card are gone.
            expect(ruleBody(historyCss, '.phoneFilterToggle')).toBe('');
            expect(ruleBody(historyCss, '.filterCard')).toBe('');

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
