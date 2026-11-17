// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import { OracleRecord } from '../../../packages/core/src/shared/routes/OracleRecord.jsx';
import { SendPicker } from '../../../packages/core/src/shared/routes/SendPicker.jsx';
import { StakeNew } from '../../../packages/core/src/shared/routes/StakeNew.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function renderRoute(Component, messaging, props) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Component {...props} />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

describe('SendPicker render', () => {
    it('shows its heading and loading state before offering a held asset to send', async () => {
        const balances = deferred();
        const onSelect = vi.fn();
        renderRoute(SendPicker, {
            getSettings: vi.fn().mockResolvedValue({}),
            getWalletBalances: vi.fn(() => balances.promise),
        }, {
            walletId: 'wallet-1',
            onBack: vi.fn(),
            onSelect,
        });

        // Send's Asset field opens this page, so it is titled Asset (G60).
        expect(screen.getByRole('heading', { name: 'Asset' })).toBeInTheDocument();
        expect(screen.getByRole('status', { name: 'Loading balances' })).toBeInTheDocument();

        await act(async () => {
            balances.resolve({
                'bitcoin-mainnet': [{
                    address: 'bc1qexample',
                    balances: {
                        native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                        tokens: [],
                    },
                }],
            });
            await balances.promise;
        });

        const sendBitcoin = await screen.findByRole('button', { name: /^Select Bitcoin\b/ });
        fireEvent.click(sendBitcoin);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-mainnet',
            tick: 'BTC',
        }));
    });

    it('renders empty and error states', async () => {
        const { unmount } = renderRoute(SendPicker, {
            getSettings: vi.fn().mockResolvedValue({}),
            getWalletBalances: vi.fn().mockResolvedValue({}),
        }, {
            walletId: 'wallet-1',
            onBack: vi.fn(),
            onSelect: vi.fn(),
        });

        expect(await screen.findByText('Nothing to send yet')).toBeInTheDocument();
        unmount();

        renderRoute(SendPicker, {
            getSettings: vi.fn().mockResolvedValue({}),
            getWalletBalances: vi.fn().mockRejectedValue(new Error('Balances unavailable.')),
        }, {
            walletId: 'wallet-1',
            onBack: vi.fn(),
            onSelect: vi.fn(),
        });

        expect(await screen.findByText('Balances unavailable.')).toBeInTheDocument();
    });
});

describe('StakeNew render', () => {
    it('shows its heading and loading state before offering validator staking', async () => {
        const addresses = deferred();
        const onPickValidator = vi.fn();
        renderRoute(StakeNew, {
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn(() => addresses.promise),
        }, {
            walletId: 'wallet-1',
            onBack: vi.fn(),
            onPickValidator,
            onPickContract: vi.fn(),
        });

        expect(screen.getByRole('heading', { name: 'New Stake' })).toBeInTheDocument();
        expect(screen.getByText('Loading…')).toBeInTheDocument();

        await act(async () => {
            addresses.resolve({ 'bitcoin-mainnet': [{ address: 'bc1qexample' }] });
            await addresses.promise;
        });

        const validator = await screen.findByRole('button', { name: /Validator staking/ });
        expect(validator).toBeEnabled();
        fireEvent.click(validator);
        expect(onPickValidator).toHaveBeenCalledWith('bitcoin-mainnet');
    });

    it('renders empty and error states', async () => {
        const props = {
            walletId: 'wallet-1',
            onBack: vi.fn(),
            onPickValidator: vi.fn(),
            onPickContract: vi.fn(),
        };
        const { unmount } = renderRoute(StakeNew, {
            getAddressesByChain: vi.fn().mockResolvedValue({}),
        }, props);

        expect(await screen.findByText(/Use Receive on a Bitcoin network/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Validator staking/ })).toHaveAttribute('aria-disabled', 'true');
        unmount();

        renderRoute(StakeNew, {
            getAddressesByChain: vi.fn().mockRejectedValue(new Error('Networks unavailable.')),
        }, props);

        expect(await screen.findByText(/Couldn.t load your staking networks/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });
});

// My bets is a tab of Bet Markets (the my-bets route opens the list on it).
describe('Bet Markets My bets tab render', () => {
    const props = {
        walletId: 'wallet-1',
        view: 'bets',
        onBack: vi.fn(),
        onOpenMarket: vi.fn(),
    };

    // My bets is the All list narrowed to the markets bet in (ruling
    // 2026-11-13): one market the wallet bet in, one it did not.
    const MARKETS = [
        { action_index: 7, label: 'Will it rain?', outcomes: 'Yes,No', tick: 'XCHAIN', feed_status: 'open', source: 'bc1qoracle' },
        { action_index: 8, label: 'Will it snow?', outcomes: 'Yes,No', tick: 'XCHAIN', feed_status: 'open', source: 'bc1qoracle' },
    ];

    it('renders loading and main states', async () => {
        const addresses = deferred();
        renderRoute(BetFeedsList, {
            getAddressesByChain: vi.fn(() => addresses.promise),
            betFeeds: vi.fn().mockResolvedValue({ data: MARKETS }),
            bets: vi.fn().mockResolvedValue([{
                action_index: 9,
                feed_action_index: 7,
                bet_status: 'open',
                outcome: 0,
                amount: '12',
                tick: 'XCHAIN',
            }]),
        }, props);

        expect(screen.getByRole('status', { name: 'Loading betting addresses' })).toBeInTheDocument();

        await act(async () => {
            addresses.resolve({ 'bitcoin-mainnet': [{ address: 'bc1qbettor' }] });
            await addresses.promise;
        });

        expect(screen.getByRole('tab', { name: 'My bets' })).toHaveAttribute('aria-selected', 'true');
        const card = await screen.findByRole('button', { name: 'Will it rain?' });
        expect(screen.queryByRole('button', { name: 'Will it snow?' })).toBeNull();
        expect(card).toHaveTextContent('You bet 12 XCHAIN');
        fireEvent.click(card);
        expect(props.onOpenMarket).toHaveBeenCalledWith('bitcoin-mainnet', 7);
    });

    it('renders empty and error states', async () => {
        const { unmount } = renderRoute(BetFeedsList, {
            getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ address: 'bc1qbettor' }] }),
            betFeeds: vi.fn().mockResolvedValue({ data: MARKETS }),
            bets: vi.fn().mockResolvedValue([]),
        }, props);

        expect(await screen.findByText('No bets yet')).toBeInTheDocument();
        unmount();

        renderRoute(BetFeedsList, {
            getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ address: 'bc1qbettor' }] }),
            betFeeds: vi.fn().mockResolvedValue({ data: MARKETS }),
            bets: vi.fn().mockRejectedValue(new Error('Bet history unavailable.')),
        }, props);

        // Raw load errors are replaced with plain recovery copy and a retry action.
        expect(await screen.findByText('Could not load bets for any of your addresses.')).toBeInTheDocument();
        expect(screen.queryByText('Bet history unavailable.')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });
});

describe('OracleRecord render', () => {
    const props = {
        chainId: 'bitcoin-mainnet',
        address: 'bc1qoracle',
        onBack: vi.fn(),
        onOpenMarket: vi.fn(),
    };

    it('renders loading and main states', async () => {
        const record = deferred();
        renderRoute(OracleRecord, {
            betOracle: vi.fn(() => record.promise),
            betFeeds: vi.fn().mockResolvedValue([{
                action_index: 21,
                label: 'Example market',
                tick: 'XCHAIN',
                feed_status: 'open',
            }]),
        }, props);

        expect(screen.getByText('Loading record…')).toBeInTheDocument();

        await act(async () => {
            record.resolve({
                total_feeds: 2,
                active_feeds: 1,
                counts: { resolved: 1 },
                fees_earned: [{ tick: 'XCHAIN', amount: '4' }],
            });
            await record.promise;
        });

        // Actions opens first (G102); the market rows are on Markets.
        expect(await screen.findByRole('list', { name: 'Oracle actions' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /Markets/ }));
        expect(await screen.findByText('Example market')).toBeInTheDocument();
        // Only the chosen tab renders: the counts and fees are on Details.
        expect(screen.queryByText('Markets opened')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        expect(screen.getByText('Markets opened')).toBeInTheDocument();
        expect(screen.getByText('Fees earned')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('renders empty and error states', async () => {
        const { unmount } = renderRoute(OracleRecord, {
            betOracle: vi.fn().mockResolvedValue({}),
            betFeeds: vi.fn().mockResolvedValue([]),
        }, props);

        // Actions is the first tab and Markets the next; the fees sit under Details.
        fireEvent.click(await screen.findByRole('tab', { name: /Markets/ }));
        expect(await screen.findByText('No markets yet')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        expect(await screen.findByText('No settlement fees yet')).toBeInTheDocument();
        unmount();

        renderRoute(OracleRecord, {
            betOracle: vi.fn().mockRejectedValue(new Error('Oracle record unavailable.')),
            betFeeds: vi.fn().mockResolvedValue([]),
        }, props);

        expect(await screen.findByText('Oracle record unavailable.')).toBeInTheDocument();
    });
});

describe('WalletPicker render', () => {
    const props = {
        activeWalletId: 'wallet-1',
        onSwitch: vi.fn(),
        onAddWallet: vi.fn(),
        onShowDetails: vi.fn(),
        onBack: vi.fn(),
    };

    it('renders loading and main states', async () => {
        const wallets = deferred();
        renderRoute(WalletPicker, {
            listWallets: vi.fn(() => wallets.promise),
        }, props);

        expect(screen.getByText('Loading…')).toBeInTheDocument();

        await act(async () => {
            wallets.resolve([{ id: 'wallet-1', name: 'Primary wallet', format: 'bip39' }]);
            await wallets.promise;
        });

        // One list card: a row opens that wallet's page; there is no Manage wallet button.
        const row = await screen.findByRole('button', { name: /Primary wallet/ });
        expect(row).toHaveAttribute('aria-current', 'true');
        expect(screen.queryByRole('button', { name: 'Manage Wallet' })).toBeNull();
        fireEvent.click(row);
        expect(props.onShowDetails).toHaveBeenCalledWith('wallet-1');
    });

    it('renders empty and error states', async () => {
        const { unmount } = renderRoute(WalletPicker, {
            listWallets: vi.fn().mockResolvedValue([]),
        }, props);

        expect(await screen.findByText('No wallets yet')).toBeInTheDocument();
        unmount();

        renderRoute(WalletPicker, {
            listWallets: vi.fn().mockRejectedValue(new Error('Wallet list unavailable.')),
        }, props);

        expect(await screen.findByText('Wallet list unavailable.')).toBeInTheDocument();
    });
});
