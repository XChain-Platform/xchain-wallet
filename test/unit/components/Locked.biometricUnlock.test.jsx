// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const nextPaint = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../../packages/core/src/shared/utils/nextPaint.js', () => ({ nextPaint }));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import {
    BIOMETRIC_CANCELLED_DETAIL,
    BiometricNotRegisteredError,
    clearDemoWalletId,
    clearLockoutState,
    getLockoutState,
    recordLockoutFailure,
    setBiometricProvider,
} from '../../../packages/core/src/flows/index.js';
import {
    installNativeBiometricProvider,
    nativeBiometricProvider,
} from '../../../packages/web/src/storage/nativeBiometricProvider.js';
import { __setNativeVaultForTests } from '../../../packages/web/src/storage/nativeVault.js';

const RETRY_EXHAUSTED_DETAIL = 'biometric authentication failed repeatedly';

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

function nativeVault(unlockReply) {
    return {
        loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
        biometricStatus: vi.fn(async () => ({
            status: 'OK',
            available: true,
            enrolled: true,
            reasonCode: 'ok',
            mechanism: 'your fingerprint',
        })),
        biometricEnroll: vi.fn(async () => ({ status: 'OK' })),
        biometricUnlock: vi.fn(async () => unlockReply),
        biometricClear: vi.fn(async () => ({ status: 'OK' })),
    };
}

async function mountNative(unlockReply) {
    const plugin = nativeVault(unlockReply);
    __setNativeVaultForTests(plugin);
    await installNativeBiometricProvider();
    return { plugin, ...mount(nativeBiometricProvider) };
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
    __setNativeVaultForTests(undefined);
});

describe('Locked biometric unlock', () => {
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

    it('returns to the working password field when the native prompt is cancelled', async () => {
        const { plugin, messaging } = await mountNative({
            status: 'LOCKED',
            detail: BIOMETRIC_CANCELLED_DETAIL,
        });
        const button = await screen.findByRole('button', { name: 'Use biometrics' });
        const password = screen.getByLabelText('Password');

        fireEvent.change(password, { target: { value: 'typed password' } });
        password.blur();

        fireEvent.click(button);

        await waitFor(() => expect(document.activeElement).toBe(password));
        expect(button).toBeEnabled();
        expect(plugin.biometricUnlock).toHaveBeenCalledOnce();
        expect(messaging.unlockWallet).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toMatch(/prompt cancelled|unlock failed/i);
        expect(getLockoutState().failedAttempts).toBe(0);

        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await waitFor(() => expect(messaging.unlockWallet).toHaveBeenCalledWith('typed password'));
    });

    it('explains retry exhaustion returned by the mocked native plugin', async () => {
        const { messaging } = await mountNative({
            status: 'LOCKED',
            detail: RETRY_EXHAUSTED_DETAIL,
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Use biometrics' }));

        expect(await screen.findByText(/did not recognize you after several attempts/i))
            .toBeTruthy();
        expect(screen.getByText(/unlock with your wallet password/i)).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/not supported|failed repeatedly/i);
        expect(messaging.unlockWallet).not.toHaveBeenCalled();
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

    it('labels the native fallback and says which wallet is being unlocked', () => {
        const repo = process.cwd();
        const android = readFileSync(join(repo, 'packages', 'mobile', 'android', 'app', 'src',
            'main', 'java', 'io', 'xchain', 'wallet', 'android', 'vault',
            'VaultBiometricSidecar.java'), 'utf8');
        const iosSidecar = readFileSync(join(repo, 'packages', 'mobile', 'ios', 'App', 'App',
            'vault', 'VaultBiometricSidecar.swift'), 'utf8');
        const iosPlugin = readFileSync(join(repo, 'packages', 'mobile', 'ios', 'App', 'App',
            'vault', 'XChainVaultPlugin.swift'), 'utf8');

        expect(android).toContain('"Unlock XChain Wallet",');
        expect(android).toContain('"Use your fingerprint or face to unlock XChain Wallet"');
        expect(android).toContain('.setNegativeButtonText("Use wallet password")');
        expect(iosPlugin).toContain('sidecar.unlock(reason: "Unlock your XChain Wallet")');
        expect(iosSidecar).toContain('context.localizedCancelTitle = "Use Wallet Password"');
    });
});
