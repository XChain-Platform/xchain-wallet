// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tokens, amounts, the receive address and the allow and block lists of a
// same-chain swap all belong to one network: a list ID names a different list
// on another chain. Switching the network starts those terms over, the way the
// cross-chain form does, so nothing picked on one chain reaches the other's
// review or wire.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button type="button" onClick={() => onSelect({ tick: title.includes('give') ? 'ALPHA' : 'BETA' })}>
            Choose {title}
        </button>
    ),
}));

vi.mock('../../../packages/core/src/shared/components/ListPickerScreen.jsx', () => ({
    ListPickerScreen: ({ title, onSelect }) => (
        <button type="button" onClick={() => onSelect({ actionIndex: '12' })}>
            Pick {title}
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const address = (id, value) => ({
    id, address: value, publicKey: '02ab', derivationPath: "m/44'/0'/0'/0/0", source: 'hd', signerId: 's1',
});
const byChain = {
    [BTC]: [address('btc-a', 'bc1qdevmock02ab')],
    [DOGE]: [address('doge-a', 'Ddevmock02ab')],
};

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function messaging(composeForConfirm) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(byChain),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockImplementation(({ chainId, tick }) => Promise.resolve({ chainId, tick, divisibility: 8 })),
        composeForConfirm,
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

describe('SwapForm network switch', () => {
    it('starts the chain-scoped terms over when the network changes', async () => {
        const composeForConfirm = vi.fn(() => new Promise(() => {}));
        render(
            <MessagingProvider shell="desktop" messaging={messaging(composeForConfirm)}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await screen.findByRole('button', { name: /Get token:/ });
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        fireEvent.change(screen.getByLabelText('Give amount (ALPHA)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Get amount (BETA)'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: /Advanced options/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Set allow-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick Choose allow-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Set block-list' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick Choose block-list' }));
        expect(screen.getByRole('button', { name: 'Allow-list #12' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/Receive at/), { target: { value: 'bc1qdevmockabcdef' } });

        fireEvent.click(screen.getByRole('button', { name: /Give and get network: Bitcoin/ }));
        fireEvent.click(screen.getByRole('option', { name: /Dogecoin/ }));

        await waitFor(() => expect(screen.getByRole('button', { name: /Give token:/ })).toHaveTextContent('Select a token'));
        expect(screen.getByRole('button', { name: /Get token:/ })).toHaveTextContent('Select a token');
        expect(screen.getByLabelText('Give amount')).toHaveValue('');
        expect(screen.getByLabelText('Get amount')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Set allow-list' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Set block-list' })).toBeInTheDocument();
        expect(screen.getByLabelText(/Receive at/)).toHaveValue('');
    });

    it('keeps a seeded give token when the form opens on its chain', async () => {
        render(
            <MessagingProvider shell="desktop" messaging={messaging(vi.fn())}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={DOGE} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await screen.findByRole('button', { name: /Get token:/ });
        expect(screen.getByRole('button', { name: /Give token:/ })).toHaveTextContent('ALPHA');
    });
});
