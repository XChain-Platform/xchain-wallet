// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Changing the asset hides the expanded rows behind the loading state and
// opens the new asset on its first page.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('MarketsList paging', () => {
    it('returns to the first page when the asset changes', async () => {
        const rows = Array.from({ length: 80 }, (_, index) => ({
            tick1: 'BTC', tick2: `TOKEN${index}`, depth: 80 - index,
        }));
        const messaging = {
            getMarkets: vi.fn().mockResolvedValue(rows),
            getDispensersForToken: vi.fn().mockResolvedValue([]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        let setChain;
        function Harness() {
            const [chainId, setChainState] = React.useState('bitcoin-mainnet');
            setChain = setChainState;
            return (
                <div>
                    <span data-testid="chain-scope">{chainId}</span>
                    <MarketsList
                        walletId="w"
                        selectedAsset={{ chainId, tick: 'BTC' }}
                        onChangeAsset={() => {}}
                        onOpenMarket={() => {}}
                    />
                </div>
            );
        }
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Harness />
            </MessagingProvider>,
        );
        await screen.findByText('TOKEN0');
        fireEvent.click(screen.getByRole('tab', { name: 'All' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(25);

        // Expand to the second page, then change the asset. The expanded rows
        // are replaced by the loading state at once, so no Load more click can
        // land between the change and the page reset, and the new asset opens
        // on its first page.
        fireEvent.click(screen.getByRole('button', { name: 'Load more markets' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(50);
        act(() => setChain('bitcoin-testnet'));
        expect(screen.queryByRole('button', { name: 'Load more markets' })).toBeNull();
        expect(screen.getByRole('status', { name: 'Loading markets' })).toBeInTheDocument();
        await screen.findByText('TOKEN0');
        expect(screen.getAllByRole('listitem')).toHaveLength(25);
    });
});
