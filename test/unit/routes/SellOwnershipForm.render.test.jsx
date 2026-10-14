// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qsellersellersellersellersellersellerx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(cleanup);

describe('SellOwnershipForm rendering', () => {
    it('renders both sale choices and updates their selected tabs', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SellOwnershipForm walletId="wallet-1" chainId={CHAIN} tick="alpha" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('heading', { name: 'Sell ALPHA name' })).toBeInTheDocument();
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
});
