// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// After a star is added the list is read again. When that read fails, the
// stars already shown stay as they are instead of every star going out.

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

describe('MarketsList watchlist read failure', () => {
    it('keeps the shown stars when the read after a save fails', async () => {
        const stored = [{ id: 'a', walletId: 'w', chainId: CHAIN, tick1: 'XCP', tick2: 'BTC' }];
        const listWatchlistForWallet = vi.fn()
            .mockResolvedValueOnce(stored)
            .mockRejectedValue(new Error('vault busy'));
        const messaging = {
            getMarkets: vi.fn().mockResolvedValue([
                { tick1: 'XCP', tick2: 'BTC', depth: 3 },
                { tick1: 'PEPE', tick2: 'BTC', depth: 2 },
            ]),
            getDispensersForToken: vi.fn().mockResolvedValue([]),
            listWatchlistForWallet,
            saveWatchlistEntry: vi.fn().mockResolvedValue({}),
            clearWatchlistEntry: vi.fn(),
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
        fireEvent.click(screen.getByRole('tab', { name: 'All' }));
        const row = (name) => screen.getByRole('button', { name: `Open ${name} market` }).closest('li');
        await waitFor(() => expect(row('XCP').querySelector('button[aria-label="Remove from watchlist"]')).not.toBeNull());

        fireEvent.click(row('PEPE').querySelector('button[aria-label="Add to watchlist"]'));
        await waitFor(() => expect(listWatchlistForWallet).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(row('PEPE').querySelector('button[aria-busy="true"]')).toBeNull());

        expect(row('XCP').querySelector('button[aria-label="Remove from watchlist"]')).not.toBeNull();
    });
});
