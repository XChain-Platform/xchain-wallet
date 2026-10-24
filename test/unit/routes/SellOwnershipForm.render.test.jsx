// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const BTC_TESTNET = 'bitcoin-testnet';
const LTC_CHAIN = 'litecoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qsellersellersellersellersellersellerx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const OTHER_ADDRESS = {
    ...ADDRESS,
    id: 'address-2',
    address: 'bc1qotherwalletotherwalletotherwalletx',
};
const LTC_ADDRESS = {
    ...ADDRESS,
    id: 'address-ltc',
    address: 'ltc1qsellersellersellersellersellerselx',
    derivationPath: "m/84'/2'/0'/0/0",
};

function messagingWith(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn(async ({ tick }) => (
            String(tick).toUpperCase() === 'ALPHA' ? { tick, creator: ADDRESS.address } : { tick, divisibility: 8 }
        )),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        ...overrides,
    };
}

function mount(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SellOwnershipForm
                walletId="wallet-1"
                chainId={CHAIN}
                tick="alpha"
                onBack={vi.fn()}
                {...props}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('SellOwnershipForm rendering', () => {
    it('refuses before review when the issuer is unknown', async () => {
        const composeForConfirm = vi.fn();
        const messaging = messagingWith({
            getTokenInfo: vi.fn().mockResolvedValue({ tick: 'ALPHA', creator: null }),
            composeForConfirm,
        });
        mount(messaging);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        );
        expect(screen.getByRole('button', { name: 'List name for sale' })).toBeDisabled();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('renders both sale choices and updates their selected tabs', async () => {
        mount(messagingWith());

        expect(await screen.findByRole('heading', { name: 'Sell alpha name' })).toBeInTheDocument();
        const openOrder = screen.getByRole('tab', { name: 'Open order' });
        const instantBuy = screen.getByRole('tab', { name: 'Instant buy' });
        expect(openOrder).toHaveAttribute('aria-selected', 'true');

        fireEvent.click(instantBuy);

        expect(instantBuy).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText(/first buyer who pays your price/i)).toBeInTheDocument();

        const nativeCoin = screen.getByRole('tab', { name: 'Native coin (BTC)' });
        const anotherToken = screen.getByRole('tab', { name: 'Another token' });
        expect(nativeCoin).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(anotherToken);
        expect(anotherToken).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: /price token/i })).toBeInTheDocument();
    });

    it('validates the price token, expiration, and memo before review', async () => {
        mount(messagingWith());

        const price = await screen.findByLabelText(/^Price/);
        fireEvent.change(price, { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText(/^Expires after/), { target: { value: 'tomorrow' } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Expiration must be a whole number of blocks.');

        fireEvent.change(screen.getByLabelText(/^Expires after/), { target: { value: '12' } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'bad|memo' } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Memo cannot contain "|" or ";".');

        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('tab', { name: 'Another token' }));
        fireEvent.click(screen.getByRole('button', { name: 'List name for sale' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Select a price token.');
    });

    it('does not review a custom network fee that the builder would drop', async () => {
        mount(messagingWith());
        fireEvent.change(await screen.findByLabelText(/^Price/), { target: { value: '5' } });
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText(/^Custom fee rate/), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'List name for sale' }));

        expect(screen.getByText('Enter a custom fee rate greater than zero.')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Sell alpha name' })).toBeInTheDocument();
    });

    it('rejects an invalid price-token ticker returned by wallet data', async () => {
        mount(messagingWith({
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: ADDRESS.address,
                    balances: {
                        native: { tick: 'BTC', quantity: '1', divisibility: 8 },
                        tokens: [{ tick: 'BAD|TOKEN', quantity: '1', divisibility: 0 }],
                    },
                }],
            }),
        }));
        await screen.findByLabelText(/^Price/);
        fireEvent.click(screen.getByRole('tab', { name: 'Another token' }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose price token' }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select BAD\|TOKEN on Bitcoin/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Price token can only use letters, numbers, dots and',
        );
        expect(screen.getByRole('heading', { name: 'Sell alpha name' })).toBeInTheDocument();
    });

    it('shows price tokens only from the sale network', async () => {
        mount(messagingWith({
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: ADDRESS.address,
                    balances: {
                        native: { tick: 'BTC', quantity: '1', divisibility: 8 },
                        tokens: [{ tick: 'MAINONLY', quantity: '1', divisibility: 0 }],
                    },
                }],
                [BTC_TESTNET]: [{
                    address: 'tb1qothernetwork',
                    balances: {
                        native: { tick: 'BTC', quantity: '1', divisibility: 8 },
                        tokens: [{ tick: 'TESTONLY', quantity: '1', divisibility: 0 }],
                    },
                }],
            }),
        }));
        await screen.findByLabelText(/^Price/);
        fireEvent.click(screen.getByRole('tab', { name: 'Another token' }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose price token' }));

        expect(await screen.findByRole('button', { name: /^Select MAINONLY on Bitcoin/ })).toBeInTheDocument();
        expect(screen.queryByText('TESTONLY')).not.toBeInTheDocument();
    });

    it('shows plain loading, empty, and load-error copy', async () => {
        const pending = new Promise(() => {});
        const { unmount } = mount(messagingWith({ getAddressesByChain: vi.fn(() => pending) }));
        expect(screen.getByText('Loading your addresses.')).toBeInTheDocument();
        unmount();

        mount(messagingWith({ getAddressesByChain: vi.fn().mockResolvedValue({}) }));
        expect(await screen.findByText('No address on this network can sign the sale. Use Receive to create one first.')).toBeInTheDocument();
        cleanup();

        mount(messagingWith({
            getAddressesByChain: vi.fn().mockRejectedValue(new Error('vault_rpc shard=7 exploded')),
        }));
        const message = await screen.findByText('Could not load your addresses. Check your connection and try again.');
        expect(message).not.toHaveTextContent(/vault_rpc|shard/);
    });

    it('never renders an address from the previous wallet while the next wallet loads', async () => {
        const pending = new Promise(() => {});
        const messaging = messagingWith({
            getAddressesByChain: vi.fn((walletId) => (
                walletId === 'wallet-1' ? Promise.resolve({ [CHAIN]: [ADDRESS] }) : pending
            )),
        });
        const view = mount(messaging);
        expect(await screen.findByLabelText(ADDRESS.address)).toBeInTheDocument();

        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <SellOwnershipForm
                    walletId="wallet-2"
                    chainId={CHAIN}
                    tick="alpha"
                    onBack={vi.fn()}
                />
            </MessagingProvider>,
        );

        expect(screen.getByText('Loading your addresses.')).toBeInTheDocument();
        expect(screen.queryByLabelText(ADDRESS.address)).not.toBeInTheDocument();
    });

    it('never renders the previous network source while the selected network loads', async () => {
        const pending = new Promise(() => {});
        const byChain = { [CHAIN]: [ADDRESS], [LTC_CHAIN]: [LTC_ADDRESS] };
        const messaging = messagingWith({
            getAddressesByChain: vi.fn()
                .mockResolvedValueOnce(byChain)
                .mockImplementationOnce(() => pending),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
        });
        mount(messaging);
        expect(await screen.findByLabelText(ADDRESS.address)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Network:/ }));
        fireEvent.click(screen.getByRole('option', { name: /Litecoin/ }));

        expect(screen.getByText('Loading your addresses.')).toBeInTheDocument();
        expect(screen.queryByLabelText(ADDRESS.address)).not.toBeInTheDocument();
    });

    it('reviews the trimmed builder values, keeps form input on Back, and builds those values', async () => {
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({ psbtHex: 'aa00' });
        const messaging = messagingWith({
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            buildActionPsbtRequest,
        });
        mount(messaging);

        fireEvent.change(await screen.findByLabelText(/^Price/), { target: { value: ' 5.00 ' } });
        fireEvent.change(screen.getByLabelText(/^Expires after/), { target: { value: ' 12 ' } });
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: ' note ' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

        const review = await screen.findByRole('form', { name: 'Review ownership sale' });
        expect(within(review).getByText('5.00 BTC')).toBeInTheDocument();
        expect(within(review).getByText('12 blocks')).toBeInTheDocument();
        expect(within(review).getByText('note')).toBeInTheDocument();
        expect(within(review).getByText(/paid in XCHAIN/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByLabelText(/^Price/)).toHaveValue(' 5.00 ');
        expect(screen.getByLabelText(/^Expires after/)).toHaveValue(' 12 ');
        expect(screen.getByLabelText('Memo (optional)')).toHaveValue(' note ');

        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('button', { name: /Create unsigned transaction/ }));
        await waitFor(() => expect(buildActionPsbtRequest).toHaveBeenCalledTimes(1));
        expect(buildActionPsbtRequest.mock.calls[0][0].actionData).toEqual({
            action: 'ORDER',
            params: {
                VERSION: '0',
                GIVE_COIN: 'BTC',
                GIVE_TICK: 'alpha',
                GIVE_OWNERSHIP: '1',
                GET_COIN: 'BTC',
                GET_AMOUNT: '5.00',
                EXPIRATION: '12',
                MEMO: 'note',
            },
        });
    });

    it('turns watcher build failures into plain user copy', async () => {
        const buildActionPsbtRequest = vi.fn().mockRejectedValue(
            new Error('orderAction: params.GET_AMOUNT exploded at backend.host.internal'),
        );
        mount(messagingWith({
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            buildActionPsbtRequest,
        }));
        fireEvent.change(await screen.findByLabelText(/^Price/), { target: { value: '5' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('button', { name: /Create unsigned transaction/ }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/couldn't complete|review|try again/i);
        expect(alert).not.toHaveTextContent(/orderAction|params\.GET_AMOUNT|backend\.host/);
    });
});
