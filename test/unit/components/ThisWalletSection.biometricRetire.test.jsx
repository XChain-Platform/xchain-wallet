// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A password change retires the biometric enrolment, because the enrolment
// wraps the unlock password as it was on the day of enrolment. Left in place
// it unlocks nothing ("Incorrect password") and keeps the old password wrapped
// on the device. The disable button used to be the only caller of the clear.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThisWalletSection } from '../../../packages/core/src/shared/components/settings/ThisWalletSection.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import {
    setBiometricProvider,
    retireBiometricAfterPasswordChange,
} from '../../../packages/core/src/flows/biometricUnlock.js';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,eA==') } }));

const ACTIVE_WALLET = { id: 'wallet-active', name: 'Active Wallet', format: 'bip39' };
const ACTIVE_ACCOUNT = { id: 'account-2', name: 'Savings', index: 2 };

/** A provider whose enrolment is a flag; `clearFails` leaves it in place. */
function fakeProvider({ registered = true, clearFails = false } = {}) {
    const state = { registered };
    const provider = {
        name: 'fake',
        isSupported: async () => true,
        isRegistered: () => state.registered,
        register: vi.fn(async () => { state.registered = true; }),
        unlock: vi.fn(async () => 'wrapped-password'),
        clear: vi.fn(async () => {
            if (clearFails) throw new Error('keystore busy');
            state.registered = false;
        }),
    };
    setBiometricProvider(provider);
    return { provider, state };
}

function mount(messaging) {
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <ToastHost>
                <ThisWalletSection activeWallet={ACTIVE_WALLET} activeAccount={ACTIVE_ACCOUNT} />
            </ToastHost>
        </MessagingContext.Provider>,
    );
}

function changePassword() {
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    fireEvent.change(screen.getByLabelText('Current wallet password'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('New wallet password'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new wallet password'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

afterEach(() => {
    cleanup();
    setBiometricProvider(null);
    vi.restoreAllMocks();
});

describe('password change retires the biometric enrolment', () => {
    it('clears it when the unlock password changed, and says so', async () => {
        const { provider, state } = fakeProvider();
        mount({ changePassword: vi.fn(async () => ({ changed: true, vaultRekeyed: true })) });

        changePassword();

        expect(await screen.findByText(/Biometric unlock was turned off/)).toBeInTheDocument();
        expect(provider.clear).toHaveBeenCalledTimes(1);
        expect(state.registered).toBe(false);
    });

    it('clears it when the host does not say which password changed', async () => {
        const { provider } = fakeProvider();
        mount({ changePassword: vi.fn(async () => ({ changed: true })) });

        changePassword();

        expect(await screen.findByText(/Biometric unlock was turned off/)).toBeInTheDocument();
        expect(provider.clear).toHaveBeenCalledTimes(1);
    });

    it('keeps it when only a wallet with its own password changed', async () => {
        const { provider, state } = fakeProvider();
        mount({ changePassword: vi.fn(async () => ({ changed: true, vaultRekeyed: false })) });

        changePassword();

        expect(await screen.findByText('Wallet password changed.')).toBeInTheDocument();
        expect(provider.clear).not.toHaveBeenCalled();
        expect(state.registered).toBe(true);
    });

    it('keeps it when the change itself failed', async () => {
        const { provider, state } = fakeProvider();
        const authError = Object.assign(new Error('cipher detail'), { name: 'InvalidPasswordError' });
        mount({ changePassword: vi.fn(async () => { throw authError; }) });

        changePassword();

        expect(await screen.findByText('Current wallet password is incorrect.')).toBeInTheDocument();
        expect(provider.clear).not.toHaveBeenCalled();
        expect(state.registered).toBe(true);
    });

    it('shows an error when the enrolment could not be cleared', async () => {
        fakeProvider({ clearFails: true });
        mount({ changePassword: vi.fn(async () => ({ changed: true, vaultRekeyed: true })) });

        changePassword();

        expect(await screen.findByText(/biometric unlock could not be turned off/)).toBeInTheDocument();
    });

    it('says nothing about biometrics when none was enrolled', async () => {
        const { provider } = fakeProvider({ registered: false });
        mount({ changePassword: vi.fn(async () => ({ changed: true, vaultRekeyed: true })) });

        changePassword();

        expect(await screen.findByText('Wallet password changed.')).toBeInTheDocument();
        expect(provider.clear).not.toHaveBeenCalled();
    });
});

describe('retireBiometricAfterPasswordChange', () => {
    it('throws when the provider reports the enrolment still present after clearing', async () => {
        const { provider } = fakeProvider();
        provider.clear.mockImplementation(async () => {});
        await expect(retireBiometricAfterPasswordChange({ vaultRekeyed: true })).rejects.toThrow(/still present/);
    });

    it('returns whether an enrolment was cleared', async () => {
        fakeProvider();
        await expect(retireBiometricAfterPasswordChange({ vaultRekeyed: true })).resolves.toBe(true);
        await expect(retireBiometricAfterPasswordChange({ vaultRekeyed: true })).resolves.toBe(false);
    });
});
