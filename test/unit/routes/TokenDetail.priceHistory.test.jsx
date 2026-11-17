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
    window.localStorage.removeItem('xc:balanceUnit');
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

// The price line behind the balance card is a labelled image whose
// description names the selected range.
const chartFor = (range) => screen.findByRole('img', { name: new RegExp(`Range ${range}\\.`) });

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
    const mine = 'bc1qmine';
    const other = 'bc1qother';
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
        getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET_CHAIN]: [{ address: mine }] }),
        getAddressHistory: vi.fn().mockResolvedValue([
            {
                action_index: '500.1', action: 'SEND', tick: 'BTC', amount: '0.5',
                source: other, destination: mine, timestamp: Math.floor(Date.now() / 1000) - 2 * 86_400,
                block_index: 500,
            },
        ]),
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
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        fireEvent.click(screen.getByRole('button', { name: 'Supply over time' }));
        expect(screen.getByRole('status', { name: 'Loading supply history' }).style.height).toBe('94px');
        const detailsCard = screen.getByRole('region', { name: 'Token details' }).parentElement;
        const supplySlot = detailsCard.nextElementSibling;

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
        expect(detailsCard.nextElementSibling).toBe(supplySlot);
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

        const hero = await screen.findByRole('region', { name: 'NOROSTER' });
        // The element after the balance hero holds content, not an empty slot.
        expect(hero.nextElementSibling.textContent.trim()).not.toBe('');
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(await screen.findByText('Creator')).toBeTruthy();
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
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        fireEvent.click(screen.getByRole('button', { name: 'Supply over time' }));
        const title = await screen.findByText('No supply history yet');
        const detailsCard = screen.getByRole('region', { name: 'Token details' }).parentElement;
        // The empty state is a sibling of the details card: one message in
        // the tab panel, with no card drawn around it.
        expect(detailsCard.nextElementSibling.contains(title)).toBe(true);
        expect(detailsCard.nextElementSibling.parentElement).toBe(detailsCard.parentElement);
        expect(detailsCard.nextElementSibling.querySelector('section, [class*="infoCard"]')).toBeNull();
        expect(detailsCard.nextElementSibling.className).not.toMatch(/infoCard/);
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

        const actions = await screen.findByRole('list', { name: 'Actions for BTC' });
        expect(screen.queryByRole('status', { name: 'Loading price alert action' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Add Alert' })).toBeNull();
        // While native prices settle, the Price alert row is held back by its reason.
        const alertRow = within(actions).getByRole('button', { name: /^Price alert\b/ });
        expect(alertRow).toHaveAttribute('aria-disabled', 'true');
        expect(within(alertRow).getByText('Needs a current price.')).toBeTruthy();

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

        await vi.waitFor(() => expect(within(actions).getByRole('button', { name: /Price alert/ })).not.toHaveAttribute('aria-disabled'));
        fireEvent.click(within(actions).getByRole('button', { name: /Price alert/ }));
        // The action opens Add Price Alert as its own page with BTC chosen; Back returns here.
        expect(await screen.findByRole('heading', { level: 1, name: 'Add Price Alert' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Add Alert' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^Asset: BTC/ })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(await screen.findByRole('list', { name: 'Actions for BTC' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add Alert' })).toBeNull();
        expect(screen.getByRole('img', { name: /Range 1W\./ })).toBeTruthy();
        const chartRanges = screen.getByRole('tablist', { name: 'Chart range' });
        expect([...chartRanges.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent))
            .toEqual(['24h', '1W', '1M', '3M', '6M', '1Y', 'YTD', 'All']);
    });

    it('uses the selected currency for balances, market values, and price requests', async () => {
        const messaging = renderNativeDetail();

        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        // 2 BTC at the live €40,000 price; the carried rate of 50 only stands in.
        expect(await screen.findAllByText(/€80,000\.00/)).not.toHaveLength(0);
        await screen.findByText('€1.20B');
        expect(screen.getByText('Price').closest('li')).toHaveTextContent('€40,000.00');
        expect(screen.getByText('€1.20B')).toBeTruthy();
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
        const hero = await screen.findByRole('region', { name: 'BTC' });

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        await screen.findByText('€1.20B');
        const estimate = screen.getByText('Estimated value').closest('li');
        expect(estimate).toHaveTextContent(/€80,000\.00/);
        expect(estimate).not.toHaveTextContent(/€100\.00/);
        // The hero's swap button shows the same live value in fiat.
        const showFiat = within(hero).queryByRole('button', { name: 'Show in EUR' });
        if (showFiat) fireEvent.click(showFiat);
        expect(hero).toHaveTextContent(/80,000\.00/);
        expect(within(hero).queryByText(/100\.00/)).toBeNull();
    });

    it('switches the hero, chart series, range, pill, and scale with the selected unit', async () => {
        renderNativeDetail();
        const hero = await screen.findByRole('region', { name: 'BTC' });
        const chart = await chartFor('1W');
        const scaleLabels = () => [...chart.parentElement.querySelectorAll('[data-chart-scale]')]
            .map((label) => label.textContent);

        expect(hero).toHaveTextContent('80,000.00');
        expect(screen.getByRole('region', { name: 'Value chart' })).toBeTruthy();
        expect(scaleLabels()).toHaveLength(5);
        expect(scaleLabels().every((label) => label.startsWith('€'))).toBe(true);
        expect(chart.parentElement.querySelectorAll('[data-chart-scale-band="hero"]')).toHaveLength(2);
        expect(chart.parentElement.querySelector('svg[data-chart-scale-band="hero"] [data-chart-guide]')).toBeTruthy();
        expect(chart.querySelector('polyline[data-chart-tone="up"]')).toHaveAttribute('stroke', 'var(--xc-hero-chart-up)');
        expect(chart.querySelector('linearGradient[data-chart-fill-tone="up"] stop')).toHaveAttribute('stop-opacity', 'var(--xc-hero-chart-fill-opacity)');
        expect(within(hero).getByLabelText(/^1W change\./)).toBeTruthy();

        fireEvent.click(within(hero).getByRole('button', { name: 'Show in BTC' }));
        await vi.waitFor(() => expect(screen.getByRole('region', { name: 'Balance chart' })).toBeTruthy());
        expect(within(hero).getByLabelText('2.00000000 BTC')).toBeTruthy();
        expect(scaleLabels()).toEqual(['2 BTC', '1.88 BTC', '1.75 BTC', '1.63 BTC', '1.5 BTC']);
        expect(chart).toHaveAccessibleName(/Range high 2 BTC, low 1\.5 BTC/);
        expect(within(hero).queryByLabelText(/^1W change\./)).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: '1M' }));
        expect(await chartFor('1M')).toHaveAccessibleName(/Range high 2 BTC, low 1\.5 BTC/);
        fireEvent.click(within(hero).getByRole('button', { name: 'Show in EUR' }));
        expect(within(screen.getByRole('tablist', { name: 'Chart range' })).getByRole('tab', { name: '1M' }))
            .toHaveAttribute('aria-selected', 'true');
        await vi.waitFor(() => expect(scaleLabels().every((label) => label.startsWith('€'))).toBe(true));
    });

    it('loads a real native daily range lazily and draws its recorded history', async () => {
        const messaging = renderNativeDetail();
        await chartFor('1W');

        fireEvent.click(screen.getByRole('tab', { name: '1Y' }));

        expect(await chartFor('1Y')).toBeTruthy();
        expect(messaging.getNativePricesRequest).toHaveBeenCalledWith({
            chainIds: [MAINNET_CHAIN],
            includeSparkline: false,
            includeHistory: true,
            fiatCurrency: 'EUR',
        });
    });

    it('opens a demo native coin detail with the 1W range selected', async () => {
        renderNativeDetail('demo-wallet');

        const tablist = await screen.findByRole('tablist', { name: 'Chart range' });
        expect(within(tablist).getByRole('tab', { name: '1W' }))
            .toHaveAttribute('aria-selected', 'true');
        expect(await chartFor('1W')).toBeTruthy();
    });

    it('keeps the range tabs while daily history loads and reuses it after a trip back to 1W', async () => {
        const messaging = renderNativeDetail();
        let release;
        const base = messaging.getNativePricesRequest.getMockImplementation();
        messaging.getNativePricesRequest.mockImplementation((request) => (request.includeHistory
            ? new Promise((resolve) => { release = () => resolve(base(request)); })
            : base(request)));
        await chartFor('1W');

        fireEvent.click(screen.getByRole('tab', { name: '1M' }));
        const tablist = await screen.findByRole('tablist', { name: 'Chart range' });
        expect(within(tablist).getByRole('tab', { name: '1M' }).getAttribute('aria-selected')).toBe('true');
        // The chart slot holds the card's height while the daily history loads.
        const panel = screen.getByRole('region', { name: 'Price chart' });
        await vi.waitFor(() => expect(panel).toHaveAttribute('aria-busy', 'true'));
        expect(within(panel).queryByRole('img')).toBeNull();

        await act(async () => { release(); });
        expect(await chartFor('1M')).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: '1W' }));
        await chartFor('1W');
        fireEvent.click(screen.getByRole('tab', { name: '3M' }));
        expect(await chartFor('3M')).toBeTruthy();
        const historyCalls = messaging.getNativePricesRequest.mock.calls.filter(([request]) => request.includeHistory);
        expect(historyCalls).toHaveLength(1);
    });

    it('draws no synthesized price line for a real wallet, only its real balance', async () => {
        renderDetail('real-wallet');
        const balance = await screen.findByRole('region', { name: 'PRICEPROBE' });
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(await screen.findByText('Price (DEX)')).toBeTruthy();
        expect(screen.getByText('0.5 BTC')).toBeTruthy();
        expect(balance.textContent).not.toContain('$');
        expect(balance.textContent).not.toContain('USD');
        expect(screen.queryByRole('img', { name: /^Price trend/ })).toBeNull();
        // With no price history the hero draws the balance from the wallet's
        // own rows (operator ruling 2026-11-15), so its range buttons show.
        expect(await screen.findByRole('img', { name: /^Balance trend/ })).toBeTruthy();
        expect(screen.getByRole('tablist', { name: 'Chart range' }).className).not.toMatch(/rangesIdle/);
    });

    it('prints a small DEX price as a decimal and still derives the market cap', async () => {
        // The token record carries the price as a number, and a small one
        // stringifies in exponent form.
        renderDetail('real-wallet', {
            assetInfo: { creator: 'bcrt1qx', marketPrice: 1.5384615384615385e-9, totalSupply: '1000000' },
        });

        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        expect(await screen.findByText('0.0000000015384615 BTC')).toBeTruthy();
        expect(screen.getByText('Market cap').nextElementSibling).toHaveTextContent('0.0015 BTC');
        expect(screen.queryByText(/e-9/)).toBeNull();
    });

    it('draws selectable synthesized ranges only for the demo wallet', async () => {
        renderDetail('demo-wallet');
        const chart = await screen.findByRole('img', { name: /^Balance trend/ });
        expect(chart.querySelector('polyline').getAttribute('points').length).toBeGreaterThan(10);
        const ranges = screen.getByRole('tablist', { name: 'Chart range' });
        expect(ranges).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: '24h' }));
        expect(await chartFor('24h')).toBeTruthy();
    });

    it('values a demo holding at its DEX-derived fiat rate when token metadata has no market price', async () => {
        renderDetail('demo-wallet', {
            assetInfo: { creator: 'bcrt1qx' },
            tokenProps: { fiatRate: 2, fiatRateSource: 'market', divisibility: 0 },
        });

        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        // 10 units at the carried DEX rate of $2.00. The page no longer prints
        // a price-source label for a rate the oracle did not supply.
        const estimate = (await screen.findByText('Estimated value')).closest('li');
        expect(estimate).toHaveTextContent('20.00');
        expect(screen.queryByText(/DEX price/)).toBeNull();
    });

    it('does not show fiat from a balance snapshot on a real test-network wallet', async () => {
        renderDetail('real-wallet', {
            assetInfo: { creator: 'bcrt1qx' },
            tokenProps: { fiatRate: 2, fiatRateSource: 'market', divisibility: 0 },
        });

        await screen.findByRole('region', { name: 'PRICEPROBE' });
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

        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        expect(await screen.findByText('Price source')).toBeTruthy();
        expect(view.container.textContent).not.toMatch(/NaN|Infinity/);
        // A non-finite price or market cap gets no row rather than a number.
        expect(screen.queryByText('Price')).toBeNull();
        expect(screen.queryByText('Market cap')).toBeNull();
    });

    it('keeps token details usable when the market panel throws and retries it inline', async () => {
        widgetFailure.current = 'market';
        renderDetail('demo-wallet');

        expect(await screen.findByRole('alert')).toHaveTextContent('Couldn\'t load this section.');
        expect(screen.getByRole('list', { name: 'Actions for PRICEPROBE' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();

        widgetFailure.current = null;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('img', { name: /^Balance trend/ })).toBeInTheDocument();
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

        fireEvent.click(await screen.findByRole('button', { name: /Price alert/ }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Add Price Alert' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^Asset: XCHAIN/ })).toBeTruthy();
        expect(await screen.findByText('Now $1.2')).toBeTruthy();
        fireEvent.change(screen.getByRole('textbox', { name: 'Target price' }), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add Alert' }));

        // A saved alert returns to the token page.
        expect(await screen.findByRole('list', { name: 'Actions for XCHAIN' })).toBeTruthy();
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

        await screen.findByRole('list', { name: 'Actions for NOPRICE' });
        expect(screen.queryByRole('button', { name: /Price alert/ })).toBeNull();
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
