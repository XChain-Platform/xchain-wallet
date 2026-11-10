// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SignMessageForm } from '../../../packages/core/src/shared/routes/SignMessageForm.jsx';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', async () => {
    const ReactModule = await import('react');
    return {
        OwnAddressPickerScreen: ({ onPick, onBack }) => ReactModule.createElement(
            'div',
            { 'data-testid': 'own-address-picker' },
            ReactModule.createElement('button', {
                type: 'button',
                onClick: () => onPick({
                    id: 'address-2',
                    address: 'bc1qsecond',
                    source: 'hd',
                    derivationPath: "m/84'/0'/0'/0/1",
                }),
            }, 'Pick second address'),
            ReactModule.createElement('button', { type: 'button', onClick: onBack }, 'Back'),
        ),
    };
});

const CHAIN_ID = 'bitcoin-mainnet';
const FIRST = Object.freeze({
    id: 'address-1',
    address: 'bc1qfirst',
    source: 'hd',
    derivationPath: "m/84'/0'/0'/0/0",
});
const SECOND = Object.freeze({
    id: 'address-2',
    address: 'bc1qsecond',
    source: 'hd',
    derivationPath: "m/84'/0'/0'/0/1",
});

function messagingFor({ ready = true, signMessageRequest } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [FIRST, SECOND] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: FIRST }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready }),
        signMessageRequest: signMessageRequest || vi.fn().mockResolvedValue({ signature: 'signed-value' }),
    };
    return new Proxy(target, {
        get(value, property) {
            if (property in value) return value[property];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SignMessageForm walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('SignMessageForm direct signing', () => {
    it('signs without approval, keeps the result on the form, and clears it after an edit', async () => {
        const signMessageRequest = vi.fn().mockResolvedValue({ signature: 'signed-value' });
        mount(messagingFor({ signMessageRequest }));

        const address = await screen.findByLabelText('Address');
        await waitFor(() => expect(address).toHaveValue(FIRST.address));
        await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull());
        expect(address).toHaveAttribute('readonly');
        expect(document.querySelector('select[aria-label="Address"]')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Signature' }))
            .toHaveTextContent('The signature appears here after you sign.');

        fireEvent.click(screen.getByRole('button', { name: 'Choose address' }));
        expect(screen.getByTestId('own-address-picker')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Pick second address' }));
        await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue(SECOND.address));

        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Proof of control' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign message' }));

        await waitFor(() => expect(signMessageRequest).toHaveBeenCalledTimes(1));
        expect(signMessageRequest).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            addressId: SECOND.id,
            password: '',
            message: 'Proof of control',
        });
        expect(screen.queryByTestId('confirm-modal')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Signature' })).toHaveTextContent('signed-value');
        expect(screen.getByRole('button', { name: 'Copy signature' })).toBeInTheDocument();
        expect(screen.getByLabelText('Message')).toHaveValue('Proof of control');

        fireEvent.click(screen.getByRole('button', { name: 'Choose address' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick second address' }));
        expect(screen.getByRole('textbox', { name: 'Signature' }))
            .toHaveTextContent('The signature appears here after you sign.');

        fireEvent.click(screen.getByRole('button', { name: 'Sign message' }));
        await waitFor(() => expect(signMessageRequest).toHaveBeenCalledTimes(2));
        expect(screen.getByRole('textbox', { name: 'Signature' })).toHaveTextContent('signed-value');
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Edited proof' } });
        expect(screen.getByRole('textbox', { name: 'Signature' }))
            .toHaveTextContent('The signature appears here after you sign.');
        expect(screen.queryByRole('button', { name: 'Copy signature' })).toBeNull();
    });

    it('shows and passes the inline password when the signer needs it', async () => {
        const signMessageRequest = vi.fn().mockResolvedValue({ signature: 'locked-signature' });
        mount(messagingFor({ ready: false, signMessageRequest }));

        await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue(FIRST.address));
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Locked proof' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign message' }));

        await waitFor(() => expect(signMessageRequest).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            addressId: FIRST.id,
            password: 'secret',
            message: 'Locked proof',
        }));
        expect(screen.getByRole('textbox', { name: 'Signature' })).toHaveTextContent('locked-signature');
    });

    it('puts a wrong-password failure on the password field and keeps the message', async () => {
        const failure = Object.assign(new Error('bad password'), { name: 'InvalidPasswordError' });
        mount(messagingFor({
            ready: false,
            signMessageRequest: vi.fn().mockRejectedValue(failure),
        }));

        await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue(FIRST.address));
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Keep this message' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign message' }));

        await waitFor(() => expect(screen.getByText('Incorrect password.')).toBeInTheDocument());
        expect(screen.getByLabelText('Password')).toHaveValue('');
        expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Message')).toHaveValue('Keep this message');
    });
});
