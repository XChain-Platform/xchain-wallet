// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qoracleoracleoracleoracleoracleoraclex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(cleanup);

describe('OracleForm rendering', () => {
    it('shows the publishing identity and seeded quote fields', async () => {
        const oracleFeeds = vi.fn().mockResolvedValue([]);
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            oracleFeeds,
            oracleConsumers: vi.fn().mockResolvedValue({ supported: true, dispensers: [] }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <OracleForm
                    walletId="wallet-1"
                    initialChainId={CHAIN}
                    initialTick="price"
                    onBack={vi.fn()}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('heading', { name: 'My oracle' })).toBeInTheDocument();
        expect(screen.getByLabelText('Publishing address')).toHaveValue(ADDRESS.address);
        expect(screen.getByLabelText('Token ticker')).toHaveValue('PRICE');
        expect(screen.getByLabelText('Currency')).toHaveValue('USD');
        expect(await screen.findByText(/has not published any prices yet/i)).toBeInTheDocument();
        expect(oracleFeeds).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDRESS.address });
    });
});

function mountOracle() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        oracleFeeds: vi.fn().mockResolvedValue([]),
        oracleConsumers: vi.fn().mockResolvedValue({ supported: true, dispensers: [] }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <OracleForm walletId="wallet-1" initialChainId={CHAIN} onBack={vi.fn()} />
        </MessagingProvider>,
    );
}

const tipText = (name) => {
    const tip = screen.getByRole('button', { name });
    return document.getElementById(tip.getAttribute('aria-describedby')).textContent;
};

describe('OracleForm fields follow the form rulings', () => {
    it('picks the priced token network with the network picker, not a dropdown', async () => {
        mountOracle();
        const field = await screen.findByRole('button', { name: /^Priced token network: Bitcoin/ });
        expect(screen.queryByRole('combobox', { name: /Priced token network/ })).toBeNull();
        expect(screen.queryByText(/^Cross-chain:/)).toBeNull();

        fireEvent.click(field);
        fireEvent.click(screen.getByRole('button', { name: /^Select Dogecoin\b/ }));

        expect(screen.getByRole('button', { name: /^Priced token network: Dogecoin/ })).toBeInTheDocument();
        expect(screen.getByText('Cross-chain: a BTC transaction publishing the price of a DOGE token.')).toBeInTheDocument();
    });

    it('explains the publishing address and memo in help tips, not in label text', async () => {
        mountOracle();
        expect(await screen.findByLabelText('Publishing address')).toHaveValue(ADDRESS.address);
        expect(screen.queryByText(/this is your oracle's identity/)).toBeNull();
        expect(tipText('About Publishing address')).toMatch(/your oracle's identity/);
        expect(tipText('About Memo')).toBe('A short note recorded on-chain with this price publication.');
    });

    it('moves the decimal-places rule into the price tip and marks the usage fee optional with the pill', async () => {
        mountOracle();
        await screen.findByLabelText('Publishing address');
        expect(screen.queryByText('Up to 8 decimal places.')).toBeNull();
        expect(tipText(/^About Price of one/)).toMatch(/up to 8 decimal places/);
        expect(screen.queryByText(/\(optional\)/)).toBeNull();
        expect(screen.getAllByText('Optional').length).toBeGreaterThanOrEqual(2);
    });
});
