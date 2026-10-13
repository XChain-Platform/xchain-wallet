// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// HomeTabs empty states: one explanation per tab, left to the empty card.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';

const tabsCss = readFileSync(
    'packages/core/src/shared/components/HomeTabs.module.css',
    'utf8',
);

const widgetFailure = vi.hoisted(() => ({ current: null }));
const messagingHarness = vi.hoisted(() => ({ current: {} }));
let consoleError;
const preventExpectedError = (event) => event.preventDefault();

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => {
        if (widgetFailure.current === 'ticker') throw new Error('price ticker failed');
        return React.createElement('div', null, 'Price ticker');
    },
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => {
        if (widgetFailure.current === 'chart') throw new Error('portfolio chart failed');
        return React.createElement('div', null, 'Portfolio chart');
    },
}));
vi.mock('../../../packages/core/src/shared/components/CollectiblesView.jsx', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        CollectiblesView: (props) => {
            if (widgetFailure.current === 'collectibles') throw new Error('collectibles grid failed');
            return React.createElement(actual.CollectiblesView, props);
        },
    };
});
// One object for every render, as the real context provides: HomeTabs reads
// settings through useSettings, whose effects key on the messaging identity,
// so a fresh object per render re-runs them forever.
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => {
    return { useMessaging: () => ({ messaging: messagingHarness.current, shell: 'web' }) };
});
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: () => new Set(),
}));
vi.mock('@xchain-wallet/core/flows', () => ({
    isDemoWallet: (walletId) => walletId === 'demo-wallet',
    synthesizeDemoHistory: () => [],
    synthesizeDemoDefiPositions: () => [],
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { useTablistKeys } from '../../../packages/core/src/shared/keyboard/useTablistKeys.js';

const chainRegistry = {
    byCoin: () => [],
    get: (chainId) => (chainId === 'bitcoin-mainnet'
        ? { id: chainId, coin: 'bitcoin', displayName: 'Bitcoin', networkKind: 'mainnet' }
        : null),
    all: () => [],
};

function mount(walletId, overrides = {}) {
    return render(
        <TablistKeyboard>
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={{}}
                walletId={walletId}
                networkFilter="all"
                coinFamilies={[]}
                onNetworkFilterChange={() => {}}
                onTokenQueryChange={() => {}}
                {...overrides}
            />
        </TablistKeyboard>,
    );
}

function TablistKeyboard({ children }) {
    useTablistKeys();
    return children;
}

beforeEach(() => {
    messagingHarness.current = {};
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener('error', preventExpectedError);
});

afterEach(() => {
    widgetFailure.current = null;
    cleanup();
    window.removeEventListener('error', preventExpectedError);
    consoleError.mockRestore();
});

describe('HomeTabs empty states', () => {
    it('wires the selected wallet tab to the only visible panel', () => {
        mount('real-wallet');

        const coins = screen.getByRole('tab', { name: 'Coins' });
        const nfts = screen.getByRole('tab', { name: 'NFTs' });
        const panel = screen.getByRole('tabpanel', { name: 'Coins' });
        expect(coins).toHaveAttribute('aria-selected', 'true');
        expect(coins).toHaveAttribute('tabindex', '0');
        expect(coins).toHaveAttribute('aria-controls', panel.id);
        expect(panel).toHaveAttribute('aria-labelledby', coins.id);
        expect(nfts).toHaveAttribute('tabindex', '-1');

        coins.focus();
        fireEvent.keyDown(coins, { key: 'ArrowRight' });
        const tokens = screen.getByRole('tab', { name: 'Tokens' });
        expect(document.activeElement).toBe(tokens);
        expect(tokens).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel', { name: 'Tokens' })).toBe(panel);

        fireEvent.click(nfts);

        expect(screen.getByRole('tabpanel', { name: 'NFTs' })).toBe(panel);
        expect(panel).toHaveAttribute('aria-labelledby', nfts.id);
        expect(nfts).toHaveAttribute('tabindex', '0');
        expect(coins).toHaveAttribute('tabindex', '-1');
        expect(screen.queryByText('Fund your wallet')).toBeNull();
    });

    it('shows one actionable first-funding state for an empty wallet', () => {
        const onReceive = vi.fn();
        const onBuy = vi.fn();
        mount('real-wallet', { onReceive, onBuy });

        expect(screen.getByText('Fund your wallet')).toBeTruthy();
        expect(screen.getByText(/Receive coins from another wallet or buy coins/)).toBeTruthy();
        expect(screen.queryByText('No coins yet')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
        fireEvent.click(screen.getByRole('button', { name: 'Buy coins' }));
        expect(onReceive).toHaveBeenCalledTimes(1);
        expect(onBuy).toHaveBeenCalledTimes(1);
    });

    it('starts addressless wallets with address generation instead of a second empty card', () => {
        const onAddAddress = vi.fn();
        mount('real-wallet', { hasAddresses: false, onAddAddress });

        expect(screen.getAllByText('Fund your wallet')).toHaveLength(1);
        expect(screen.queryByText('No coins yet')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Generate an address' }));
        expect(onAddAddress).toHaveBeenCalledTimes(1);
    });

    it('shows a pending-only native balance instead of the first-funding card', () => {
        mount('real-wallet', {
            balances: {
                'bitcoin-mainnet': [{
                    address: 'bc1qpending',
                    balances: {
                        native: {
                            tick: 'BTC', quantity: '0', pendingQuantity: '25000000', divisibility: 8,
                        },
                        tokens: [],
                    },
                }],
            },
        });

        expect(screen.queryByText('Fund your wallet')).toBeNull();
        expect(screen.getByTestId('balance-pending')).toHaveTextContent('0.25000000 pending');
    });

    it('shows only the empty card on an empty NFTs tab', () => {
        mount('real-wallet');
        fireEvent.click(screen.getByRole('tab', { name: 'NFTs' }));

        expect(screen.getByText('No collectibles yet')).toBeTruthy();
        expect(screen.queryByText(/can never be split/i)).toBeNull();
    });

    it('keeps the DeFi tab with its empty state for a real wallet', () => {
        mount('real-wallet');
        fireEvent.click(screen.getByRole('tab', { name: 'DeFi' }));

        expect(screen.getByText('No DeFi positions yet')).toBeTruthy();
    });

    it('keeps recent activity live as a sent transaction fails or confirms', async () => {
        let phase = 'pending';
        const txid = 'activity-tx';
        messagingHarness.current = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                'bitcoin-mainnet': [{ address: 'bc1qsender' }],
            }),
            getAddressHistory: vi.fn(async () => phase === 'confirmed' ? [{
                action: 'SEND',
                action_index: '7',
                block_index: 100,
                timestamp: 1_700_000_000,
                tx_hash: txid,
                status: 'valid',
                details: { source: 'bc1qsender', destination: 'bc1qrecipient', tick: 'BTC', amount: '1' },
            }] : []),
            getPendingTxsForAddress: vi.fn(async () => phase === 'confirmed' ? [] : [{
                id: 'pending-1',
                txid,
                status: phase === 'failed' ? 'failed' : 'broadcast',
                fromAddress: 'bc1qsender',
                toAddress: 'bc1qrecipient',
                action: 'SEND',
                tick: 'BTC',
                amount: '1',
                broadcastAt: new Date().toISOString(),
            }]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 102 }),
        };
        mount('real-wallet');
        fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

        expect(await screen.findByText('Pending')).toBeInTheDocument();

        phase = 'failed';
        document.dispatchEvent(new Event('visibilitychange'));
        expect(await screen.findByText('Failed')).toBeInTheDocument();

        phase = 'confirmed';
        document.dispatchEvent(new Event('visibilitychange'));
        expect(await screen.findByText('Confirmed')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('3 Confirmations')).toBeInTheDocument());
    });

    it('does not justify placeholder body text', () => {
        const rule = tabsCss.match(/\.placeholderBody\s*\{[^}]*\}/)[0];
        expect(rule).not.toMatch(/text-align:\s*justify/);
    });

    it.each([
        ['price ticker', 'ticker', 'Price ticker'],
        ['portfolio chart', 'chart', 'Portfolio chart'],
    ])('keeps Home usable when the %s throws and retries it inline', (_label, failure, recoveredText) => {
        widgetFailure.current = failure;
        mount('real-wallet');

        expect(screen.getByRole('alert')).toHaveTextContent('Could not load this section.');
        expect(screen.getByRole('tablist', { name: 'Wallet view' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();

        widgetFailure.current = null;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(screen.getByText(recoveredText)).toBeInTheDocument();
    });

    it('keeps the NFT tab usable when the collectibles grid throws and retries it inline', () => {
        widgetFailure.current = 'collectibles';
        mount('real-wallet');
        fireEvent.click(screen.getByRole('tab', { name: 'NFTs' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Could not load this section.');
        expect(screen.getByRole('tab', { name: 'Coins' })).toBeInTheDocument();

        widgetFailure.current = null;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(screen.getByText('No collectibles yet')).toBeInTheDocument();
    });
});
