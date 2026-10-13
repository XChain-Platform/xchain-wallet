// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerProvision } from '../../../packages/core/src/shared/routes/CoSignerProvision.jsx';

const CHAIN = 'bitcoin-mainnet';

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
            address: `bc1q${id}`,
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
        expect(screen.getByRole('button', { name: 'Create agent account' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' })).toBeInTheDocument();
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

        fireEvent.change(await screen.findByLabelText("This wallet's key"), {
            target: { value: 'address-1' },
        });
        fireEvent.change(screen.getByLabelText('Agent public key (hex, 33-byte compressed)'), {
            target: { value: `03${'b'.repeat(64)}` },
        });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Send' }));
        const create = screen.getByRole('button', { name: 'Create agent account' });
        await waitFor(() => expect(create).not.toBeDisabled());
        fireEvent.click(create);
        await waitFor(() => expect(provisionCoSignerAccount).toHaveBeenCalledTimes(1));

        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <CoSignerProvision walletId="wallet-2" onBack={() => {}} />
            </MessagingProvider>,
        );
        expect(screen.getByText(/Loading wallet/)).toBeInTheDocument();

        await act(async () => secondLoad.resolve(addresses('address-2')));
        expect(await screen.findByLabelText("This wallet's key")).toHaveValue('');
        expect(screen.getByLabelText('Agent public key (hex, 33-byte compressed)')).toHaveValue('');

        await act(async () => provision.resolve({
            id: 'old-account',
            name: 'Old wallet result',
            aggregateAddress: 'bc1pold',
        }));
        expect(screen.queryByText('Agent account created')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create agent account' })).toBeDisabled();
    });
});
