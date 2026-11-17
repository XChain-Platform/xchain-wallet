// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Receive's amount field uses the shared AmountField, so its fiat swap toggle
// is the same small size as on Send (a Receive-only CSS rule once forced it to
// the medium button size). Generate new address opens the same Add Addresses
// page the Addresses plus button opens, and Back returns to Receive.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: () => {}, dismissToast: () => {}, clearToasts: () => {} }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useFiatRate: () => ({ rate: 50000, fiatCurrency: 'USD' }),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') },
}));

const { Receive } = await import('../../../packages/core/src/shared/routes/Receive.jsx');
const { AmountField } = await import('../../../packages/core/src/shared/components/AmountField.jsx');

const ADDRESS = {
    id: 'address-1',
    address: 'bcrt1qnewaddress',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

const SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: {
        'bitcoin-regtest': { strategy: 'normal' },
        'litecoin-regtest': { strategy: 'normal' },
    },
};

function renderReceive() {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-regtest': [ADDRESS] }),
        getNewestAddress: vi.fn().mockResolvedValue(ADDRESS),
        generateReceiveAddress: vi.fn().mockResolvedValue(ADDRESS),
        listWallets: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive walletId="wallet-1" accountId="account-1" />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => cleanup());

describe('Receive amount field and New address', () => {
    it('draws the fiat toggle with the shared AmountField sizing class', async () => {
        const reference = render(
            <AmountField
                amount=""
                fiatAmount=""
                tick="BTC"
                fiatRate={{ rate: 50000 }}
                fiatCurrency="USD"
                amountInputMode="coin"
                divisibility={8}
                onAmountFieldChange={() => {}}
                toggleAmountInputMode={() => {}}
            />,
        );
        const sharedClass = reference.container.querySelector('button[aria-pressed]')?.className;
        reference.unmount();
        expect(sharedClass).toBeTruthy();

        renderReceive();
        const toggle = await screen.findByRole('button', { name: /^Switch input to/ });
        expect(toggle.className).toBe(sharedClass);
        expect(toggle.closest('[class*="amountFooter"]')).not.toBeNull();
    });

    it('opens the Add Addresses page from Generate new address and Back returns to Receive', async () => {
        const messaging = renderReceive();
        fireEvent.click(await screen.findByRole('button', { name: /Generate new address/ }));

        expect(await screen.findByTestId('add-address-generate')).toBeInTheDocument();
        expect(messaging.generateReceiveAddress).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
        await waitFor(() => expect(screen.queryByTestId('add-address-generate')).toBeNull());
        expect(await screen.findByRole('button', { name: /Generate new address/ })).toBeInTheDocument();
    });
});
