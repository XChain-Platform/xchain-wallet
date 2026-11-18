// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { networkFeeEditor } from '../../helpers/customNetworkFee.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

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
    // A wallet's mode is published by the shell from the wallet list, not read
    // from settings; the harness publishes the mode the settings mock names.
    Promise.resolve(messaging.getSettings?.()).then((settings) => {
        publishWalletModes({
            wallets: [{ id: 'wallet-1', walletMode: settings?.walletMode || 'full' }],
            activeWalletId: 'wallet-1',
        });
    });
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
    resetWalletModes();
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
        expect(screen.getByRole('button', { name: /^List ownership for sale$/i })).toBeDisabled();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('renders both sale choices and updates the selected one', async () => {
        // The sale choice is the "Sell via" dropdown and the payment asset is
        // the one "Get paid in" picker (the network coin or any token on it).
        mount(messagingWith());

        expect(await screen.findByRole('heading', { name: 'Sell Ownership' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sell via: Exchange' }));
        fireEvent.click(screen.getByRole('option', { name: /^Dispenser/ }));

        expect(screen.getByRole('button', { name: 'Sell via: Dispenser' })).toBeInTheDocument();
        expect(screen.queryByText('Instant buy: a dispenser sells the name to the first buyer who pays your price.'))
            .not.toBeInTheDocument();

        expect(screen.getByRole('button', { name: 'Get paid in: BTC on Bitcoin' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^Get paid in/ }));
        expect(await screen.findByRole('heading', { name: 'Get Paid In' })).toBeInTheDocument();
    });

    it('validates the price token, expiration, and memo before review', async () => {
        mount(messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS], [LTC_CHAIN]: [LTC_ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: ADDRESS.address,
                    balances: {
                        native: { tick: 'BTC', quantity: '1', divisibility: 8 },
                        tokens: [{ tick: 'GOLD', quantity: '5', divisibility: 0 }],
                    },
                }],
            }),
            getTokenInfo: vi.fn(async ({ chainId, tick }) => (
                String(tick).toUpperCase() === 'ALPHA'
                    ? { tick, creator: chainId === LTC_CHAIN ? LTC_ADDRESS.address : ADDRESS.address }
                    : { tick, divisibility: 0 }
            )),
        }));

        const price = await screen.findByLabelText(/^Price/);
        fireEvent.change(price, { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText(/^Expires after/), { target: { value: 'tomorrow' } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Expiration must be a whole number of blocks.');

        fireEvent.change(screen.getByLabelText(/^Expires after/), { target: { value: '12' } });
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'bad|memo' } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Memo cannot contain "|" or ";".');

        // Picking a token and then changing the network clears the token, so
        // the form must refuse to review until a new price token is chosen.
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: /^Get paid in/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select GOLD on Bitcoin/ }));
        expect(await screen.findByRole('button', { name: 'Get paid in: GOLD on Bitcoin' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^From/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Network:/ }));
        fireEvent.click(screen.getByRole('button', { name: /Select Litecoin/ }));
        expect(await screen.findByRole('button', { name: 'Get paid in: Select an asset' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^List ownership for sale$/i }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Select a price token.');
    });

    it('does not review a custom network fee that the builder would drop', async () => {
        mount(messagingWith());
        fireEvent.change(await screen.findByLabelText(/^Price/), { target: { value: '5' } });
        // The fee selector sits in the Fees section, closed on load.
        fireEvent.click(screen.getByRole('button', { name: /^Speed and Fees/ }));
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        // Custom opened the Network fee line's one editor (G113).
        fireEvent.change(networkFeeEditor(), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: /^List ownership for sale$/i }));

        expect(screen.getAllByText('Enter a custom network fee.')).toHaveLength(1);
        expect(screen.getByRole('heading', { name: 'Sell Ownership' })).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: /^Get paid in/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select BAD\|TOKEN on Bitcoin/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Price token can only use letters, numbers, dots and',
        );
        expect(screen.getByRole('heading', { name: 'Sell Ownership' })).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: /^Get paid in/ }));

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
        // The From section labels the field "From address".
        expect(await screen.findByLabelText('From address')).toHaveValue(ADDRESS.address);

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
        expect(screen.queryByLabelText('From address')).not.toBeInTheDocument();
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
        expect(await screen.findByLabelText('From address')).toHaveValue(ADDRESS.address);

        // Network sits in the From section, closed on load.
        fireEvent.click(screen.getByRole('button', { name: /^From/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Network:/ }));
        fireEvent.click(screen.getByRole('button', { name: /Select Litecoin/ }));

        expect(screen.getByText('Loading your addresses.')).toBeInTheDocument();
        expect(screen.queryByLabelText('From address')).not.toBeInTheDocument();
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
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: ' note ' } });
        fireEvent.click(await screen.findByRole('button', { name: /^List ownership for sale$/i }));

        const review = await screen.findByTestId('confirm-modal');
        expect(within(review).getByText('5.00 BTC')).toBeInTheDocument();
        expect(within(review).getByText('12 blocks')).toBeInTheDocument();
        expect(within(review).getByText('note')).toBeInTheDocument();
        expect(within(review).getByTestId('confirm-fee-network')).toBeInTheDocument();
        expect(screen.queryByText('Estimate unavailable')).toBeNull();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByLabelText(/^Price/)).toHaveValue('5');
        expect(screen.getByLabelText(/^Expires after/)).toHaveValue(' 12 ');
        expect(screen.getByLabelText('Memo')).toHaveValue(' note ');

        fireEvent.click(screen.getByRole('button', { name: /^List ownership for sale$/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
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
        fireEvent.click(await screen.findByRole('button', { name: /^List ownership for sale$/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/couldn't complete|review|try again/i);
        expect(alert).not.toHaveTextContent(/orderAction|params\.GET_AMOUNT|backend\.host/);
    });
});
