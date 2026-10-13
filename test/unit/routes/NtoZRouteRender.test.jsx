// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SendPicker } from '../../../packages/core/src/shared/routes/SendPicker.jsx';
import { StakeNew } from '../../../packages/core/src/shared/routes/StakeNew.jsx';

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

        const sendBitcoin = await screen.findByRole('button', { name: 'Open Bitcoin details' });
        fireEvent.click(sendBitcoin);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-mainnet',
            tick: 'BTC',
        }));
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
});
