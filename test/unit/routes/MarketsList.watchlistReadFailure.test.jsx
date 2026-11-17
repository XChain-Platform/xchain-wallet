// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The watchlist read failing leaves the markets themselves listed, and Show
// watchlist shows its empty state with no transport detail.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { selectOption } from '../../helpers/selectOption.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const CHAIN = 'bitcoin-mainnet';

describe('MarketsList watchlist read failure', () => {
    it('keeps the markets listed when the watchlist read fails', async () => {
        const messaging = {
            getMarkets: vi.fn().mockResolvedValue([
                { tick1: 'XCP', tick2: 'BTC', depth: 3 },
                { tick1: 'PEPE', tick2: 'BTC', depth: 2 },
            ]),
            listWatchlistForWallet: vi.fn().mockRejectedValue(new Error('vault busy')),
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
        expect(await screen.findByRole('button', { name: 'Open XCP market' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open PEPE market' })).toBeInTheDocument();

        // The Show choice (Popular, All, Watchlist) is in the title-line filter menu.
        fireEvent.click(screen.getByRole('button', { name: 'Filter markets' }));
        selectOption(screen.getByLabelText('Show markets'), 'watchlist');
        const region = screen.getByRole('region', { name: 'Markets results' });
        await waitFor(() => expect(region).toHaveTextContent('Empty watchlist'));
        expect(document.body.textContent).not.toContain('vault busy');
    });
});
