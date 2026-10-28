// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A vault can hold two watchlist rows for one market (two windows starred it
// together). Remove from watchlist clears every row for that market, so the
// star goes out instead of staying lit on the row left behind.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const CHAIN = 'bitcoin-mainnet';

function entry(id, tick1 = 'XCP') {
    return { id, walletId: 'w', chainId: CHAIN, tick1, tick2: 'BTC', schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' };
}

function renderList(stored) {
    const rows = [...stored];
    const messaging = {
        getMarkets: vi.fn().mockResolvedValue([
            { tick1: 'XCP', tick2: 'BTC', depth: 3 },
            { tick1: 'PEPE', tick2: 'BTC', depth: 2 },
        ]),
        getDispensersForToken: vi.fn().mockResolvedValue([]),
        listWatchlistForWallet: vi.fn(async () => rows.map((r) => ({ ...r }))),
        clearWatchlistEntry: vi.fn(async ({ id }) => {
            const at = rows.findIndex((r) => r.id === id);
            if (at >= 0) rows.splice(at, 1);
        }),
        saveWatchlistEntry: vi.fn(),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MarketsList
                walletId="w"
                selectedAsset={{ chainId: CHAIN, tick: 'BTC' }}
                onChangeAsset={() => {}}
                onOpenMarket={() => {}}
            />
        </MessagingProvider>,
    );
    return { messaging, rows };
}

describe('MarketsList watchlist duplicates', () => {
    it('clears every row for the market and turns the star off', async () => {
        const { messaging, rows } = renderList([entry('a'), entry('b'), entry('c', 'PEPE')]);
        await screen.findByText('XCP');
        fireEvent.click(screen.getByRole('tab', { name: 'All' }));
        const xcpRow = screen.getByRole('button', { name: 'Open XCP market' }).closest('li');
        const star = xcpRow.querySelector('button[aria-label="Remove from watchlist"]');
        fireEvent.click(star);

        await waitFor(() => expect(messaging.clearWatchlistEntry).toHaveBeenCalledTimes(2));
        expect(messaging.clearWatchlistEntry.mock.calls.map(([req]) => req.id).sort()).toEqual(['a', 'b']);
        expect(rows.map((r) => r.id)).toEqual(['c']);
        await waitFor(() => expect(xcpRow.querySelector('button[aria-label="Add to watchlist"]')).not.toBeNull());
    });
});
