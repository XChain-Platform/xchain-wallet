// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { slowTimeout } from '../../helpers/testEnvSpeed.js';

const mocks = vi.hoisted(() => {
    const chainIds = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'];
    const historyByChain = Object.fromEntries(chainIds.map((chainId, chainIndex) => [
        chainId,
        Array.from({ length: chainIndex === 2 ? 666 : 667 }, (_, rowIndex) => ({
            action: 'SEND',
            action_index: `${chainIndex}-${rowIndex}`,
            block_index: 900_000 - rowIndex,
            timestamp: 2_000_000_000 - (chainIndex * 667) - rowIndex,
            tx_hash: `home-performance-${chainIndex}-${rowIndex}`,
            source: 'demo-address',
            destination: `destination-${chainIndex}-${rowIndex}`,
            tick: chainIndex === 0 ? 'BTC' : chainIndex === 1 ? 'LTC' : 'DOGE',
            amount: '100000000',
            status: 'valid',
        })),
    ]));
    return {
        chainIds,
        emptyObject: {},
        historyByChain,
        heroRenders: vi.fn(),
        chartRenders: vi.fn(),
        synthesizeDemoHistory: vi.fn((chainId) => historyByChain[chainId] || []),
        useCollectibleKeys: vi.fn(() => new Set()),
    };
});

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => {
        mocks.heroRenders();
        return null;
    },
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => {
        mocks.chartRenders();
        return null;
    },
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: mocks.emptyObject, shell: 'web' }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: {
            fiatCurrency: 'USD',
            privacy: { metadataFetchEnabled: false, priceDataEnabled: false },
        },
        loading: false,
    }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: mocks.useCollectibleKeys,
}));
vi.mock('../../../packages/core/src/shared/hooks/useBalancesHidden.js', () => ({
    useBalancesHidden: () => [false],
}));
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useNativeFiatRates: () => mocks.emptyObject,
    useTokenFiatRates: () => mocks.emptyObject,
    priceNativeRows: (rows) => rows,
    priceTokenRows: (rows) => rows,
}));
vi.mock('@xchain-wallet/core/flows', () => ({
    isDemoWallet: (walletId) => walletId === 'performance-wallet',
    synthesizeDemoHistory: mocks.synthesizeDemoHistory,
    synthesizeDemoDefiPositions: () => [],
}));

import { BalanceList } from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';

const descriptors = new Map([
    ['bitcoin-mainnet', { id: 'bitcoin-mainnet', coin: 'bitcoin', displayName: 'Bitcoin', networkKind: 'mainnet' }],
    ['litecoin-mainnet', { id: 'litecoin-mainnet', coin: 'litecoin', displayName: 'Litecoin', networkKind: 'mainnet' }],
    ['dogecoin-mainnet', { id: 'dogecoin-mainnet', coin: 'dogecoin', displayName: 'Dogecoin', networkKind: 'mainnet' }],
]);
const chainRegistry = {
    get: (chainId) => descriptors.get(chainId) || null,
    byCoin: (coin) => [...descriptors.values()].filter((descriptor) => descriptor.coin === coin),
    all: () => [...descriptors.values()],
};

function largeBalances() {
    return Object.fromEntries(mocks.chainIds.map((chainId, chainIndex) => {
        const nativeTick = chainIndex === 0 ? 'BTC' : chainIndex === 1 ? 'LTC' : 'DOGE';
        return [chainId, [{
            address: `large-wallet-address-${chainIndex}`,
            balances: {
                native: {
                    tick: nativeTick,
                    displayName: nativeTick,
                    quantity: '100000000',
                    divisibility: 8,
                    fiatRate: 1,
                },
                tokens: Array.from({ length: 100 }, (_, tokenIndex) => ({
                    tick: `TOKEN${String((chainIndex * 100) + tokenIndex).padStart(3, '0')}`,
                    displayName: `Performance token ${(chainIndex * 100) + tokenIndex}`,
                    quantity: String(10_000 + tokenIndex),
                    divisibility: 0,
                    fiatRate: 1,
                })),
            },
        }]];
    }));
}

function mountLargeHome(onRender) {
    return render(
        <Profiler id="large-home" onRender={onRender}>
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={largeBalances()}
                walletId="performance-wallet"
                networkFilter="all"
            />
        </Profiler>,
    );
}

beforeEach(() => {
    localStorage.clear();
    mocks.synthesizeDemoHistory.mockClear();
    mocks.useCollectibleKeys.mockClear();
    mocks.heroRenders.mockClear();
    mocks.chartRenders.mockClear();
});

afterEach(() => {
    cleanup();
});

describe('Home large-wallet performance', () => {
    it('bounds initial and token-tab rendering for 300 tokens, 3 chains, and 2,000 deferred history entries', () => {
        let commitCount = 0;
        let renderDurationMs = 0;
        const onRender = (_id, _phase, actualDuration) => {
            commitCount += 1;
            renderDurationMs += actualDuration;
        };

        const startedAt = performance.now();
        const view = mountLargeHome(onRender);
        const initialElapsedMs = performance.now() - startedAt;
        const initialCommitCount = commitCount;

        console.info(`Home large-wallet initial render: ${initialElapsedMs.toFixed(1)} ms, ${initialCommitCount} commits, ${renderDurationMs.toFixed(1)} ms profiled`);
        expect(initialElapsedMs).toBeLessThan(slowTimeout(800));
        expect(renderDurationMs).toBeLessThan(slowTimeout(800));
        expect(initialCommitCount).toBeLessThanOrEqual(3);
        expect(view.container.querySelectorAll('[data-balance-key]')).toHaveLength(3);
        expect(Object.values(mocks.historyByChain).flat()).toHaveLength(2_000);
        expect(mocks.useCollectibleKeys).toHaveBeenLastCalledWith([], true);
        expect(mocks.synthesizeDemoHistory).not.toHaveBeenCalled();

        const tokenStartedAt = performance.now();
        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        const tokenElapsedMs = performance.now() - tokenStartedAt;
        const tokenCommitCount = commitCount - initialCommitCount;

        console.info(`Home 300-token tab render: ${tokenElapsedMs.toFixed(1)} ms, ${tokenCommitCount} commits`);
        expect(tokenElapsedMs).toBeLessThan(slowTimeout(1_500));
        expect(tokenCommitCount).toBeLessThanOrEqual(2);
        expect(view.container.querySelectorAll('[data-balance-key]')).toHaveLength(300);
        expect(mocks.synthesizeDemoHistory).not.toHaveBeenCalled();
    });

    it('does not render unchanged balance rows again when their list parent updates', () => {
        let rowReads = 0;
        const rows = Array.from({ length: 300 }, (_, index) => {
            const row = {
                chainId: mocks.chainIds[index % mocks.chainIds.length],
                tick: `ROW${index}`,
                displayName: `Row ${index}`,
                kind: 'token',
                quantity: '1',
                divisibility: 0,
                fiatRate: 1,
            };
            Object.defineProperty(row, 'networkKind', {
                get() {
                    rowReads += 1;
                    return 'mainnet';
                },
            });
            return row;
        });
        const view = render(<BalanceList rows={rows} emptyBody="First empty copy" />);
        const initialRowReads = rowReads;

        view.rerender(<BalanceList rows={rows} emptyBody="Updated empty copy" />);

        expect(initialRowReads).toBeGreaterThanOrEqual(300);
        expect(rowReads).toBe(initialRowReads);
    });

    it('does not rerender the unchanged hero and chart when switching asset tabs', () => {
        mountLargeHome(() => {});
        const heroRenders = mocks.heroRenders.mock.calls.length;
        const chartRenders = mocks.chartRenders.mock.calls.length;

        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));

        expect(mocks.heroRenders).toHaveBeenCalledTimes(heroRenders);
        expect(mocks.chartRenders).toHaveBeenCalledTimes(chartRenders);
    });
});
