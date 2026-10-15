// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A price kept from before a failed refresh stays on screen, but always with
// its age: TokenDetail labels a kept token or coin rate, and the Home hero's
// one freshness line covers a kept 24h move. A test network never shows fiat.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const HOUR_MS = 60 * 60_000;

let savedResizeObserver;
beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    };
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function messagingFor(settings = { walletMode: 'full', fiatCurrency: 'USD' }) {
    return {
        getSettings: vi.fn().mockResolvedValue(settings),
        getTokenInfo: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        getNativePricesRequest: vi.fn().mockResolvedValue({ prices: {} }),
    };
}

function renderTokenDetail(props, settings) {
    const messaging = messagingFor(settings);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId="wallet"
                tick="PRICEPROBE"
                kind="token"
                quantity="10"
                divisibility={0}
                fiatRate={2}
                onBack={() => {}}
                {...props}
            />
        </MessagingProvider>,
    );
}

describe('TokenDetail kept price', () => {
    it('labels a kept mainnet rate with its age', async () => {
        renderTokenDetail({
            chainId: 'bitcoin-mainnet',
            fiatRateStale: true,
            fiatRateFetchedAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
        });

        const note = (await screen.findByText(/≈ \$20\.00/)).closest('[class*="_balanceHeroNote_"]');
        expect(note.textContent).toMatch(/Updated/);
    });

    it('shows a fresh mainnet rate with no age label', async () => {
        renderTokenDetail({
            chainId: 'bitcoin-mainnet',
            fiatRateStale: false,
            fiatRateFetchedAt: new Date().toISOString(),
        });

        const note = (await screen.findByText(/≈ \$20\.00/)).closest('[class*="_balanceHeroNote_"]');
        expect(note.textContent).not.toMatch(/Updated/);
    });

    it('never shows a kept mainnet rate on a test network', async () => {
        renderTokenDetail({
            chainId: 'bitcoin-testnet',
            fiatRateStale: true,
            fiatRateFetchedAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
        }, { walletMode: 'full', fiatCurrency: 'USD', activeNetwork: 'testnet' });

        await screen.findAllByText('PRICEPROBE');
        expect(screen.queryByText(/≈ \$20\.00/)).toBeNull();
        expect(screen.queryByText(/Updated/)).toBeNull();
    });
});

describe('Home hero kept 24h move', () => {
    const now = Date.now();
    const row = {
        kind: 'native',
        chainId: 'bitcoin-mainnet',
        tick: 'BTC',
        quantity: '100000000',
        divisibility: 8,
        fiatRate: 1000,
        fiatRateFetchedAt: new Date(now).toISOString(),
        fiatRateStale: false,
    };

    function renderHero(entry) {
        render(
            <MessagingProvider shell="web" messaging={messagingFor()}>
                <TotalBalanceHero
                    rows={[row]}
                    walletId="wallet"
                    networkFilter="all"
                    lastSyncedAt={now}
                    nativePriceMap={{ 'bitcoin-mainnet': entry }}
                />
            </MessagingProvider>,
        );
        return screen.getByText(/^Updated/);
    }

    it('dates the freshness line from a kept 24h move', () => {
        const label = renderHero({
            priceFiat: 1000,
            change24hPct: 5,
            fetchedAt: now - 3 * HOUR_MS,
            stale: true,
        });
        expect(label.textContent).toMatch(/3/);
        expect(label.textContent).not.toMatch(/just now|0 ?s|now/i);
    });

    it('keeps the freshness line current when the 24h move is fresh', () => {
        const label = renderHero({
            priceFiat: 1000,
            change24hPct: 5,
            fetchedAt: now - 3 * HOUR_MS,
            stale: false,
        });
        expect(label.textContent).not.toMatch(/3/);
    });
});
