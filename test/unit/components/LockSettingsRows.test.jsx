// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const biometric = vi.hoisted(() => ({
    registered: false,
    describe: vi.fn(),
    register: vi.fn(),
    clear: vi.fn(),
}));
const duress = vi.hoisted(() => ({
    configured: false,
    set: vi.fn(),
    clear: vi.fn(),
}));
const panic = vi.hoisted(() => ({
    active: false,
    activate: vi.fn(),
    deactivate: vi.fn(),
}));
const messaging = vi.hoisted(() => ({ unlockWallet: vi.fn() }));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging }),
}));
vi.mock('../../../packages/core/src/flows/biometricUnlock.js', () => ({
    describeBiometric: biometric.describe,
    isBiometricRegistered: () => biometric.registered,
    registerBiometricCredential: biometric.register,
    clearBiometricCredential: biometric.clear,
}));
vi.mock('../../../packages/core/src/flows/duressPassphrase.js', () => ({
    isDuressConfigured: () => duress.configured,
    setDuressPassphrase: duress.set,
    clearDuressPassphrase: duress.clear,
}));
vi.mock('../../../packages/core/src/flows/panicMode.js', () => ({
    activatePanicMode: panic.activate,
    deactivatePanicMode: panic.deactivate,
    getPanicModeState: () => (panic.active
        ? { active: true, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }
        : { active: false, expiresAt: 0 }),
    getPanicRemainingMs: (state) => (state?.active ? 24 * 60 * 60 * 1000 : 0),
}));

const { BiometricRow } = await import(
    '../../../packages/core/src/shared/components/settings/BiometricRow.jsx'
);
const { DuressPassphraseRow } = await import(
    '../../../packages/core/src/shared/components/settings/DuressPassphraseRow.jsx'
);
const { PanicModeRow } = await import(
    '../../../packages/core/src/shared/components/settings/PanicModeRow.jsx'
);

function invalidPassword() {
    return Object.assign(new Error('invalid'), { name: 'InvalidPasswordError' });
}

beforeEach(() => {
    biometric.registered = false;
    biometric.describe.mockReset().mockResolvedValue({
        supported: true,
        reason: null,
        mechanism: 'device unlock',
        wrapNote: 'The password stays protected.',
    });
    biometric.register.mockReset().mockImplementation(async () => {
        biometric.registered = true;
    });
    biometric.clear.mockReset().mockImplementation(() => {
        biometric.registered = false;
    });
    duress.configured = false;
    duress.set.mockReset().mockImplementation(() => {
        duress.configured = true;
    });
    duress.clear.mockReset().mockImplementation(() => {
        duress.configured = false;
    });
    panic.active = false;
    panic.activate.mockReset().mockImplementation(() => {
        panic.active = true;
        return { active: true, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
    });
    panic.deactivate.mockReset().mockImplementation(() => {
        panic.active = false;
    });
    messaging.unlockWallet.mockReset().mockResolvedValue({ unlocked: true });
});

afterEach(() => cleanup());

describe('BiometricRow', () => {
    it('verifies the wallet password before enrolling', async () => {
        messaging.unlockWallet.mockRejectedValueOnce(invalidPassword());
        render(<BiometricRow />);

        fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

        expect(await screen.findByText('Incorrect wallet password.')).toBeTruthy();
        expect(biometric.register).not.toHaveBeenCalled();
    });

    it('keeps enrolment failures retryable without discarding the password', async () => {
        biometric.register
            .mockRejectedValueOnce(new Error('Sensor unavailable.'))
            .mockImplementationOnce(async () => { biometric.registered = true; });
        render(<BiometricRow />);

        fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'correct' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

        expect(await screen.findByText('Sensor unavailable.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByText(/Enabled\. Use device unlock/)).toBeTruthy();
        expect(messaging.unlockWallet).toHaveBeenCalledTimes(2);
    });

    it('offers re-enrolment and reports a disable that did not clear the credential', async () => {
        biometric.registered = true;
        biometric.clear.mockImplementation(() => {});
        render(<BiometricRow />);

        expect(await screen.findByRole('button', { name: 'Re-enrol' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Re-enrol' }));
        expect(screen.getByText('Re-enrol biometric unlock')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
        expect(await screen.findByText('Biometric unlock could not be disabled.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });
});

describe('DuressPassphraseRow', () => {
    function openAndFill({ current, pass, confirm = pass }) {
        fireEvent.click(screen.getByRole('button', { name: 'Set' }));
        fireEvent.change(screen.getByLabelText('Current wallet password'), { target: { value: current } });
        fireEvent.change(screen.getByLabelText('Duress passphrase'), { target: { value: pass } });
        fireEvent.change(screen.getByLabelText('Confirm duress passphrase'), { target: { value: confirm } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    }

    it('rejects a duress passphrase that equals the wallet password', async () => {
        render(<DuressPassphraseRow />);
        openAndFill({ current: 'same-secret', pass: 'same-secret' });

        expect(await screen.findByText(/must differ from your wallet password/)).toBeTruthy();
        expect(messaging.unlockWallet).not.toHaveBeenCalled();
        expect(duress.set).not.toHaveBeenCalled();
    });

    it('requires a verified current password before saving a different passphrase', async () => {
        messaging.unlockWallet.mockRejectedValueOnce(invalidPassword());
        render(<DuressPassphraseRow />);
        openAndFill({ current: 'wrong', pass: 'emergency-only' });

        expect(await screen.findByText('Current wallet password is incorrect.')).toBeTruthy();
        expect(duress.set).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Current wallet password'), { target: { value: 'correct' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText(/Configured\. Entering this passphrase/)).toBeTruthy();
        expect(duress.set).toHaveBeenCalledWith('emergency-only');
    });
});

describe('PanicModeRow', () => {
    it('requires an explicit confirmation before activating the freeze', () => {
        render(<PanicModeRow />);

        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
        expect(panic.activate).not.toHaveBeenCalled();
        expect(screen.getByText('Confirm panic mode')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Confirm 24-hour freeze' }));
        expect(panic.activate).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Panic mode is active')).toBeTruthy();
    });
});
