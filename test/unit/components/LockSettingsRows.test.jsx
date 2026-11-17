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
    getDuressSaveStatus: () => 'saved',
    retryDuressSave: () => 'saved',
    DURESS_SAVE_UNSAVED: 'unsaved',
    DURESS_SAVE_CLEAR_FAILED: 'clear-failed',
}));
vi.mock('../../../packages/core/src/flows/panicMode.js', () => ({
    activatePanicMode: panic.activate,
    deactivatePanicMode: panic.deactivate,
    getPanicModeState: () => (panic.active
        ? { active: true, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }
        : { active: false, expiresAt: 0 }),
    getPanicRemainingMs: (state) => (state?.active ? 24 * 60 * 60 * 1000 : 0),
    subscribePanicModeSaveStatus: () => () => {},
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
    it('uses style-guide controls without changing accessible names', async () => {
        render(<BiometricRow />);

        const enable = await screen.findByRole('button', { name: 'Enable' });
        // Settings has no grey ghost buttons (operator 2026-11-13).
        expect(enable.className).toMatch(/secondary/);
        expect(enable.style.border).toBe('');
        fireEvent.click(enable);

        const password = screen.getByLabelText('Wallet password');
        expect(password.className).toMatch(/input/);
        expect(password).toHaveAttribute('type', 'password');
    });

    it('verifies the wallet password before enrolling', async () => {
        messaging.unlockWallet.mockRejectedValueOnce(invalidPassword());
        render(<BiometricRow />);

        fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enable Biometric Unlock' }));

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
        fireEvent.click(screen.getByRole('button', { name: 'Enable Biometric Unlock' }));

        expect(await screen.findByText('Sensor unavailable.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
        expect(await screen.findByText(/Enabled\. Use device unlock/)).toBeTruthy();
        expect(messaging.unlockWallet).toHaveBeenCalledTimes(2);
    });

    it('hides biometric provider details behind enrolment copy', async () => {
        biometric.register.mockRejectedValueOnce(
            new Error('biometricUnlock: PRF extension did not return a result'),
        );
        render(<BiometricRow />);

        fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'correct' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enable Biometric Unlock' }));

        expect(await screen.findByText('Biometric enrolment failed.')).toBeTruthy();
        expect(screen.queryByText(/PRF extension/)).toBeNull();
    });

    it('offers re-enrolment and reports a disable that did not clear the credential', async () => {
        biometric.registered = true;
        biometric.clear.mockImplementation(() => {});
        render(<BiometricRow />);

        expect(await screen.findByRole('button', { name: 'Re-Enrol' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Re-Enrol' }));
        expect(screen.getAllByText('Re-Enrol Biometric Unlock').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
        expect(await screen.findByText('Biometric unlock could not be disabled.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
    });

    it('lands its own page straight on the enable form, with no Enable or Cancel step', async () => {
        render(<BiometricRow direct />);

        expect(await screen.findByLabelText('Wallet password')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Enable Biometric Unlock' })).toBeTruthy();
    });
});

describe('DuressPassphraseRow', () => {
    function openAndFill({ current, pass, confirm = pass }) {
        fireEvent.click(screen.getByRole('button', { name: 'Set' }));
        fireEvent.change(screen.getByLabelText('Current wallet password'), { target: { value: current } });
        fireEvent.change(screen.getByLabelText('Duress passphrase'), { target: { value: pass } });
        fireEvent.change(screen.getByLabelText('Confirm duress passphrase'), { target: { value: confirm } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Passphrase' }));
    }

    it('uses style-guide controls without changing accessible names', () => {
        render(<DuressPassphraseRow />);

        const set = screen.getByRole('button', { name: 'Set' });
        expect(set.className).toMatch(/secondary/);
        expect(set.style.border).toBe('');
        fireEvent.click(set);

        for (const name of ['Current wallet password', 'Duress passphrase', 'Confirm duress passphrase']) {
            const input = screen.getByLabelText(name);
            expect(input.className).toMatch(/input/);
            expect(input).toHaveAttribute('type', 'password');
        }
    });

    it('lands its own page straight on the form, with no Set or Cancel step', () => {
        render(<DuressPassphraseRow direct />);

        expect(screen.queryByRole('button', { name: 'Set' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        expect(screen.getByLabelText('Current wallet password')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Save Passphrase' })).toBeTruthy();
    });

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
        fireEvent.click(screen.getByRole('button', { name: 'Save Passphrase' }));
        expect(await screen.findByText(/Configured\. Entering this passphrase/)).toBeTruthy();
        expect(duress.set).toHaveBeenCalledWith('emergency-only');
    });

    it('hides duress storage details behind save copy', async () => {
        duress.set.mockImplementationOnce(() => {
            throw new Error('setDuressPassphrase: local storage write failed');
        });
        render(<DuressPassphraseRow />);
        openAndFill({ current: 'wallet-secret', pass: 'emergency-only' });

        expect(await screen.findByText('Could not save the duress passphrase.')).toBeTruthy();
        expect(screen.queryByText(/setDuressPassphrase/)).toBeNull();
    });
});

describe('PanicModeRow', () => {
    it('requires an explicit confirmation before activating the freeze', () => {
        render(<PanicModeRow />);

        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
        expect(panic.activate).not.toHaveBeenCalled();
        expect(screen.getByText('Confirm panic mode')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Confirm 24-Hour Freeze' }));
        expect(panic.activate).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Panic mode is active')).toBeTruthy();
    });
});
