// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment jsdom

// The Home Activity tab of a real wallet lists its newest history rows in
// History's row layout, with View all opening the complete feed, instead of a
// placeholder that only points at History.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { RECENT_ACTIVITY_LIMIT } from '../../../packages/core/src/shared/utils/historyRow.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qrecentactivityaddress';
const BASE_TIME = 1_760_000_000;

function entry(i) {
    return {
        key: `${CHAIN}:${i}:${ADDRESS}`,
        chainId: CHAIN,
        address: ADDRESS,
        actionIndex: String(i),
        action: 'SEND',
        blockIndex: 800_000 + i,
        timestamp: BASE_TIME + i * 60,
        txHash: `tx${i}`,
        source: ADDRESS,
        raw: { action: 'SEND', tick: 'BTC', quantity: '1', source: ADDRESS },
        link: null,
    };
}

// Oldest first and interleaved, so the list has to order them itself.
function shuffledEntries(count) {
    const rows = Array.from({ length: count }, (_, i) => entry(i));
    return [...rows.filter((_, i) => i % 2 === 0), ...rows.filter((_, i) => i % 2 === 1)];
}

const descriptors = new Map([
    [CHAIN, { id: CHAIN, coin: 'bitcoin', displayName: 'Bitcoin', color: '#000000', networkKind: 'mainnet' }],
]);
const chainRegistry = {
    get: (id) => descriptors.get(id) || null,
    byCoin: (coin) => [...descriptors.values()].filter((d) => d.coin === coin),
    all: () => [...descriptors.values()],
};

function renderTabs(props) {
    const messaging = { getSettings: vi.fn().mockResolvedValue({}) };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={{}}
                walletId="wallet-real"
                networkFilter="all"
                {...props}
            />
        </MessagingProvider>,
    );
}

function rowTimestamps(onSelectEntry) {
    const rows = document.querySelectorAll('[data-activity-row]');
    onSelectEntry.mockClear();
    rows.forEach((row) => fireEvent.click(row));
    return onSelectEntry.mock.calls.map(([e]) => e.timestamp);
}

afterEach(() => cleanup());

describe('Home Activity tab of a real wallet', () => {
    it('lists the newest rows, newest first, capped, with View all opening History', () => {
        const onHistory = vi.fn();
        const onSelectEntry = vi.fn();
        const onActivityOpen = vi.fn();
        const entries = shuffledEntries(120);
        renderTabs({ recentActivity: entries, onHistory, onSelectEntry, onActivityOpen });

        fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

        expect(onActivityOpen).toHaveBeenCalled();
        expect(screen.queryByText('Your activity is in History')).toBeNull();
        expect(screen.getByRole('list', { name: 'Recent activity' })).toBeTruthy();

        expect(RECENT_ACTIVITY_LIMIT).toBeGreaterThanOrEqual(50);
        expect(RECENT_ACTIVITY_LIMIT).toBeLessThanOrEqual(100);
        const times = rowTimestamps(onSelectEntry);
        expect(times).toHaveLength(RECENT_ACTIVITY_LIMIT);
        const expected = entries.map((e) => e.timestamp).sort((a, b) => b - a).slice(0, RECENT_ACTIVITY_LIMIT);
        expect(times).toEqual(expected);

        const viewAll = screen.getByRole('button', { name: 'See all activity' });
        expect(screen.getByRole('tabpanel').lastElementChild).toBe(viewAll);
        fireEvent.click(viewAll);
        expect(onHistory).toHaveBeenCalledTimes(1);
    });

    it('lists every row of a short history', () => {
        const onSelectEntry = vi.fn();
        renderTabs({ recentActivity: shuffledEntries(12), onHistory: vi.fn(), onSelectEntry });
        fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
        expect(rowTimestamps(onSelectEntry)).toHaveLength(12);
    });

    it('shows an empty state for a wallet with no history', () => {
        renderTabs({ recentActivity: [], onHistory: vi.fn() });
        fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
        expect(screen.getByText('No activity yet')).toBeTruthy();
        expect(document.querySelectorAll('[data-activity-row]')).toHaveLength(0);
    });
});

describe('Home recent-activity reads', () => {
    const WALLET = { id: 'wallet-reads', name: 'Main Wallet' };
    const ACCOUNT = { id: 'account-reads', index: 0, walletId: WALLET.id };

    async function readsFor(rowCount) {
        const rows = Array.from({ length: rowCount }, (_, i) => ({
            action: 'SEND',
            action_index: i + 1,
            block_index: 800_000 + i,
            timestamp: BASE_TIME + i * 60,
            tx_hash: `tx${i}`,
            details: { tick: 'BTC', quantity: '1', source: ADDRESS },
        }));
        const messaging = {
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS, label: '' }] }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressHistory: vi.fn().mockResolvedValue({ data: rows, total: rowCount }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} onHistory={vi.fn()} />
            </MessagingProvider>,
        );
        const historyReadsBeforeTab = messaging.getAddressHistory.mock.calls.length;
        fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
        const expectedRows = Math.min(rowCount, RECENT_ACTIVITY_LIMIT);
        await waitFor(() => expect(document.querySelectorAll('[data-activity-row]')).toHaveLength(expectedRows));
        const counts = {
            historyReadsBeforeTab,
            history: messaging.getAddressHistory.mock.calls.length,
            addresses: messaging.getAddressesByChain.mock.calls.length,
        };
        cleanup();
        return counts;
    }

    it('reads the same number of times for 10 rows as for 100', async () => {
        const small = await readsFor(10);
        const large = await readsFor(100);
        expect(small.historyReadsBeforeTab).toBe(0);
        expect(small.history).toBe(1);
        expect(large).toEqual(small);
    });
});
