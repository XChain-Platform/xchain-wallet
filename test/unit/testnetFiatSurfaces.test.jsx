// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { HomeTabs } from '../../packages/core/src/shared/components/HomeTabs.jsx';
import { BalanceChanges } from '../../packages/core/src/shared/components/BalanceChanges.jsx';
import { Receive } from '../../packages/core/src/shared/routes/Receive.jsx';
import { TokenDetail } from '../../packages/core/src/shared/routes/TokenDetail.jsx';
import { useFeeFiat } from '../../packages/core/src/shared/hooks/useFeeFiat.js';
import { defaultRegistry } from '../../packages/core/src/registry/index.js';
import {
    configureFiatRateSource,
    _resetPriceLookupForTests,
} from '../../packages/core/src/flows/priceLookup.js';

const CHAIN = 'bitcoin-regtest';
const RATE = 83245.94;
const SETTINGS = {
    activeNetwork: 'regtest',
    fiatCurrency: 'USD',
    privacy: { priceDataEnabled: true },
};
const TEST_NETWORKS = [
    { chainId: 'bitcoin-testnet', activeNetwork: 'testnet' },
    { chainId: 'bitcoin-regtest', activeNetwork: 'regtest' },
];

let savedResizeObserver;

beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
});

afterAll(() => {
    globalThis.ResizeObserver = savedResizeObserver;
});

function priceVenue() {
    const calls = [];
    configureFiatRateSource({
        now: () => Date.parse('2026-10-13T12:00:00Z'),
        explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
        fetch: async (url) => {
            calls.push(url);
            return {
                ok: true,
                json: async () => ({
                    data: [{
                        coin_pair: 'BTC/USD',
                        price: String(RATE),
                        block_timestamp: Math.floor(Date.parse('2026-10-13T11:59:00Z') / 1000),
                    }],
                }),
            };
        },
    });
    return calls;
}

function provider(messaging, child) {
    return <MessagingProvider shell="web" messaging={messaging}>{child}</MessagingProvider>;
}

beforeEach(() => {
    _resetPriceLookupForTests();
});

afterEach(() => {
    cleanup();
    _resetPriceLookupForTests();
    vi.clearAllMocks();
});

describe('test-network fiat suppression', () => {
    it.each(TEST_NETWORKS)(
        'shows the Home test-coin note without fiat, change, chart, or price requests on $activeNetwork',
        async ({ chainId, activeNetwork }) => {
            const calls = priceVenue();
            const getNativePricesRequest = vi.fn().mockResolvedValue({
                prices: {
                    [chainId]: {
                        priceFiat: RATE,
                        change24hPct: 4.2,
                        sparkline: [80000, RATE],
                    },
                },
            });
            render(provider({
                getSettings: vi.fn().mockResolvedValue({ ...SETTINGS, activeNetwork }),
                getNativePricesRequest,
            }, (
                <HomeTabs
                    chainRegistry={defaultRegistry()}
                    walletId="wallet"
                    networkFilter="all"
                    balances={{
                        [chainId]: [{
                            address: 'bcrt1qhome',
                            balances: {
                                native: {
                                    tick: 'BTC',
                                    quantity: '50000000',
                                    divisibility: 8,
                                    fiatRate: RATE,
                                },
                                tokens: [],
                            },
                        }],
                    }}
                />
            )));

            const hero = await screen.findByRole('region', { name: 'Active address balance' });
            expect(within(hero).getByText('Test coins have no value')).toBeInTheDocument();
            expect(hero).not.toHaveTextContent('$');
            expect(hero).not.toHaveTextContent('24h');
            expect(screen.queryByRole('region', { name: 'Portfolio performance' })).toBeNull();
            expect(screen.queryByRole('button', { name: /chart/i })).toBeNull();
            await waitFor(() => expect(getNativePricesRequest).not.toHaveBeenCalled());
            expect(calls).toEqual([]);
        },
    );

    it('hides TokenDetail value, change, chart, and price alerts on regtest', async () => {
        const getNativePricesRequest = vi.fn().mockResolvedValue({
            prices: {
                [CHAIN]: {
                    priceFiat: RATE,
                    marketCapFiat: 1000000,
                    change24hPct: 4.2,
                    sparkline: [80000, RATE],
                },
            },
        });
        render(provider({
            getSettings: vi.fn().mockResolvedValue(SETTINGS),
            getNativePricesRequest,
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        }, (
            <TokenDetail
                walletId="wallet"
                chainId={CHAIN}
                tick="BTC"
                kind="native"
                quantity="50000000"
                fiatRate={RATE}
                onBack={() => {}}
            />
        )));

        expect(await screen.findByText('Test coins have no value.')).toBeInTheDocument();
        const balance = screen.getByRole('region', { name: 'BTC balance' });
        expect(balance).not.toHaveTextContent('$');
        expect(screen.queryByText('24h')).toBeNull();
        expect(screen.queryByRole('tablist', { name: 'Chart range' })).toBeNull();
        expect(screen.queryByRole('button', { name: /chart/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /price alert/i })).toBeNull();
        expect(getNativePricesRequest).not.toHaveBeenCalled();
    });

    it('keeps Receive amounts coin-denominated and hides the amount fiat line', async () => {
        const calls = priceVenue();
        const address = {
            id: 'address-1',
            address: 'bcrt1qreceiveexample',
            addressType: 'p2wpkh',
            source: 'hd',
            derivationPath: "m/84'/1'/0'/0/0",
        };
        render(provider({
            getSettings: vi.fn().mockResolvedValue(SETTINGS),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [address] }),
            getNewestAddress: vi.fn().mockResolvedValue(address),
        }, <Receive walletId="wallet" accountId="account" />));

        expect(await screen.findByRole('textbox', { name: 'Amount (BTC)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /switch input to/i })).toBeNull();
        expect(document.body).not.toHaveTextContent('USD');
        expect(calls).toEqual([]);
    });

    it('returns no fiat formatter for fee rows on regtest', async () => {
        const calls = priceVenue();
        const { result } = renderHook(() => useFeeFiat({
            chainCoin: 'bitcoin',
            nativeTicker: 'BTC',
            settings: SETTINGS,
        }));

        expect(result.current.formatNativeFee('0.0001')).toBeNull();
        expect(result.current.formatProtocolFee('5')).toBeNull();
        await waitFor(() => expect(calls).toEqual([]));
    });

    it('keeps review amounts and fees while omitting their dollar lines', () => {
        render(
            <BalanceChanges
                chainCoin={null}
                nativeTicker="BTC"
                fiatCurrency="USD"
                result={{
                    deltas: [
                        { tick: 'BTC', before: '0.5', after: '0.4999', isCoin: true, isFee: false },
                        { tick: 'BTC', before: '', after: '', feeAmount: '0.0001', isCoin: true, isFee: true },
                    ],
                    sideEffects: [],
                    notes: [],
                }}
            />,
        );

        // The coin delta and the fee line both read amount then ticker.
        expect(screen.getAllByText('−0.0001 BTC')).toHaveLength(2);
        expect(document.body).not.toHaveTextContent('$');
        expect(document.body).not.toHaveTextContent('Fiat unavailable');
    });
});
