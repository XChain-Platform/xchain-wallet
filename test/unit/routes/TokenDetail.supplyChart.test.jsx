// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// TokenDetail draws a supply-over-time chart from getSupplyHistory and
// offers "Sell on DEX", which reuses the Markets hop, only to a holder.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

afterEach(() => { cleanup(); __clearTokenInfoCache(); });

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

const CHAIN = 'bitcoin-regtest';

function renderDetail({ history, quantity = '100', onBuy = vi.fn(), withHistory = true } = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qx' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
    };
    if (withHistory) messaging.getSupplyHistory = vi.fn().mockResolvedValue(history);
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenDetail, {
            walletId: 'w1', chainId: CHAIN, tick: 'SUPPLYPROBE', kind: 'token', quantity, onBack() {}, onBuy,
        }),
    ));
    return { messaging, onBuy };
}

describe('TokenDetail supply chart', () => {
    it('draws the chart from getSupplyHistory', async () => {
        const { messaging } = renderDetail({ history: [{ height: 1, supply: 10 }, { height: 2, supply: 50 }, { height: 3, supply: 80 }] });
        const chart = await screen.findByRole('img', { name: /Supply of SUPPLYPROBE over time/ });
        expect(chart.querySelector('path').getAttribute('d')).toMatch(/^M0\.0 80\.0 L150\.0 /);
        expect(messaging.getSupplyHistory).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'SUPPLYPROBE' });
    });

    it('hides the chart for fewer than two points or a missing lookup', async () => {
        const first = renderDetail({ history: [{ height: 1, supply: 10 }] });
        await waitFor(() => expect(first.messaging.getSupplyHistory).toHaveBeenCalled());
        expect(screen.queryByRole('img', { name: /Supply of/ })).toBeNull();
        cleanup();
        renderDetail({ withHistory: false });
        expect(screen.queryByText('Supply over time')).toBeNull();
    });
});

describe('TokenDetail "Sell on DEX" action', () => {
    it('opens Markets for a holder', () => {
        const { onBuy } = renderDetail({ history: [] });
        fireEvent.click(screen.getByRole('button', { name: 'Sell on DEX' }));
        expect(onBuy).toHaveBeenCalledTimes(1);
    });

    it('is absent with a zero balance', () => {
        renderDetail({ history: [], quantity: '0' });
        expect(screen.queryByRole('button', { name: 'Sell on DEX' })).toBeNull();
    });
});
