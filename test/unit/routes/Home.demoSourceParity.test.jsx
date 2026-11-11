// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { useWalletSource } from '../../../packages/core/src/shared/hooks/useDemoGuard.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';

const DEMO_WALLET = 'demo-wallet';
const REAL_WALLET = 'real-wallet';
const ADDRESS = 'bc1qsamplewalletsource000000000000000000000';
const addresses = {
    'bitcoin-mainnet': [{ id: 'address-1', address: ADDRESS, index: 0, role: 'external' }],
};

function messaging() {
    return {
        listWallets: vi.fn().mockResolvedValue([
            { id: DEMO_WALLET, name: 'Sample wallet' },
            { id: REAL_WALLET, name: 'Real wallet' },
        ]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressHistory: vi.fn().mockResolvedValue({ data: [{ marker: 'live-history' }] }),
        getDispensersForSource: vi.fn().mockResolvedValue({ data: [{ marker: 'live-dispenser' }] }),
        getStakesForAddress: vi.fn().mockResolvedValue({ data: [{ marker: 'live-stake' }] }),
        getOrdersForAddress: vi.fn().mockResolvedValue({ data: [{ marker: 'live-order' }] }),
        getSwapsForAddress: vi.fn().mockResolvedValue({ data: [{ marker: 'live-swap' }] }),
        passthroughRead: vi.fn().mockResolvedValue('kept'),
    };
}

function wrapper(base) {
    return function SourceWrapper({ children }) {
        return <MessagingProvider shell="web" messaging={base}>{children}</MessagingProvider>;
    };
}

async function quickActionLabels(walletId) {
    const base = messaging();
    const onSwap = vi.fn();
    const view = render(
        <MessagingProvider shell="web" messaging={base}>
            <Home
                activeWalletId={walletId}
                onSend={vi.fn()}
                onReceive={vi.fn()}
                onSwap={onSwap}
            />
        </MessagingProvider>,
    );
    const row = await screen.findByRole('group', { name: 'Quick actions' });
    const labels = within(row).getAllByRole('button').map((button) => button.textContent.trim());
    fireEvent.click(within(row).getByRole('button', { name: 'Swap' }));
    expect(onSwap).toHaveBeenCalledTimes(1);
    view.unmount();
    return labels;
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    vi.restoreAllMocks();
});

describe('wallet data source', () => {
    it('answers every sample Home position read without explorer reads', async () => {
        const base = messaging();
        markDemoWallet(DEMO_WALLET);
        const { result } = renderHook(() => useWalletSource(DEMO_WALLET), { wrapper: wrapper(base) });

        const history = await result.current.messaging.getAddressHistory({
            chainId: 'bitcoin-mainnet', address: ADDRESS,
        });
        const dispensers = await result.current.messaging.getDispensersForSource({
            chainId: 'bitcoin-mainnet', address: ADDRESS,
        });
        const stakes = await result.current.messaging.getStakesForAddress({
            chainId: 'bitcoin-mainnet', address: ADDRESS,
        });
        const orders = await result.current.messaging.getOrdersForAddress({
            chainId: 'bitcoin-mainnet', address: ADDRESS,
        });
        const swaps = await result.current.messaging.getSwapsForAddress({
            chainId: 'bitcoin-mainnet', address: ADDRESS,
        });

        expect(history.data.length).toBeGreaterThan(0);
        expect(dispensers.data.length).toBeGreaterThan(0);
        expect(stakes.data.length).toBeGreaterThan(0);
        expect(orders.data.some((row) => row.state?.status === 'open')).toBe(true);
        expect(swaps.data.some((row) => row.swap_status === 'open')).toBe(true);
        expect(base.getAddressHistory).not.toHaveBeenCalled();
        expect(base.getDispensersForSource).not.toHaveBeenCalled();
        expect(base.getStakesForAddress).not.toHaveBeenCalled();
        expect(base.getOrdersForAddress).not.toHaveBeenCalled();
        expect(base.getSwapsForAddress).not.toHaveBeenCalled();
        expect(await result.current.messaging.passthroughRead()).toBe('kept');
        expect(result.current).toMatchObject({ live: false, canSpend: false, pricesTestCoins: true });
    });

    it('passes a real wallet through to the base messaging module', async () => {
        const base = messaging();
        const { result } = renderHook(() => useWalletSource(REAL_WALLET), { wrapper: wrapper(base) });

        expect(result.current.messaging).toBe(base);
        await result.current.messaging.getAddressHistory({
            chainId: 'bitcoin-mainnet', address: ADDRESS,
        });
        expect(base.getAddressHistory).toHaveBeenCalledTimes(1);
        expect(result.current).toMatchObject({ live: true, canSpend: true, pricesTestCoins: false });
    });

    it('renders matching quick actions and Swap control for sample and real wallets', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
        markDemoWallet(DEMO_WALLET);
        const sampleLabels = await quickActionLabels(DEMO_WALLET);
        clearDemoWalletId();
        const realLabels = await quickActionLabels(REAL_WALLET);

        expect(sampleLabels).toEqual(realLabels);
        expect(sampleLabels).toEqual(['Send', 'Receive', 'Swap']);
    });
});
