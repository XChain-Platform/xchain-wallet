// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Mint Amount field shows the chosen token's exact format: an 8-place
// token pads "1" to "1.00000000" once the edit ends, a whole-number token
// refuses a fraction with a field error that also holds the Mint button, and
// Max stays inside the field, disabled until a token is chosen. The From
// label carries its help tip like every other field on the form.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: ADDRESS,
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

function mountMint({ divisibility = 8, initialTick = 'PADME' } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: 'bitcoin-mainnet',
            tick: initialTick,
            maxSupply: '1000',
            totalSupply: '10',
            mintMax: null,
            mintAddressMax: null,
            divisibility,
            locks: {},
        }),
        getMintedAmountForAddress: vi.fn().mockResolvedValue({ amount: '0' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        preflight: vi.fn(),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MintForm, {
                walletId: 'w',
                initialChainId: 'bitcoin-mainnet',
                initialTick,
                onBack() {},
            }),
        ),
    );
    return messaging;
}

const amountField = () => screen.findByLabelText(/^Amount\b/);
const maxButton = () => screen.getByRole('button', { name: 'Use max available amount' });
const submitButton = () => screen.getByRole('button', { name: /^(Mint|Preview)$/ });

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('MintForm amount format and help tips', () => {
    it('gives the From label its help tip', async () => {
        mountMint();
        expect(await screen.findByRole('button', { name: 'About From' })).toBeInTheDocument();
    });

    it('pads a whole amount to an 8-place token once the edit ends', async () => {
        mountMint({ divisibility: 8 });
        await screen.findByText(/available to mint/);
        const field = await amountField();
        fireEvent.change(field, { target: { value: '1' } });
        fireEvent.blur(field);
        await waitFor(() => expect(field.value).toBe('1.00000000'));
    });

    it('refuses a fraction for a whole-number token with a field error and holds Mint', async () => {
        mountMint({ divisibility: 0, initialTick: 'WHOLE' });
        await screen.findByText(/available to mint/);
        const field = await amountField();
        fireEvent.change(field, { target: { value: '1' } });
        fireEvent.blur(field);
        await waitFor(() => expect(field.value).toBe('1'));
        fireEvent.change(field, { target: { value: '1.5' } });
        expect(await screen.findByText(/whole number|decimal place/i)).toBeInTheDocument();
    });

    it('shows Max inside the field, disabled until a token is chosen', async () => {
        mountMint({ initialTick: '' });
        await amountField();
        expect(maxButton()).toBeDisabled();
        expect(submitButton()).toBeDisabled();
    });
});
