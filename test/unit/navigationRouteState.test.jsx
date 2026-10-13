// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLastView } from '../../packages/core/src/shared/hooks/useLastView.js';
import {
    readLastViewRoute,
    writeLastView,
} from '../../packages/core/src/shared/utils/lastViewMemory.js';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../packages/core/src/shared/routes/ListDetail.jsx';
import { MarketView } from '../../packages/core/src/shared/routes/MarketView.jsx';
import { TokenDetail } from '../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../packages/core/src/shared/hooks/useTokenInfo.js';
import { PageHeader } from '../../packages/core/src/ui/PageHeader.jsx';
import { resetBackStackForTests } from '../../packages/core/src/ui/backStack.js';

const WALLET = 'route-wallet';
const MARKET = { chainId: 'bitcoin-mainnet', tick1: 'XCHAIN', tick2: 'BTC' };
const savedResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
});

afterAll(() => {
    globalThis.ResizeObserver = savedResizeObserver;
});

function RouteHarness() {
    const [view, setView] = useState('markets');
    const [market, setMarket] = useState(null);
    useLastView({
        walletId: WALLET,
        currentView: view,
        currentParams: view === 'market' ? market : null,
        onResumeParams: (nextView, params) => {
            if (nextView === 'market') setMarket(params);
        },
        onResume: setView,
    });
    return (
        <>
            <PageHeader title={view} onBack={() => setView('home')} />
            <output>{view}:{market?.tick1 || ''}/{market?.tick2 || ''}</output>
            <button
                type="button"
                onClick={() => {
                    setMarket(MARKET);
                    setView('market');
                }}
            >
                Open market
            </button>
        </>
    );
}

beforeEach(() => {
    localStorage.clear();
    resetBackStackForTests();
    window.history.replaceState(null, '');
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    resetBackStackForTests();
    vi.restoreAllMocks();
});

describe('contextual route state', () => {
    it('round-trips validated deep params and rejects an incomplete saved route', () => {
        writeLastView(WALLET, 'token-detail', {
            chainId: 'bitcoin-mainnet',
            tick: 'ALPHA',
            quantity: '12',
            ignored: { unsafe: true },
        });
        expect(readLastViewRoute(WALLET)).toEqual({
            view: 'token-detail',
            params: {
                chainId: 'bitcoin-mainnet',
                tick: 'ALPHA',
                quantity: '12',
            },
        });
        writeLastView(WALLET, 'lists');
        expect(readLastViewRoute(WALLET)).toEqual({ view: 'lists', params: null });

        localStorage.setItem('xc:lastView:' + WALLET, JSON.stringify({
            view: 'list-detail',
            params: { chainId: 'bitcoin-mainnet' },
        }));
        expect(readLastViewRoute(WALLET)).toBeNull();
    });

    it('restores a deep screen and its params across browser Back and Forward', async () => {
        render(<RouteHarness />);
        await waitFor(() => expect(window.history.state?.xcRoute?.view).toBe('markets'));

        fireEvent.click(screen.getByRole('button', { name: 'Open market' }));
        await waitFor(() => expect(window.history.state?.xcRoute?.view).toBe('market'));
        expect(screen.getByText('market:XCHAIN/BTC')).toBeInTheDocument();
        await waitFor(() => expect(readLastViewRoute(WALLET)).toEqual({
            view: 'market',
            params: MARKET,
        }));

        window.history.back();
        await waitFor(() => expect(screen.getByText('markets:XCHAIN/BTC')).toBeInTheDocument());

        window.history.forward();
        await waitFor(() => expect(screen.getByText('market:XCHAIN/BTC')).toBeInTheDocument());
    });

    it('renders a plain not-found state when a saved list no longer exists', async () => {
        const messaging = {
            getListByActionIndex: vi.fn().mockResolvedValue(null),
            getActionFormats: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ListDetail
                    chainId="bitcoin-mainnet"
                    actionIndex="404"
                    onBack={() => {}}
                    onFork={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByText('List not found.')).toBeInTheDocument();
        expect(screen.queryByText('Loading…')).toBeNull();
    });

    it('renders plain not-found states for deleted token and market params', async () => {
        const messaging = new Proxy({
            getTokenInfo: vi.fn().mockResolvedValue(null),
            getMarket: vi.fn().mockResolvedValue(null),
            getMarketHistory: vi.fn().mockResolvedValue([]),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
        }, {
            get: (target, property) => target[property] || (() => Promise.resolve([])),
        });
        const token = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId={WALLET}
                    chainId="bitcoin-mainnet"
                    tick="DELETED"
                    kind="token"
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
        expect(await screen.findByText('Token not found')).toBeInTheDocument();
        token.unmount();

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MarketView
                    walletId={WALLET}
                    chainId="bitcoin-mainnet"
                    tick1="DELETED"
                    tick2="BTC"
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
        expect(await screen.findByText('Market not found')).toBeInTheDocument();
    });
});
