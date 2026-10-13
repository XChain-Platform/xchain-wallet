// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const nextPaint = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../../packages/core/src/shared/utils/nextPaint.js', () => ({ nextPaint }));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import {
    BiometricCancelledError,
    BiometricNotRegisteredError,
    clearDemoWalletId,
    clearLockoutState,
    getLockoutState,
    recordLockoutFailure,
    setBiometricProvider,
} from '../../../packages/core/src/flows/index.js';

function provider(overrides = {}) {
    return {
        name: 'lock-screen-test',
        isSupported: vi.fn(async () => true),
        isRegistered: vi.fn(() => true),
        register: vi.fn(async () => {}),
        unlock: vi.fn(async () => 'wallet password'),
        clear: vi.fn(),
        ...overrides,
    };
}

function mount(activeProvider) {
    setBiometricProvider(activeProvider);
    const onUnlocked = vi.fn();
    const messaging = {
        unlockWallet: vi.fn(async () => ({})),
        capturePassphrase: vi.fn(async () => ({ stored: true })),
    };
    render(
        <MessagingProvider shell="popup" messaging={messaging}>
            <Locked onUnlocked={onUnlocked} />
        </MessagingProvider>,
    );
    return { messaging, onUnlocked };
}

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
    nextPaint.mockClear();
});

afterEach(() => {
    cleanup();
    clearLockoutState();
    setBiometricProvider(null);
});

describe('Locked biometric unlock', () => {
    it('focuses the password field when the lock screen mounts', async () => {
        mount(provider({ isRegistered: vi.fn(() => false) }));

        await waitFor(() => expect(screen.getByLabelText('Password')).toHaveFocus());
    });

    it('shows the button only when a credential is enrolled and available', async () => {
        const unavailable = provider({ isSupported: vi.fn(async () => false) });
        mount(unavailable);
        await waitFor(() => expect(unavailable.isSupported).toHaveBeenCalledOnce());
        expect(screen.queryByRole('button', { name: 'Use biometrics' })).toBeNull();

        cleanup();
        const notEnrolled = provider({ isRegistered: vi.fn(() => false) });
        mount(notEnrolled);
        expect(screen.queryByRole('button', { name: 'Use biometrics' })).toBeNull();
        expect(notEnrolled.isSupported).not.toHaveBeenCalled();

        cleanup();
        const ready = provider();
        mount(ready);
        expect(await screen.findByRole('button', { name: 'Use biometrics' })).toBeEnabled();
    });

    it('re-checks enrollment after the asynchronous availability probe', async () => {
        let enrolled = true;
        const activeProvider = provider({
            isSupported: vi.fn(async () => {
                enrolled = false;
                return true;
            }),
            isRegistered: vi.fn(() => enrolled),
        });
        mount(activeProvider);

        await waitFor(() => expect(activeProvider.isSupported).toHaveBeenCalledOnce());
        expect(screen.queryByRole('button', { name: 'Use biometrics' })).toBeNull();
    });

    it('returns quietly when the biometric prompt is cancelled', async () => {
        const activeProvider = provider({
            unlock: vi.fn(async () => { throw new BiometricCancelledError(); }),
        });
        const { messaging } = mount(activeProvider);
        const button = await screen.findByRole('button', { name: 'Use biometrics' });

        fireEvent.click(button);

        await waitFor(() => expect(button).toBeEnabled());
        expect(messaging.unlockWallet).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toMatch(/prompt cancelled|unlock failed/i);
        expect(getLockoutState().failedAttempts).toBe(0);
    });

    it('hides a stale button and advises password re-enrolment', async () => {
        const activeProvider = provider({
            unlock: vi.fn(async () => { throw new BiometricNotRegisteredError(); }),
        });
        const { messaging } = mount(activeProvider);
        fireEvent.click(await screen.findByRole('button', { name: 'Use biometrics' }));

        expect(await screen.findByText(/unlock with your password, then re-enrol it in Settings/i))
            .toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Use biometrics' })).toBeNull();
        expect(messaging.unlockWallet).not.toHaveBeenCalled();
        expect(getLockoutState().failedAttempts).toBe(0);
    });

    it('does not let biometric unlock bypass an active password lockout', async () => {
        recordLockoutFailure();
        recordLockoutFailure();
        recordLockoutFailure();
        const activeProvider = provider();
        const { messaging } = mount(activeProvider);
        const button = await screen.findByRole('button', { name: 'Use biometrics' });

        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(activeProvider.unlock).not.toHaveBeenCalled();
        expect(messaging.unlockWallet).not.toHaveBeenCalled();
    });

    it('clears prior failed-password attempts after biometric success', async () => {
        recordLockoutFailure();
        recordLockoutFailure();
        const activeProvider = provider();
        const { messaging, onUnlocked } = mount(activeProvider);
        fireEvent.click(await screen.findByRole('button', { name: 'Use biometrics' }));

        await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
        expect(messaging.unlockWallet).toHaveBeenCalledWith('wallet password');
        expect(getLockoutState().failedAttempts).toBe(0);
    });
});
