// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Marketplace against the standing rulings: no loose explainer line under a
// list title (notes live only in a WarningCard), and a failed read leaves the
// list on its plain empty state with no page error or Try Again (G91), since
// the reachability banner reports network trouble once.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';

vi.mock('../../../packages/core/src/shared/hooks/useNetworkOffline.js', () => ({
    useNetworkOffline: () => ({ offline: false, recheck: () => {} }),
}));

afterEach(() => cleanup());

function messagingStub(overrides = {}) {
    return {
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getOrdersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getSwapsForToken: vi.fn().mockResolvedValue({ data: [] }),
        oracleFeeds: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

function mount(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MarketActivity walletId="w1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('Marketplace rulings', () => {
    it('draws the Offers list with no title, count or loose explainer line', async () => {
        mount(messagingStub());
        expect(await screen.findByText('No open offers')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Offers, cheapest first' })).toBeNull();
        expect(screen.queryByText(/\d+ open\b/)).toBeNull();
        expect(screen.queryByText(/at a fixed price; orders buy or sell it/)).toBeNull();
    });

    it('shows the plain empty state, never a page error or Try Again, when a feed fails', async () => {
        mount(messagingStub({
            getDispensersForToken: vi.fn().mockRejectedValue(new Error('explorer down')),
            getOrdersForToken: vi.fn().mockRejectedValue(new Error('explorer down')),
        }));
        expect(await screen.findByText('No open offers')).toBeInTheDocument();
        expect(screen.queryByText(/could not be loaded/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
        expect(screen.queryByText('explorer down')).toBeNull();
    });
});
