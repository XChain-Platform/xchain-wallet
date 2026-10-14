// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = { address: 'bc1qexampleexampleexampleexampleexampleex' };

function pending() {
    return new Promise(() => {});
}

function mount(messaging, props = {}) {
    const onOpenMarket = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BetFeedsList
                walletId="wallet-1"
                onOpenMarket={onOpenMarket}
                onBack={() => {}}
                {...props}
            />
        </MessagingProvider>,
    );
    return onOpenMarket;
}

afterEach(() => cleanup());

describe('BetFeedsList states', () => {
    it('shows the initial loading state while wallet addresses resolve', () => {
        mount({ getAddressesByChain: vi.fn(() => pending()) });

        expect(screen.getByRole('heading', { name: 'Betting' })).toBeInTheDocument();
        expect(screen.getByText(/Loading/)).toBeInTheDocument();
        expect(screen.queryByText('No markets')).toBeNull();
    });

    it('shows the empty state after an empty market response', async () => {
        mount({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            betFeeds: vi.fn().mockResolvedValue({ data: [] }),
        });

        expect(await screen.findByRole('heading', { name: 'No markets' })).toBeInTheDocument();
        expect(screen.getByText(/No markets are taking bets/)).toBeInTheDocument();
    });

    it('shows address-loading failures without an empty-state claim', async () => {
        mount({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Wallet unavailable')) });

        expect(await screen.findByText('Wallet unavailable')).toBeInTheDocument();
        expect(screen.queryByText('No markets')).toBeNull();
    });

    it('renders a market and opens it from the main state', async () => {
        const onOpenMarket = mount({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            betFeeds: vi.fn().mockResolvedValue({
                data: [{
                    action_index: 7,
                    tick: 'XCHAIN',
                    label: 'Will the proposal pass?',
                    outcomes: 'Yes,No',
                    feed_status: 'open',
                }],
            }),
        });

        const label = await screen.findByText('Will the proposal pass?');
        fireEvent.click(label.closest('button'));
        expect(onOpenMarket).toHaveBeenCalledWith(CHAIN, 7);
    });
});
