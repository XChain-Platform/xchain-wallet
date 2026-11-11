// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerProvision } from '../../../packages/core/src/shared/routes/CoSignerProvision.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ onPick }) => (
        <button type="button" onClick={() => onPick({ id: 'address-1' })}>Pick wallet key</button>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const WALLET_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const AGENT_KEY = `03${'b'.repeat(64)}`;

function pending() {
    return new Promise(() => {});
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function addresses(id) {
    return {
        [CHAIN]: [{
            id,
            address: WALLET_ADDRESS,
            publicKey: `02${'a'.repeat(64)}`,
            derivationPath: "m/84'/0'/0'/0/0",
        }],
    };
}

function mount(getAddressesByChain) {
    render(
        <MessagingProvider shell="web" messaging={{ getAddressesByChain }}>
            <CoSignerProvision walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

function pickWalletKey() {
    fireEvent.click(screen.getByRole('button', { name: "Choose this wallet's key" }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick wallet key' }));
}

afterEach(() => cleanup());

describe('CoSignerProvision states', () => {
    it('shows loading while wallet addresses resolve', () => {
        mount(vi.fn(() => pending()));

        expect(screen.getByRole('heading', { name: 'New agent account' })).toBeInTheDocument();
        expect(screen.getByText(/Loading wallet/)).toBeInTheDocument();
        expect(screen.queryByLabelText("This wallet's key")).toBeNull();
    });

    it('explains how to leave the empty-wallet state', async () => {
        mount(vi.fn().mockResolvedValue({}));

        expect(await screen.findByText(/Use Receive on a BTC network/)).toBeInTheDocument();
        expect(screen.queryByText(/Loading wallet/)).toBeNull();
    });

    it('shows wallet address failures', async () => {
        mount(vi.fn().mockRejectedValue(new Error('Wallet unavailable')));

        expect(await screen.findByText('Wallet unavailable')).toBeInTheDocument();
        expect(screen.queryByLabelText("This wallet's key")).toBeNull();
    });

    it('renders a synchronous address-loader failure', async () => {
        mount(vi.fn(() => { throw new Error('Address bridge unavailable'); }));

        expect(await screen.findByText('Address bridge unavailable')).toBeInTheDocument();
    });

    it('renders the provisioning form when a Bitcoin address is available', async () => {
        mount(vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'address-1',
                address: 'bc1qexampleexampleexampleexampleexampleex',
                publicKey: `02${'a'.repeat(64)}`,
                derivationPath: "m/84'/0'/0'/0/0",
            }],
        }));

        expect(await screen.findByLabelText("This wallet's key")).toBeInTheDocument();
        expect(screen.queryByText('How agent accounts work')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: "About This wallet's key" }));
        expect(screen.getByRole('tooltip')).toHaveTextContent('shares a 2-of-2 Bitcoin address');
        expect(screen.getByRole('button', { name: 'About Agent public key' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Account name' })).toBeInTheDocument();
        const create = screen.getByRole('button', { name: 'Create agent account' });
        expect(create).toBeDisabled();
        expect(create).toHaveClass(buttonStyles.success);
        expect(create.querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Network' })).toBeInTheDocument();
    });

    it('validates policy addresses before review with plain copy', async () => {
        mount(vi.fn().mockResolvedValue(addresses('address-1')));

        await screen.findByLabelText("This wallet's key");
        pickWalletKey();
        fireEvent.change(screen.getByLabelText('Agent public key'), {
            target: { value: AGENT_KEY },
        });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Send' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
        fireEvent.change(screen.getByLabelText('Address 1'), { target: { value: 'not-an-address' } });

        expect(await screen.findByText('Allowed recipient 1: This is not a valid address.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create agent account' })).toBeDisabled();
        expect(screen.queryByRole('heading', { name: 'Review agent account' })).toBeNull();
    });

    it('reviews the exact payload, and Back keeps every form value', async () => {
        const provisionCoSignerAccount = vi.fn().mockResolvedValue({
            id: 'account-1',
            walletId: 'wallet-1',
            chainId: CHAIN,
            name: 'Treasury agent',
            aggregateAddress: 'bc1paggregate',
        });
        render(
            <MessagingProvider shell="web" messaging={{
                getAddressesByChain: vi.fn().mockResolvedValue(addresses('address-1')),
                provisionCoSignerAccount,
            }}>
                <CoSignerProvision walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        await screen.findByLabelText("This wallet's key");
        pickWalletKey();
        fireEvent.change(screen.getByLabelText('Agent public key'), {
            target: { value: AGENT_KEY.toUpperCase() },
        });
        fireEvent.change(screen.getByLabelText('Account name'), { target: { value: '  Treasury agent  ' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Send' }));
        fireEvent.click(screen.getByRole('button', { name: 'Create agent account' }));

        expect(await screen.findByRole('heading', { name: 'Review agent account' })).toBeInTheDocument();
        const reviewedCreate = screen.getByRole('button', { name: 'Create agent account' });
        expect(reviewedCreate).toHaveClass(buttonStyles.success);
        expect(reviewedCreate.querySelector('svg')).not.toBeNull();
        expect(screen.getByText('Treasury agent')).toBeInTheDocument();
        expect(screen.getByText(AGENT_KEY)).toBeInTheDocument();
        expect(screen.getByText('["SEND"]')).toBeInTheDocument();
        expect(screen.getAllByText('No limit')).toHaveLength(4);
        expect(screen.queryByText('null')).toBeNull();
        expect(screen.getByText('[]')).toBeInTheDocument();
        expect(provisionCoSignerAccount).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Back to form' }));
        expect(await screen.findByLabelText("This wallet's key")).toHaveValue(WALLET_ADDRESS);
        expect(screen.getByLabelText('Agent public key')).toHaveValue(AGENT_KEY.toUpperCase());
        expect(screen.getByLabelText('Account name')).toHaveValue('  Treasury agent  ');
        expect(screen.getByRole('checkbox', { name: 'Send' })).toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: 'Create agent account' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create agent account' }));
        await waitFor(() => expect(provisionCoSignerAccount).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            chainId: CHAIN,
            agentPubkey: AGENT_KEY,
            daemonPubkey: `02${'a'.repeat(64)}`,
            daemonDerivationPath: "m/84'/0'/0'/0/0",
            policy: {
                allowedActions: ['SEND'],
                allowedDestinations: null,
                maxPerAction: null,
                maxPerWindow: null,
                confirmAbove: null,
            },
            allowedOutputs: [],
            name: 'Treasury agent',
        }));
    });

    it('refuses an agent key that is any key of this wallet, whatever its parity byte', async () => {
        const otherKey = 'c'.repeat(64);
        mount(vi.fn().mockResolvedValue({
            [CHAIN]: [
                { ...addresses('address-1')[CHAIN][0] },
                {
                    id: 'address-2',
                    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
                    publicKey: '02' + otherKey,
                    derivationPath: "m/84'/0'/0'/0/1",
                },
            ],
        }));

        await screen.findByLabelText("This wallet's key");
        pickWalletKey();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Send' }));
        for (const key of ['02' + otherKey, '03' + otherKey]) {
            fireEvent.change(screen.getByLabelText('Agent public key'), {
                target: { value: key },
            });
            expect(await screen.findByText('The agent key must differ from every key in this wallet.')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Create agent account' })).toBeDisabled();
        }
        fireEvent.change(screen.getByLabelText('Agent public key'), {
            target: { value: AGENT_KEY },
        });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Create agent account' })).toBeEnabled());
    });

    it('filters developer errors from provisioning', async () => {
        const provisionCoSignerAccount = vi.fn().mockRejectedValue(
            new Error('provisionCoSignerAccount: sdkRegistry is required'),
        );
        render(
            <MessagingProvider shell="web" messaging={{
                getAddressesByChain: vi.fn().mockResolvedValue(addresses('address-1')),
                provisionCoSignerAccount,
            }}>
                <CoSignerProvision walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        await screen.findByLabelText("This wallet's key");
        pickWalletKey();
        fireEvent.change(screen.getByLabelText('Agent public key'), {
            target: { value: AGENT_KEY },
        });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Send' }));
        fireEvent.click(screen.getByRole('button', { name: 'Create agent account' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create agent account' }));

        expect(await screen.findByText('Failed to create the agent account.')).toBeInTheDocument();
        expect(screen.queryByText(/provisionCoSignerAccount:/)).toBeNull();
    });

    it('abandons a pending provision and resets the form when the wallet changes', async () => {
        const secondLoad = deferred();
        const provision = deferred();
        const getAddressesByChain = vi.fn((walletId) => walletId === 'wallet-1'
            ? Promise.resolve(addresses('address-1'))
            : secondLoad.promise);
        const provisionCoSignerAccount = vi.fn(() => provision.promise);
        const messaging = { getAddressesByChain, provisionCoSignerAccount };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <CoSignerProvision walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        await screen.findByLabelText("This wallet's key");
        pickWalletKey();
        fireEvent.change(screen.getByLabelText('Agent public key'), {
            target: { value: AGENT_KEY },
        });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Send' }));
        const review = screen.getByRole('button', { name: 'Create agent account' });
        await waitFor(() => expect(review).not.toBeDisabled());
        fireEvent.click(review);
        fireEvent.click(await screen.findByRole('button', { name: 'Create agent account' }));
        await waitFor(() => expect(provisionCoSignerAccount).toHaveBeenCalledTimes(1));

        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <CoSignerProvision walletId="wallet-2" onBack={() => {}} />
            </MessagingProvider>,
        );
        expect(screen.getByText(/Loading wallet/)).toBeInTheDocument();

        await act(async () => secondLoad.resolve(addresses('address-2')));
        expect(await screen.findByLabelText("This wallet's key")).toHaveValue('');
        expect(screen.getByLabelText('Agent public key')).toHaveValue('');

        await act(async () => provision.resolve({
            id: 'old-account',
            name: 'Old wallet result',
            aggregateAddress: 'bc1pold',
        }));
        expect(screen.queryByText('Agent account created')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create agent account' })).toBeDisabled();
    });
});

// The load error, the loading line and the created-account panel lay out
// through the FormPage template like the compose and review stages, so no
// state draws straight into the bare Screen.
describe('CoSignerProvision lays out every state through FormPage', () => {
    it('shows the address-load error as the FormPage status', async () => {
        const { container } = render(
            <MessagingProvider shell="web" messaging={{
                getAddressesByChain: vi.fn().mockRejectedValue(new Error('Wallet unavailable')),
            }}>
                <CoSignerProvision walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        const message = await screen.findByText('Wallet unavailable');
        const status = message.closest('[data-form-status]');
        expect(status).not.toBeNull();
        expect(container.querySelector('form')).not.toBeNull();
    });

    it('puts the loading line inside the FormPage form', () => {
        mount(vi.fn(() => pending()));

        expect(screen.getByText(/Loading wallet/).closest('form')).not.toBeNull();
    });

    it('puts the created-account panel and its action inside the FormPage form', async () => {
        const provisionCoSignerAccount = vi.fn().mockResolvedValue({
            id: 'account-1',
            walletId: 'wallet-1',
            chainId: CHAIN,
            name: 'Treasury agent',
            aggregateAddress: 'bc1paggregate',
        });
        render(
            <MessagingProvider shell="web" messaging={{
                getAddressesByChain: vi.fn().mockResolvedValue(addresses('address-1')),
                provisionCoSignerAccount,
            }}>
                <CoSignerProvision walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        await screen.findByLabelText("This wallet's key");
        pickWalletKey();
        fireEvent.change(screen.getByLabelText('Agent public key'), {
            target: { value: AGENT_KEY },
        });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Send' }));
        fireEvent.click(screen.getByRole('button', { name: 'Create agent account' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create agent account' }));

        const title = await screen.findByText('Agent account created');
        const form = title.closest('form');
        expect(form).not.toBeNull();
        expect(form).toHaveTextContent('Treasury agent');
        expect(form).toHaveTextContent('Fund this address');
        expect(form.contains(screen.getByRole('button', { name: 'Done' }))).toBe(true);
        const done = screen.getByRole('button', { name: 'Done' });
        expect(done).toHaveClass(buttonStyles.success);
        expect(done.querySelector('svg')).not.toBeNull();
    });
});
