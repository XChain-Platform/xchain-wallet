// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyBets } from '../../../packages/core/src/shared/routes/MyBets.jsx';
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

        expect(screen.getByRole('heading', { name: 'Send' })).toBeInTheDocument();
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

        expect(screen.getByRole('heading', { name: 'New stake' })).toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: /Validator staking/ })).toBeDisabled();
        unmount();

        renderRoute(StakeNew, {
            getAddressesByChain: vi.fn().mockRejectedValue(new Error('Networks unavailable.')),
        }, props);

        expect(await screen.findByText('Networks unavailable.')).toBeInTheDocument();
    });
});

describe('MyBets render', () => {
    const props = {
        walletId: 'wallet-1',
        accountId: 'account-1',
        onBack: vi.fn(),
        onOpenMarket: vi.fn(),
    };

    it('renders loading and main states', async () => {
        const addresses = deferred();
        renderRoute(MyBets, {
            getAddressesByChain: vi.fn(() => addresses.promise),
            bets: vi.fn().mockResolvedValue([{
                action_index: 9,
                feed_action_index: 7,
                bet_status: 'open',
                outcome: 0,
                amount: '12',
                tick: 'XCHAIN',
            }]),
        }, props);

        expect(screen.getByText('Loading bets…')).toBeInTheDocument();

        await act(async () => {
            addresses.resolve({ 'bitcoin-mainnet': [{ address: 'bc1qbettor' }] });
            await addresses.promise;
        });

        expect(await screen.findByText('Market #7')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Pending resolution' })).toBeInTheDocument();
        expect(screen.getByText('from bc1qbettor')).toBeInTheDocument();
    });

    it('renders empty and error states', async () => {
        const { unmount } = renderRoute(MyBets, {
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            bets: vi.fn(),
        }, props);

        expect(await screen.findByText('No bets yet')).toBeInTheDocument();
        unmount();

        renderRoute(MyBets, {
            getAddressesByChain: vi.fn().mockRejectedValue(new Error('Bet history unavailable.')),
            bets: vi.fn(),
        }, props);

        expect(await screen.findByText('Bet history unavailable.')).toBeInTheDocument();
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

        expect(await screen.findByText('Example market')).toBeInTheDocument();
        expect(screen.getByText('Markets opened')).toBeInTheDocument();
        expect(screen.getByText('Fees earned')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('renders empty and error states', async () => {
        const { unmount } = renderRoute(OracleRecord, {
            betOracle: vi.fn().mockResolvedValue({}),
            betFeeds: vi.fn().mockResolvedValue([]),
        }, props);

        expect(await screen.findByText('No settlement fees yet')).toBeInTheDocument();
        expect(screen.getByText('No markets yet')).toBeInTheDocument();
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

        expect(await screen.findByRole('button', { name: /Primary wallet BIP39/ })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('button', { name: 'Manage wallet' })).toBeInTheDocument();
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
