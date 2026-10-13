// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// TokenDetail draws a supply-over-time chart from getSupplyHistory.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
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
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
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

    it('removes the previous token chart while the next token history loads', async () => {
        let resolveNext;
        const nextHistory = new Promise((resolve) => { resolveNext = resolve; });
        const getSupplyHistory = vi.fn(({ tick }) => tick === 'OLD'
            ? Promise.resolve([{ height: 1, supply: 10 }, { height: 2, supply: 20 }])
            : nextHistory);
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qx' }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory,
        };
        const tree = (tick) => (
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId="w1"
                    chainId={CHAIN}
                    tick={tick}
                    kind="token"
                    quantity="1"
                    onBack={() => {}}
                />
            </MessagingProvider>
        );
        const view = render(tree('OLD'));
        expect(await screen.findByRole('img', { name: /Supply of OLD over time/ })).toBeTruthy();

        view.rerender(tree('NEW'));
        expect(screen.queryByRole('img', { name: /Supply of OLD over time/ })).toBeNull();
        expect(screen.queryByRole('img', { name: /Supply of NEW over time/ })).toBeNull();

        await act(async () => {
            resolveNext([{ height: 3, supply: 30 }, { height: 4, supply: 40 }]);
        });
        expect(await screen.findByRole('img', { name: /Supply of NEW over time/ })).toBeTruthy();
    });

    it('contains synchronous supply and native-price bridge failures', async () => {
        const supplyFailure = vi.fn(() => { throw new Error('supply bridge unavailable'); });
        const tokenMessaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qx' }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory: supplyFailure,
        };
        render(
            <MessagingProvider shell="web" messaging={tokenMessaging}>
                <TokenDetail walletId="w1" chainId={CHAIN} tick="THROW" kind="token" quantity="1" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(supplyFailure).toHaveBeenCalled());
        expect(screen.queryByText('Supply over time')).toBeNull();

        cleanup();
        const getNativePricesRequest = vi.fn(() => { throw new Error('price bridge unavailable'); });
        const nativeMessaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getNativePricesRequest,
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        };
        render(
            <MessagingProvider shell="web" messaging={nativeMessaging}>
                <TokenDetail walletId="w1" chainId={CHAIN} tick="BTC" kind="native" quantity="1" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(getNativePricesRequest).toHaveBeenCalled());
        expect(screen.getByText('No market data available for this network.')).toBeTruthy();
    });
});

describe('TokenDetail Trade action', () => {
    it('opens trading regardless of whether the current balance is zero', () => {
        const { onBuy } = renderDetail({ history: [] });
        fireEvent.click(screen.getByRole('button', { name: 'Trade' }));
        expect(onBuy).toHaveBeenCalledTimes(1);

        cleanup();
        const zero = renderDetail({ history: [], quantity: '0' });
        fireEvent.click(screen.getByRole('button', { name: 'Trade' }));
        expect(zero.onBuy).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Sell on DEX' })).toBeNull();
    });

    it('is absent when the shell has no trading surface', () => {
        renderDetail({ history: [], onBuy: null });
        expect(screen.queryByRole('button', { name: 'Trade' })).toBeNull();
    });
});
