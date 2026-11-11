// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SignCredentials } from '../../../packages/core/src/shared/components/SignCredentials.jsx';
import { AddAccountForm } from '../../../packages/core/src/shared/routes/AddAccountForm.jsx';
import { AddAddressModal } from '../../../packages/core/src/shared/routes/AddAddressModal.jsx';

vi.mock('../../../packages/core/src/shared/routes/SignerSelectForm.jsx', () => ({
    SignerSelectForm: () => null,
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function messaging(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({
            schemaVersion: 1,
            activeNetwork: 'regtest',
            fees: {},
        }),
        getSupportedAddressTypes: vi.fn().mockResolvedValue({ supported: ['p2wpkh'] }),
        listAccounts: vi.fn().mockResolvedValue([]),
        createAccount: vi.fn().mockResolvedValue(undefined),
        generateDispenserAddress: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

// The tip is never the field's description; a length counter (U56) may be.
function describedByOtherThanCounter(field) {
    return (field.getAttribute('aria-describedby') || '').split(' ').filter((id) => id && !id.endsWith('-counter'));
}

function expectHelpTip({ label, copy, field }) {
    const trigger = screen.getByRole('button', { name: `About ${label}` });
    expect(describedByOtherThanCounter(field)).toEqual([]);
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent(copy);
    expect(describedByOtherThanCounter(field)).toEqual([]);
}

describe('route field help tips', () => {
    it('shows help for the network used to generate addresses', async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <AddAddressModal
                    walletId="wallet-1"
                    accountId="account-1"
                    chainIds={[]}
                    onClose={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('button', { name: 'About Coin' })).toBeInTheDocument();
    });

    it('keeps the account name explanation in its help tip', async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <AddAccountForm walletId="wallet-1" onBack={() => {}} onCreated={() => {}} />
            </MessagingProvider>,
        );

        const field = screen.getByLabelText('Account name', { selector: 'input' });
        expectHelpTip({
            label: 'Account name',
            copy: 'Names a separate set of addresses in this wallet.',
            field,
        });
    });

    it('keeps the dispenser purpose explanation in its help tip', async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <AddAddressModal
                    walletId="wallet-1"
                    accountId="account-1"
                    chainIds={[]}
                    onClose={() => {}}
                />
            </MessagingProvider>,
        );

        const field = await screen.findByLabelText('Purpose', { selector: 'select' });
        fireEvent.change(field, { target: { value: 'dispenser' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'About Purpose' })).toBeTruthy());
        expectHelpTip({
            label: 'Purpose',
            copy: 'Listed under Misc on the Addresses page and offered when opening a dispenser.',
            field,
        });
    });

    it('keeps the signing password explanation in its help tip', () => {
        render(
            <SignCredentials
                unlocked={false}
                fromAddress={{ address: 'bc1qexample', source: 'hd' }}
                chainId="bitcoin-mainnet"
                password=""
            />,
        );

        const field = screen.getByLabelText('Password', { selector: 'input' });
        expectHelpTip({ label: 'Password', copy: 'Required to sign.', field });
    });
});
