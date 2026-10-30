// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Marketplace with no connection: it reads no feeds, says so once with the
// shared offline state, and loads again when the connection returns.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';

const network = vi.hoisted(() => ({ offline: true, recheck: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useNetworkOffline.js', () => ({
    useNetworkOffline: () => network,
}));

afterEach(() => {
    cleanup();
    network.offline = true;
});

function messagingStub() {
    return {
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getOrdersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getSwapsForToken: vi.fn().mockResolvedValue({ data: [] }),
        oracleFeeds: vi.fn().mockResolvedValue([]),
    };
}

function mount(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MarketActivity walletId="w1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('Marketplace offline', () => {
    it('shows the one offline state and reads nothing', async () => {
        const messaging = messagingStub();
        mount(messaging);

        expect(await screen.findByText(/You're offline/i)).toBeInTheDocument();
        expect(screen.getAllByText(/loads when the connection returns/)).toHaveLength(1);
        expect(screen.queryByText(/could not be loaded/)).toBeNull();
        expect(screen.queryByLabelText('Loading marketplace activity')).toBeNull();
        expect(messaging.getDispensersForToken).not.toHaveBeenCalled();
    });

    it('loads the feeds once the connection returns', async () => {
        const messaging = messagingStub();
        const view = mount(messaging);
        await screen.findByText(/You're offline/i);

        network.offline = false;
        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketActivity walletId="w1" onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(await screen.findByText('No open dispensers')).toBeInTheDocument();
        expect(messaging.getDispensersForToken).toHaveBeenCalled();
        expect(screen.queryByText(/You're offline/i)).toBeNull();
    });
});
