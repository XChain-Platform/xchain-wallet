// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A vault can hold two watchlist rows for one market (two windows starred it
// together on its market page). Show watchlist lists that market once.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { selectOption } from '../../helpers/selectOption.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const CHAIN = 'bitcoin-mainnet';

function entry(id, tick1 = 'XCP') {
    return { id, walletId: 'w', chainId: CHAIN, tick1, tick2: 'BTC', schemaVersion: 1, createdAt: '2026-01-01T00:00:00.000Z' };
}

describe('MarketsList watchlist duplicates', () => {
    it('lists a market stored twice once under Show watchlist', async () => {
        const messaging = {
            getMarkets: vi.fn().mockResolvedValue([
                { tick1: 'XCP', tick2: 'BTC', depth: 3 },
                { tick1: 'PEPE', tick2: 'BTC', depth: 2 },
            ]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([entry('a'), entry('b'), entry('c', 'RARE')]),
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
        await screen.findByText('XCP');
        // The Show choice sits in the title-line filter menu.
        fireEvent.click(screen.getByRole('button', { name: 'Filter markets' }));
        selectOption(screen.getByLabelText('Show markets'), 'watchlist');
        expect(screen.getByLabelText('Show markets')).toHaveTextContent('Show watchlist');

        const list = screen.getByRole('list', { name: 'Markets' });
        expect(within(list).getAllByRole('button', { name: 'Open XCP market' })).toHaveLength(1);
        expect(within(list).getAllByRole('button', { name: 'Open RARE market' })).toHaveLength(1);
        expect(within(list).queryByRole('button', { name: 'Open PEPE market' })).toBeNull();
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    });
});
