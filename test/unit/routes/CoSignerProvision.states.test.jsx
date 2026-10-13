// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerProvision } from '../../../packages/core/src/shared/routes/CoSignerProvision.jsx';

const CHAIN = 'bitcoin-mainnet';

function pending() {
    return new Promise(() => {});
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
});
