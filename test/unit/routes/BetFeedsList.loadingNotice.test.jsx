// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = { address: 'bc1qexampleexampleexampleexampleexampleex' };
const LOADING = { name: 'Loading betting markets' };

function mount(betFeeds) {
    render(
        <MessagingProvider
            shell="web"
            messaging={{
                getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
                betFeeds,
            }}
        >
            <BetFeedsList walletId="wallet-1" onOpenMarket={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
}

function follows(earlier, later) {
    return Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
}

afterEach(() => cleanup());

describe('BetFeedsList loading notice', () => {
    it('places the loading status before the network field and filter buttons while feeds are pending', async () => {
        mount(vi.fn(() => new Promise(() => {})));

        const status = await screen.findByRole('status', LOADING);
        const page = status.parentElement;
        expect(page.firstElementChild).toBe(status);

        const takingBets = screen.getByRole('button', { name: 'Taking bets' });
        const allMarkets = screen.getByRole('button', { name: 'All markets' });
        // The toolbar is the page child holding the filter buttons; its row
        // starts with the network field, then the filter button group.
        const toolbar = [...page.children].find((el) => el.contains(takingBets));
        const networkField = toolbar.firstElementChild.firstElementChild;
        expect(networkField.contains(takingBets)).toBe(false);
        expect(networkField.textContent).toMatch(/Network/);

        expect(follows(status, networkField)).toBe(true);
        expect(follows(status, takingBets)).toBe(true);
        expect(follows(status, allMarkets)).toBe(true);
    });

    it('clears the loading status once market rows load', async () => {
        mount(vi.fn().mockResolvedValue({ data: [] }));

        expect(await screen.findByRole('heading', { name: 'No markets' })).toBeInTheDocument();
        expect(screen.queryByRole('status', LOADING)).toBeNull();
    });

    it('clears the loading status when the feed read fails', async () => {
        mount(vi.fn().mockRejectedValue(new Error('Explorer unavailable')));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument());
        expect(screen.queryByRole('status', LOADING)).toBeNull();
    });
});
