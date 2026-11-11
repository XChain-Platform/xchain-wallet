// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const CHAIN_A = 'bitcoin-mainnet';
const CHAIN_B = 'bitcoin-testnet';
const ADDRESS_A = {
    id: 'address-mainnet',
    address: 'bc1qcosigner00000000000000000000000000000',
    publicKey: `02${'a'.repeat(64)}`,
    derivationPath: "m/84'/0'/0'/0/0",
};
const ADDRESS_B = {
    id: 'address-testnet',
    address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    publicKey: `02${'b'.repeat(64)}`,
    derivationPath: "m/84'/1'/0'/0/0",
};

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onChainChange, onPick, lockNetwork }) => (
        <section data-testid="own-address-picker" data-chain-id={chainId} data-lock-network={String(Boolean(lockNetwork))}>
            <button
                type="button"
                onClick={() => {
                    onChainChange?.(CHAIN_B);
                    onPick(ADDRESS_B);
                }}
            >
                Pick testnet key
            </button>
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerProvision } from '../../../packages/core/src/shared/routes/CoSignerProvision.jsx';

afterEach(() => cleanup());

describe('CoSignerProvision own-address picker', () => {
    it('keeps the cross-chain key in the review payload', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN_A]: [ADDRESS_A],
                [CHAIN_B]: [ADDRESS_B],
            }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <CoSignerProvision walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        const field = await screen.findByLabelText("This wallet's key");
        expect(field).toHaveValue('');
        expect(field).toHaveAttribute('readonly');
        expect(field).toHaveAttribute('placeholder', 'Select address');
        expect(screen.queryByRole('combobox', { name: "This wallet's key" })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: "Choose this wallet's key" }));
        expect(screen.getByTestId('own-address-picker')).toHaveAttribute('data-chain-id', CHAIN_A);
        fireEvent.click(screen.getByRole('button', { name: 'Pick testnet key' }));

        expect(await screen.findByLabelText("This wallet's key")).toHaveValue(ADDRESS_B.address);
        expect(screen.getByRole('button', { name: /^Network:/ }).querySelector('img')?.getAttribute('src'))
            .toContain('bitcoin-testnet');
        fireEvent.change(screen.getByLabelText('Agent public key'), {
            target: { value: `03${'c'.repeat(64)}` },
        });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Send' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Create agent account' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Create agent account' }));

        expect(await screen.findByRole('heading', { name: 'Review agent account' })).toBeTruthy();
        expect(screen.getByLabelText(ADDRESS_B.address)).toBeTruthy();
        expect(screen.getByText(ADDRESS_B.publicKey)).toBeTruthy();
    });
});
