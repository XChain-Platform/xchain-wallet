// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CrossChainSwapForm's "Choose source address" icon opened the shared
// OwnAddressPickerScreen with a `chainId` prop that was never declared in
// this file (the form only holds `giveChainId` / `getChainId`), so the
// picker threw a ReferenceError on open. The source address is spent on the
// give chain, so the picker seeds to `giveChainId`.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

// The real picker is the whole AddressList screen. Stubbed to a single span
// carrying the chainId prop so this stays about which chain the form hands
// the picker, not about AddressList's own rendering.
vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ title, chainId }) => React.createElement(
        'div',
        null,
        React.createElement('h1', null, title),
        React.createElement('span', { 'data-testid': 'picker-chain' }, chainId),
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';

const DOGE = 'dogecoin-mainnet';
const BTC = 'bitcoin-mainnet';

const DOGE_ADDRESS = { id: 'addr-doge-0', address: 'DExampleDogeAddressxxxxxxxxxxxxxxxx', publicKey: '02aabbcc', derivationPath: "m/44'/3'/0'/0/0", source: 'hd' };
const BTC_ADDRESS = { id: 'addr-btc-0', address: 'bc1qexampleexampleexampleexampleexampleex', publicKey: '02ddeeff', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' };

function mount() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: vi.fn().mockResolvedValue(BTC_ADDRESS),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(CrossChainSwapForm, { walletId: 'w', onBack() {} }),
        ),
    );
    return messaging;
}

const pickerButton = () => screen.getByRole('button', { name: 'Choose source address' });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CrossChainSwapForm: source address picker', () => {
    it('opens on the give chain, not the get chain', async () => {
        mount();
        await waitFor(() => expect(pickerButton()).toBeInTheDocument());

        fireEvent.click(pickerButton());

        expect(await screen.findByText('From address')).toBeInTheDocument();
        expect(screen.getByTestId('picker-chain').textContent).toBe(DOGE);
        expect(screen.getByTestId('picker-chain').textContent).not.toBe(BTC);
    });
});
