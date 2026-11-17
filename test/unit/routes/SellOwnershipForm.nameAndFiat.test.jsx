// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Sell Ownership: the page title is plain, the token being sold is the first Sale
// field (then the sale method, then how the seller gets paid), and the asking
// price shows its fiat worth in the form and on review.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

// The wallet's own rate hook, so the test controls whether the asset is priceable.
const rates = vi.hoisted(() => ({ coin: null }));
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useTickFiatRate: ({ enabled }) => (enabled && rates.coin
        ? { rate: rates.coin, fiatCurrency: 'USD', source: 'test', fetchedAt: 0 }
        : null),
}));

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qsellersellersellersellersellersellerx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function messagingWith(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn(async ({ tick }) => ({ tick, creator: ADDRESS.address, divisibility: 0 })),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        ...overrides,
    };
}

function mount(messaging) {
    Promise.resolve(messaging.getSettings()).then((settings) => {
        publishWalletModes({
            wallets: [{ id: 'wallet-1', walletMode: settings.walletMode }],
            activeWalletId: 'wallet-1',
        });
    });
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SellOwnershipForm walletId="wallet-1" chainId={CHAIN} tick="alpha" onBack={vi.fn()} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    resetWalletModes();
    __clearTokenInfoCache();
    rates.coin = null;
});

describe('Sell Ownership title and field order', () => {
    it('titles the page just Sell Ownership', async () => {
        mount(messagingWith());
        expect(await screen.findByRole('heading', { name: 'Sell Ownership' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /alpha/i })).not.toBeInTheDocument();
    });

    it('lists the name first, then the sale method, then how the seller is paid', async () => {
        mount(messagingWith());
        const nameField = await screen.findByRole('button', { name: /^Token: alpha/i });
        const via = screen.getByRole('button', { name: /^Sell via/ });
        const paidIn = screen.getByRole('button', { name: /^Get paid in/ });
        const price = screen.getByLabelText(/^Price/);
        const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(before(nameField, via)).toBe(true);
        expect(before(via, paidIn)).toBe(true);
        expect(before(paidIn, price)).toBe(true);
    });

    it('opens the owned-name picker and switches the name', async () => {
        const getOwnedTokens = vi.fn().mockResolvedValue([{ tick: 'ALPHA' }, { tick: 'BETA' }]);
        mount(messagingWith({ getOwnedTokens }));
        fireEvent.click(await screen.findByRole('button', { name: /^Token:/ }));
        expect(await screen.findByRole('heading', { name: 'Token' })).toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: /^Select BETA on Bitcoin/ }));
        expect(await screen.findByRole('button', { name: /^Token: BETA/i })).toBeInTheDocument();
        expect(getOwnedTokens).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDRESS.address });
    });
});

describe('Sell Ownership fiat value', () => {
    it('shows the fiat worth beside the price and on review', async () => {
        rates.coin = 50000;
        mount(messagingWith());
        fireEvent.change(await screen.findByLabelText(/^Price/), { target: { value: '0.5' } });
        expect(await screen.findByTestId('sell-name-price-fiat')).toHaveTextContent('≈ $25,000.00 USD');

        fireEvent.click(screen.getByRole('button', { name: /^List ownership for sale$/i }));
        // Watcher mode keeps the in-page review stage, which carries the value row.
        const valueLabel = await screen.findByText('Price value');
        expect(within(valueLabel.parentElement).getByText('≈ $25,000.00 USD')).toBeInTheDocument();
    });

    it('hides the fiat figure when no rate exists', async () => {
        mount(messagingWith());
        fireEvent.change(await screen.findByLabelText(/^Price/), { target: { value: '0.5' } });
        expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
    });
});
