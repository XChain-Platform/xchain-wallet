// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const CHAIN_A = 'bitcoin-mainnet';
const CHAIN_B = 'litecoin-mainnet';
const ADDRESS_A = {
    id: 'address-btc',
    address: 'bc1qbatchsender000000000000000000000000000',
    source: 'hd',
};
const ADDRESS_B = {
    id: 'address-ltc',
    address: 'ltc1qbatchsender00000000000000000000000000',
    source: 'hd',
};

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onChainChange, onPick, lockNetwork }) => (
        <section
            data-testid="own-address-picker"
            data-chain-id={chainId}
            data-lock-network={String(Boolean(lockNetwork))}
        >
            {onChainChange ? <button type="button" onClick={() => onChainChange(CHAIN_B)}>Switch picker network</button> : null}
            <button
                type="button"
                onClick={() => {
                    onChainChange?.(CHAIN_B);
                    onPick(ADDRESS_B);
                }}
            >
                Pick Litecoin source
            </button>
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';

afterEach(() => cleanup());

describe('BatchComposerForm own-address picker', () => {
    it('keeps the cross-chain pick and validates the batch on that chain', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN_A]: [ADDRESS_A],
                [CHAIN_B]: [ADDRESS_B],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            listActions: vi.fn().mockResolvedValue(['BROADCAST']),
            validateAction: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
                tokens: [],
            }),
            buildBatchCommand: vi.fn().mockResolvedValue({
                command: 'BROADCAST|0|1|hello',
                subStrings: ['BROADCAST|0|1|hello'],
            }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BatchComposerForm walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        const field = await screen.findByLabelText('From');
        expect(field).toHaveValue(ADDRESS_A.address);
        expect(field).toHaveAttribute('readonly');
        expect(screen.queryByRole('combobox', { name: 'From' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Choose from address' }));
        expect(screen.getByTestId('own-address-picker')).toHaveAttribute('data-chain-id', CHAIN_A);
        expect(screen.getByRole('button', { name: 'Switch picker network' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Pick Litecoin source' }));

        expect(await screen.findByLabelText('From')).toHaveValue(ADDRESS_B.address);
        expect(screen.getByRole('button', { name: /^Network:/ })).toHaveTextContent('Litecoin');
        expect(screen.queryByRole('switch', { name: /Pay protocol fee in/ })).toBeNull();
        fireEvent.change(screen.getByRole('combobox', { name: 'Action' }), {
            target: { value: 'BROADCAST' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

        await waitFor(() => expect(messaging.validateAction).toHaveBeenCalledWith({
            chainId: CHAIN_B,
            action: 'BROADCAST',
            params: { VERSION: '0' },
        }));
        await waitFor(() => expect(messaging.buildBatchCommand).toHaveBeenCalledWith({
            chainId: CHAIN_B,
            subActions: [{ action: 'BROADCAST', params: { VERSION: '0' } }],
        }));
        expect(await screen.findByText('BROADCAST|0|1|hello')).toBeTruthy();
    });
});
