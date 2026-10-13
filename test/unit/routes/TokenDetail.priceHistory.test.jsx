// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet never fabricates a number: TokenDetail draws a synthesized
// price line only for the demo wallet. A real wallet with no real history
// gets a plain message in the chart's place and no range tabs.

import { describe, it, expect, vi, afterEach, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const widgetFailure = vi.hoisted(() => ({ current: null }));
let consoleError;
const preventExpectedError = (event) => event.preventDefault();

vi.mock('../../../packages/core/src/flows/demoMode.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isDemoWallet: (id) => id === 'demo-wallet' };
});

vi.mock('../../../packages/core/src/shared/components/Sparkline.jsx', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        Sparkline: (props) => {
            if (widgetFailure.current === 'market') throw new Error('token market panel failed');
            return React.createElement(actual.Sparkline, props);
        },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener('error', preventExpectedError);
});

afterEach(() => {
    widgetFailure.current = null;
    cleanup();
    __clearTokenInfoCache();
    window.removeEventListener('error', preventExpectedError);
    consoleError.mockRestore();
});

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

function renderDetail(walletId, { assetInfo, tokenProps } = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue(assetInfo ?? { creator: 'bcrt1qx', marketPrice: '0.5', totalSupply: '1000' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenDetail, {
            walletId, chainId: CHAIN, tick: 'PRICEPROBE', kind: 'token', quantity: '10', onBack() {},
            ...tokenProps,
        }),
    ));
}

function renderNativeDetail() {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'EUR' }),
        getNativePricesRequest: vi.fn().mockResolvedValue({
            prices: {
                [CHAIN]: {
                    priceFiat: 40000,
                    marketCapFiat: 1200000000,
                    change24hPct: 1.5,
                    sparkline: [39000, 40000],
                    fetchedAt: Date.now(),
                },
            },
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenDetail, {
            walletId: 'real-wallet',
            chainId: CHAIN,
            tick: 'BTC',
            kind: 'native',
            quantity: '200000000',
            fiatRate: 50,
            onBack() {},
        }),
    ));
    return messaging;
}

describe('TokenDetail price history', () => {
    it('uses the selected currency for balances, market values, and price requests', async () => {
        const messaging = renderNativeDetail();

        expect(await screen.findAllByText(/€100\.00/)).not.toHaveLength(0);
        expect(await screen.findByText('€40,000.00')).toBeTruthy();
        expect(await screen.findByText('€1.20B')).toBeTruthy();
        expect(screen.queryByText('$40,000.00')).toBeNull();
        expect(messaging.getNativePricesRequest).toHaveBeenLastCalledWith({
            chainIds: [CHAIN],
            includeSparkline: true,
            fiatCurrency: 'EUR',
        });
    });

    it('shows a message and no synthesized line for a real wallet', async () => {
        renderDetail('real-wallet');
        expect(await screen.findByText('No price history yet')).toBeTruthy();
        expect(screen.getByText('Price (DEX)')).toBeTruthy();
        expect(screen.getByText('0.5 BTC')).toBeTruthy();
        const balance = screen.getByRole('region', { name: 'PRICEPROBE balance' });
        expect(balance.textContent).not.toContain('$');
        expect(balance.textContent).not.toContain('USD');
        expect(screen.queryByRole('img', { name: /^Price trend/ })).toBeNull();
        expect(screen.queryByRole('tablist', { name: 'Chart range' })).toBeNull();
    });

    it('draws selectable synthesized ranges only for the demo wallet', async () => {
        renderDetail('demo-wallet');
        const chart = await screen.findByRole('img', { name: /^Price trend/ });
        expect(chart.querySelector('polyline').getAttribute('points').length).toBeGreaterThan(10);
        const ranges = screen.getByRole('tablist', { name: 'Chart range' });
        expect(ranges).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: '24h' }));
        expect(screen.getByLabelText('24h price chart')).toBeTruthy();
        expect(screen.queryByText('No price history yet')).toBeNull();
    });

    it('keeps a DEX-derived fiat rate labelled when token metadata has no market price', async () => {
        renderDetail('real-wallet', {
            assetInfo: { creator: 'bcrt1qx' },
            tokenProps: { fiatRate: 2, fiatRateSource: 'market', divisibility: 0 },
        });

        expect(await screen.findByText('Price (DEX)')).toBeTruthy();
        expect(screen.getByText('$2.00')).toBeTruthy();
        expect(screen.getByText(/DEX price/)).toBeTruthy();
    });

    it('keeps token details usable when the market panel throws and retries it inline', async () => {
        widgetFailure.current = 'market';
        renderDetail('demo-wallet');

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this section.');
        expect(screen.getByRole('group', { name: 'Quick actions' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();

        widgetFailure.current = null;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('img', { name: /^Price trend/ })).toBeInTheDocument();
    });
});
