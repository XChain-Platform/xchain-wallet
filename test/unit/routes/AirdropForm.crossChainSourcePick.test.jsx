// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const CHAIN_A = 'bitcoin-mainnet';
const CHAIN_B = 'litecoin-mainnet';
const SOURCE_A = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const SOURCE_B = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';
const RECORD_B = {
    id: 'addr-ltc',
    address: SOURCE_B,
    publicKey: '02cd',
    derivationPath: "m/84'/2'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

vi.mock('../../../packages/core/src/shared/routes/AddressList.jsx', () => ({
    AddressList: ({ onPick }) => (
        <button type="button" onClick={() => onPick(RECORD_B, CHAIN_B)}>
            Pick Litecoin source
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const ADDRESSES = {
    [CHAIN_A]: [{
        id: 'addr-btc',
        address: SOURCE_A,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    }],
    [CHAIN_B]: [RECORD_B],
};

function mountAirdrop() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue(null),
        getHoldersForToken: vi.fn().mockResolvedValue({ total: 0, data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN_A]: [{
                address: SOURCE_A,
                balances: { native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] },
            }],
            [CHAIN_B]: [{
                address: SOURCE_B,
                balances: { native: { tick: 'LTC', quantity: '100000000', divisibility: 8 }, tokens: [] },
            }],
        }),
        searchTokens: vi.fn().mockResolvedValue([]),
        getListsForSource: vi.fn().mockResolvedValue([]),
    };

    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AirdropForm walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('AirdropForm cross-chain source picker', () => {
    it('switches Network and keeps the picked source address', async () => {
        mountAirdrop();
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(SOURCE_A));

        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick Litecoin source' }));

        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(SOURCE_B));
        expect(screen.getByRole('button', { name: /^Network:/ })).toHaveTextContent('Litecoin');
        expect(screen.queryByText(/No address on this network/i)).toBeNull();
    });
});
