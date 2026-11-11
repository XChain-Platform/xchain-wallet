// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/routes/AddressList.jsx', () => ({
    AddressList: ({ onPick, networkLocked }) => (
        <div>
            <span data-testid="network-lock">{networkLocked ? 'locked' : 'switchable'}</span>
            <button
                type="button"
                onClick={() => onPick({
                    id: 'litecoin-source',
                    address: 'ltc1qparallelpicker0000000000000000000000',
                    publicKey: '02bb',
                    derivationPath: "m/84'/2'/0'/0/0",
                    source: 'hd',
                }, 'litecoin-mainnet')}
            >
                Pick Litecoin source
            </button>
        </div>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';

const BITCOIN = 'bitcoin-mainnet';
const LITECOIN = 'litecoin-mainnet';
const BTC_ADDRESS = 'bc1qparallelpicker00000000000000000000000';
const LTC_ADDRESS = 'ltc1qparallelpicker0000000000000000000000';
const addresses = {
    [BITCOIN]: [{
        id: 'bitcoin-source', address: BTC_ADDRESS, publicKey: '02aa',
        derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
    }],
    [LITECOIN]: [{
        id: 'litecoin-source', address: LTC_ADDRESS, publicKey: '02bb',
        derivationPath: "m/84'/2'/0'/0/0", source: 'hd',
    }],
};

function mount() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listActions: vi.fn().mockResolvedValue(['SEND']),
        validateAction: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ParallelComposer
                walletId="wallet-1"
                onBack={() => {}}
                initialRows={[{ chainId: BITCOIN, action: 'SEND', params: { VERSION: '0' } }]}
            />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

describe('ParallelComposer own-address picker', () => {
    it('keeps a cross-network pick in its row and review', async () => {
        mount();
        const field = await screen.findByRole('textbox', { name: 'From' });
        expect(field).toHaveAttribute('readonly');
        expect(field).toHaveValue(BTC_ADDRESS);
        expect(screen.queryByRole('combobox', { name: 'From' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Choose from address' }));
        expect(screen.getByTestId('network-lock')).toHaveTextContent('switchable');
        fireEvent.click(screen.getByRole('button', { name: 'Pick Litecoin source' }));

        await waitFor(() => expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue(LTC_ADDRESS));
        expect(screen.getByRole('button', { name: /^Network: Litecoin/ })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Sign and send queue' }));
        const review = await screen.findByRole('form', { name: 'Review parallel actions' });
        expect(review).toHaveTextContent(LTC_ADDRESS.slice(0, 6));
    });
});
