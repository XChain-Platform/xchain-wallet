// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThisWalletSection } from '../../../packages/core/src/shared/components/settings/ThisWalletSection.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';

const { qrToDataURL } = vi.hoisted(() => ({
    qrToDataURL: vi.fn(async () => 'data:image/png;base64,cHVia2V5'),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: qrToDataURL },
}));

const XPUB = `xpub${'A'.repeat(107)}`;
const ACTIVE_WALLET = { id: 'wallet-active', name: 'Active Wallet', format: 'bip39' };
const ACTIVE_ACCOUNT = { id: 'account-2', name: 'Savings', index: 2 };

function mount(messaging, wallet = ACTIVE_WALLET) {
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <ToastHost>
                <ThisWalletSection activeWallet={wallet} activeAccount={ACTIVE_ACCOUNT} />
            </ToastHost>
        </MessagingContext.Provider>,
    );
}

async function submitPassword(value = 'wallet-password') {
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    fireEvent.change(screen.getByLabelText('Confirm wallet password'), {
        target: { value },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show public keys' }));
}

beforeEach(() => {
    qrToDataURL.mockClear();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn(async () => {}) },
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ThisWalletSection password change', () => {
    function fill({ current = 'old-password', next = 'new-password', confirm = next } = {}) {
        fireEvent.change(screen.getByLabelText('Current wallet password'), { target: { value: current } });
        fireEvent.change(screen.getByLabelText('New wallet password'), { target: { value: next } });
        fireEvent.change(screen.getByLabelText('Confirm new wallet password'), { target: { value: confirm } });
    }

    it('shows strength guidance and blocks a mismatched confirmation', () => {
        const messaging = { changePassword: vi.fn() };
        mount(messaging);

        fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
        expect(screen.getByText(/unique, longer password is stronger/i)).toBeInTheDocument();
        fill({ confirm: 'different-password' });

        expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
        expect(messaging.changePassword).not.toHaveBeenCalled();
    });

    it('stays busy during re-encryption and shows a success toast', async () => {
        let finish;
        const messaging = {
            changePassword: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
        };
        mount(messaging);

        fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
        fill();
        fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

        expect(await screen.findByRole('button', { name: 'Changing password…' })).toBeDisabled();
        expect(screen.getByLabelText('Current wallet password')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        expect(messaging.changePassword).toHaveBeenCalledWith({
            walletId: ACTIVE_WALLET.id,
            currentPassword: 'old-password',
            newPassword: 'new-password',
        });

        finish({ changed: true });
        expect(await screen.findByText('Wallet password changed.')).toBeInTheDocument();
    });

    it('reports a wrong current password and keeps the form retryable', async () => {
        const authError = Object.assign(new Error('cipher detail'), { name: 'InvalidPasswordError' });
        const messaging = { changePassword: vi.fn(async () => { throw authError; }) };
        mount(messaging);

        fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
        fill({ current: 'wrong-password' });
        fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

        expect(await screen.findByText('Current wallet password is incorrect.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled();
    });
});

describe('ThisWalletSection extended public key export', () => {
    it('confirms the password, warns about tracking, and offers QR and sensitive copy', async () => {
        const messaging = {
            pairingPayloadRequest: vi.fn(async () => ({
                payload: {
                    keys: [{
                        chainId: 'bitcoin-mainnet',
                        addressType: 'p2wpkh',
                        path: "m/84'/0'/2'",
                        xpub: XPUB,
                    }],
                },
            })),
        };
        mount(messaging);

        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        expect(screen.getByText(/cannot spend funds/i)).toBeInTheDocument();
        expect(screen.getByText(/including future addresses/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show public keys' }));
        expect(screen.getByText('Enter your wallet password.')).toBeInTheDocument();
        expect(messaging.pairingPayloadRequest).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Confirm wallet password'), {
            target: { value: 'wallet-password' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Show public keys' }));

        expect(await screen.findByText(XPUB)).toBeInTheDocument();
        expect(messaging.pairingPayloadRequest).toHaveBeenCalledWith({
            walletId: ACTIVE_WALLET.id,
            password: 'wallet-password',
            accountIndex: ACTIVE_ACCOUNT.index,
            publicExport: true,
        });
        expect(await screen.findByAltText('QR code for bitcoin-mainnet extended public key')).toBeInTheDocument();
        expect(qrToDataURL).toHaveBeenCalledWith(XPUB, expect.any(Object));

        fireEvent.click(screen.getByRole('button', { name: 'Copy extended public key' }));
        await waitFor(() => expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith(XPUB));
    });

    it('reports an incorrect password without retaining it', async () => {
        const authError = Object.assign(new Error('cipher detail'), { name: 'InvalidPasswordError' });
        const messaging = {
            pairingPayloadRequest: vi.fn(async () => { throw authError; }),
        };
        mount(messaging);

        await submitPassword('wrong-password');

        expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
        expect(screen.getByLabelText('Confirm wallet password')).toHaveValue('');
    });

    it('refuses a private extended key returned by the host', async () => {
        const privateKey = `xprv${'A'.repeat(107)}`;
        const messaging = {
            pairingPayloadRequest: vi.fn(async () => ({
                payload: { keys: [{ chainId: 'bitcoin-mainnet', xpub: privateKey }] },
            })),
        };
        mount(messaging);

        await submitPassword();

        expect(await screen.findByText('This wallet returned no valid extended public keys.')).toBeInTheDocument();
        expect(screen.queryByText(privateKey)).not.toBeInTheDocument();
        expect(screen.queryByRole('img', { name: /extended public key/i })).not.toBeInTheDocument();
    });

    it('does not offer an HD export for a private-key-only wallet', () => {
        const messaging = { pairingPayloadRequest: vi.fn() };
        mount(messaging, { id: 'wallet-wif', name: 'Imported key', format: 'wif-only' });

        expect(screen.getByText('Not available for a private-key-only wallet.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Export…' })).not.toBeInTheDocument();
        expect(messaging.pairingPayloadRequest).not.toHaveBeenCalled();
    });
});
