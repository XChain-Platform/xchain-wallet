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
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';

const { widgetFailure, tickFiatRate } = vi.hoisted(() => ({
    widgetFailure: { current: null },
    tickFiatRate: { current: null },
}));
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

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useTickFiatRate: ({ enabled = true } = {}) => (enabled ? tickFiatRate.current : null),
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

beforeEach(() => {
    tickFiatRate.current = null;
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
const MAINNET_CHAIN = 'bitcoin-mainnet';
const HISTORY_DAILY = Array.from({ length: 366 }, (_, index) => [
    Date.now() - (365 - index) * 86_400_000,
    30_000 + index * 25,
]);

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

function renderNativeDetail(walletId = 'real-wallet') {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'EUR' }),
        getNativePricesRequest: vi.fn().mockImplementation(async (request) => ({
            prices: {
                [MAINNET_CHAIN]: request.includeHistory ? { historyDaily: HISTORY_DAILY } : {
                    priceFiat: 40000,
                    marketCapFiat: 1200000000,
                    change24hPct: 1.5,
                    sparkline: [39000, 40000],
                    fetchedAt: Date.now(),
                },
            },
        })),
        getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET_CHAIN]: [] }),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenDetail, {
            walletId,
            chainId: MAINNET_CHAIN,
            tick: 'BTC',
            kind: 'native',
            quantity: '200000000',
            divisibility: 8,
            fiatRate: 50,
            onBack() {},
        }),
    ));
    return messaging;
}

describe('TokenDetail price history', () => {
    it('keeps supply history hidden until More info reveals its stable slot', async () => {
        const finishInfo = [];
        let finishHistory;
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getTokenInfo: vi.fn(() => new Promise((resolve) => { finishInfo.push(resolve); })),
            getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET_CHAIN]: [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory: vi.fn(() => new Promise((resolve) => { finishHistory = resolve; })),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId="w1"
                    chainId={MAINNET_CHAIN}
                    tick="SUPPLYPROBE"
                    kind="token"
                    quantity="100"
                    onBack={() => {}}
                    onBuy={() => {}}
                />
            </MessagingProvider>,
        );

        await screen.findByRole('status', { name: 'Loading token artwork' });
        expect(document.querySelectorAll('[aria-label="Loading token artwork"]')).toHaveLength(1);
        expect(screen.queryByRole('status', { name: 'Loading supply history' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'More info' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Supply over time' }));
        expect(screen.getByRole('status', { name: 'Loading supply history' }).style.height).toBe('94px');
        expect(screen.getByRole('status', { name: 'Loading price history' }).style.height).toBe('64px');
        const actions = screen.getByRole('group', { name: 'Quick actions' });
        const supplySlot = actions.nextElementSibling;

        await act(async () => {
            const info = {
                creator: 'bcrt1qx',
                marketPrice: '0.5',
                projects: ['Example'],
                images: [{ type: 'icon', url: 'https://assets.example/icon.png' }],
            };
            for (const resolve of finishInfo) resolve(info);
            finishHistory([{ height: 1, supply: 10 }, { height: 2, supply: 50 }]);
        });

        expect(await screen.findByRole('img', { name: /Supply of SUPPLYPROBE over time/ })).toBeTruthy();
        expect(screen.getByText('Projects').closest('li')).toHaveTextContent('Example');
        expect(actions.nextElementSibling).toBe(supplySlot);
        expect(screen.queryByRole('status', { name: 'Loading supply history' })).toBeNull();
    });

    it('leaves no blank project row once a token on no roster has loaded', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qx', marketPrice: '0.5', projects: [] }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET_CHAIN]: [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId="w1"
                    chainId={MAINNET_CHAIN}
                    tick="NOROSTER"
                    kind="token"
                    quantity="100"
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        const hero = await screen.findByRole('region', { name: 'NOROSTER balance' });
        // The element after the balance hero holds content, not an empty slot.
        expect(hero.nextElementSibling.textContent.trim()).not.toBe('');
        expect(screen.queryByText('Projects')).toBeNull();
    });

    it('shows an empty supply history beside the page sections, not inside a card', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qx', projects: [] }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET_CHAIN]: [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId="w1"
                    chainId={MAINNET_CHAIN}
                    tick="NOSUPPLY"
                    kind="token"
                    quantity="100"
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        await vi.waitFor(() => expect(messaging.getSupplyHistory).toHaveBeenCalled());
        expect(screen.queryByText('No supply history yet')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'More info' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Supply over time' }));
        const title = await screen.findByText('No supply history yet');
        const hero = screen.getByRole('region', { name: 'NOSUPPLY balance' });
        const actions = screen.getByRole('group', { name: 'Quick actions' });
        // The empty state is a sibling of the hero and the actions: one
        // message in the page stack, with no card drawn around it.
        expect(actions.nextElementSibling.contains(title)).toBe(true);
        expect(actions.nextElementSibling.parentElement).toBe(hero.parentElement);
        expect(actions.nextElementSibling.querySelector('section, [class*="infoCard"]')).toBeNull();
        expect(actions.nextElementSibling.className).not.toMatch(/infoCard/);
    });

    it('keeps the price alert behind More info while native prices settle', async () => {
        let finishPrices;
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'USD' }),
            getNativePricesRequest: vi.fn(() => new Promise((resolve) => { finishPrices = resolve; })),
            getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET_CHAIN]: [] }),
            listPriceAlertsForWallet: vi.fn().mockResolvedValue([]),
            savePriceAlert: vi.fn().mockResolvedValue(undefined),
            clearPriceAlert: vi.fn().mockResolvedValue(undefined),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId="real-wallet"
                    chainId={MAINNET_CHAIN}
                    tick="BTC"
                    kind="native"
                    quantity="200000000"
                    divisibility={8}
                    onBack={() => {}}
                    onReceive={() => {}}
                />
            </MessagingProvider>,
        );

        const historySkeleton = await screen.findByRole('status', { name: 'Loading price history' });
        expect(historySkeleton.style.height).toBe('64px');
        expect(screen.queryByRole('status', { name: 'Loading price alert action' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Set price alert' })).toBeNull();
        const actions = screen.getByRole('group', { name: 'Quick actions' });

        await act(async () => {
            finishPrices({
                prices: {
                    [MAINNET_CHAIN]: {
                        priceFiat: 40000,
                        marketCapFiat: 1200000000,
                        change24hPct: 1.5,
                        sparkline: [39000, 40000],
                        fetchedAt: Date.now(),
                    },
                },
            });
        });

        fireEvent.click(within(actions).getByRole('button', { name: 'More info' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Set price alert' }));
        expect(await screen.findByRole('button', { name: 'Add alert' })).toBeTruthy();
        expect(screen.getByLabelText('1W price chart')).toBeTruthy();
        expect(screen.queryByText('No price history yet')).toBeNull();
        const chartRanges = screen.getByRole('tablist', { name: 'Chart range' });
        expect([...chartRanges.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent))
            .toEqual(['24h', '1W', '1M', '3M', '6M', '1Y', 'YTD', 'All']);
        expect(screen.queryByRole('status', { name: 'Loading price history' })).toBeNull();
    });

    it('uses the selected currency for balances, market values, and price requests', async () => {
        const messaging = renderNativeDetail();

        // 2 BTC at the live €40,000 price; the carried rate of 50 only stands in.
        expect(await screen.findAllByText(/€80,000\.00/)).not.toHaveLength(0);
        expect(await screen.findByText('€40,000.00')).toBeTruthy();
        expect(await screen.findByText('€1.20B')).toBeTruthy();
        expect(screen.queryByText('$40,000.00')).toBeNull();
        expect(messaging.getNativePricesRequest).toHaveBeenLastCalledWith({
            chainIds: [MAINNET_CHAIN],
            includeSparkline: true,
            fiatCurrency: 'EUR',
        });
    });

    it('values a native holding at the live price rather than a carried or restored rate', async () => {
        // A reload restores the route with the rate the balance row had then.
        renderNativeDetail();
        const hero = await screen.findByRole('region', { name: 'BTC balance' });

        await screen.findByText('€40,000.00');
        expect(within(hero).getByText(/€80,000\.00/)).toBeTruthy();
        expect(within(hero).queryByText(/€100\.00/)).toBeNull();
    });

    it('loads a real native daily range lazily and draws its recorded history', async () => {
        const messaging = renderNativeDetail();
        await screen.findByLabelText('1W price chart');

        fireEvent.click(screen.getByRole('tab', { name: '1Y' }));

        expect(await screen.findByLabelText('1Y price chart')).toBeTruthy();
        expect(messaging.getNativePricesRequest).toHaveBeenCalledWith({
            chainIds: [MAINNET_CHAIN],
            includeSparkline: false,
            includeHistory: true,
            fiatCurrency: 'EUR',
        });
        expect(screen.queryByText('No price history yet')).toBeNull();
    });

    it('opens a demo native coin detail with the 1W range selected', async () => {
        renderNativeDetail('demo-wallet');

        const tablist = await screen.findByRole('tablist', { name: 'Chart range' });
        expect(within(tablist).getByRole('tab', { name: '1W' }))
            .toHaveAttribute('aria-selected', 'true');
        expect(await screen.findByLabelText('1W price chart')).toBeTruthy();
    });

    it('keeps the range tabs while daily history loads and reuses it after a trip back to 1W', async () => {
        const messaging = renderNativeDetail();
        let release;
        const base = messaging.getNativePricesRequest.getMockImplementation();
        messaging.getNativePricesRequest.mockImplementation((request) => (request.includeHistory
            ? new Promise((resolve) => { release = () => resolve(base(request)); })
            : base(request)));
        await screen.findByLabelText('1W price chart');

        fireEvent.click(screen.getByRole('tab', { name: '1M' }));
        const tablist = await screen.findByRole('tablist', { name: 'Chart range' });
        expect(within(tablist).getByRole('tab', { name: '1M' }).getAttribute('aria-selected')).toBe('true');
        const loading = await screen.findByRole('status', { name: 'Loading price history' });
        expect(loading.style.height).toBe('40px');

        await act(async () => { release(); });
        expect(await screen.findByLabelText('1M price chart')).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: '1W' }));
        await screen.findByLabelText('1W price chart');
        fireEvent.click(screen.getByRole('tab', { name: '3M' }));
        expect(await screen.findByLabelText('3M price chart')).toBeTruthy();
        const historyCalls = messaging.getNativePricesRequest.mock.calls.filter(([request]) => request.includeHistory);
        expect(historyCalls).toHaveLength(1);
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

    it('prints a small DEX price as a decimal and still derives the market cap', async () => {
        // The token record carries the price as a number, and a small one
        // stringifies in exponent form.
        renderDetail('real-wallet', {
            assetInfo: { creator: 'bcrt1qx', marketPrice: 1.5384615384615385e-9, totalSupply: '1000000' },
        });

        expect(await screen.findByText('0.0000000015384615 BTC')).toBeTruthy();
        expect(screen.getByText('Market cap').nextElementSibling).toHaveTextContent('0.0015 BTC');
        expect(screen.queryByText(/e-9/)).toBeNull();
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

    it('keeps a demo DEX-derived fiat rate labelled when token metadata has no market price', async () => {
        renderDetail('demo-wallet', {
            assetInfo: { creator: 'bcrt1qx' },
            tokenProps: { fiatRate: 2, fiatRateSource: 'market', divisibility: 0 },
        });

        expect(await screen.findByText('Price (DEX)')).toBeTruthy();
        expect(screen.getByText('$2.00')).toBeTruthy();
        expect(screen.getByText(/DEX price/)).toBeTruthy();
    });

    it('does not show fiat from a balance snapshot on a real test-network wallet', async () => {
        renderDetail('real-wallet', {
            assetInfo: { creator: 'bcrt1qx' },
            tokenProps: { fiatRate: 2, fiatRateSource: 'market', divisibility: 0 },
        });

        expect(await screen.findByText('No price history yet')).toBeTruthy();
        expect(screen.queryByText('$2.00')).toBeNull();
        expect(screen.queryByText(/DEX price/)).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        // Detail fields are list rows: the value sits in the same row as its label.
        const estimate = screen.getByText('Estimated value').closest('li');
        expect(estimate).toHaveTextContent('-');
        expect(estimate).not.toHaveTextContent('2.00');
    });

    it('renders dashes instead of non-finite native market values', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'USD' }),
            getNativePricesRequest: vi.fn().mockResolvedValue({
                prices: {
                    [MAINNET_CHAIN]: {
                        priceFiat: Number.NaN,
                        marketCapFiat: Number.POSITIVE_INFINITY,
                        change24hPct: 'NaN',
                        sparkline: null,
                    },
                },
            }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET_CHAIN]: [] }),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId="real-wallet"
                    chainId={MAINNET_CHAIN}
                    tick="BTC"
                    kind="native"
                    quantity="1"
                    divisibility={8}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByText('No market data available for this network.')).toBeTruthy();
        expect(view.container.textContent).not.toMatch(/NaN|Infinity/);
        expect(screen.getByText('Price').nextElementSibling).toHaveTextContent('-');
        expect(screen.getByText('Market cap').nextElementSibling).toHaveTextContent('-');
    });

    it('keeps token details usable when the market panel throws and retries it inline', async () => {
        widgetFailure.current = 'market';
        renderDetail('demo-wallet');

        expect(await screen.findByRole('alert')).toHaveTextContent('Couldn\'t load this section.');
        expect(screen.getByRole('group', { name: 'Quick actions' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();

        widgetFailure.current = null;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('img', { name: /^Price trend/ })).toBeInTheDocument();
    });

    it('offers and saves a token alert when the token has a market price', async () => {
        tickFiatRate.current = { rate: 1.2, fiatCurrency: 'USD', source: 'oracle' };
        const messaging = tokenAlertMessaging({ marketPrice: '1.2' });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId="real-wallet"
                    chainId={MAINNET_CHAIN}
                    tick="XCHAIN"
                    kind="token"
                    quantity="10"
                    onBack={() => {}}
                    onReceive={() => {}}
                />
            </MessagingProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'More info' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Set price alert' }));
        expect(await screen.findByText('Current: $1.20')).toBeTruthy();
        fireEvent.change(screen.getByRole('textbox', { name: 'Target price' }), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add alert' }));

        expect(await screen.findByRole('button', { name: /Price alert set/ })).toBeTruthy();
        expect(messaging.savePriceAlert).toHaveBeenCalledWith({
            walletId: 'real-wallet',
            chainId: MAINNET_CHAIN,
            tick: 'XCHAIN',
            direction: 'above',
            targetFiat: 2,
            fiatCurrency: 'usd',
        });
    });

    it('omits the token alert entry when the token has no market price', async () => {
        const messaging = tokenAlertMessaging();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail
                    walletId="real-wallet"
                    chainId={MAINNET_CHAIN}
                    tick="NOPRICE"
                    kind="token"
                    quantity="10"
                    onBack={() => {}}
                    onReceive={() => {}}
                />
            </MessagingProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'More info' }));
        expect(screen.queryByRole('menuitem', { name: 'Set price alert' })).toBeNull();
    });
});

function tokenAlertMessaging(assetInfo = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'USD' }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bc1qcreator', totalSupply: '1000', ...assetInfo }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET_CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        listPriceAlertsForWallet: vi.fn().mockResolvedValue([]),
        savePriceAlert: vi.fn().mockResolvedValue(undefined),
        clearPriceAlert: vi.fn().mockResolvedValue(undefined),
    };
}
