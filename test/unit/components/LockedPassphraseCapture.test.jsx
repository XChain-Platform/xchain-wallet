// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.6 step 2 on the unlock screen. `onUnlocked` unmounts this screen in
// all three shells, so withholding it IS the mechanism that keeps the
// capture step on screen: every case below is really an assertion about
// whether that callback fired.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    PassphraseMismatchError,
    clearLockoutState,
    getLockoutState,
} from '../../../packages/core/src/flows/index.js';

beforeEach(() => clearLockoutState());
afterEach(() => { cleanup(); clearLockoutState(); });

const COLD = { id: 'w1', name: 'Cold storage' };
const TRAVEL = { id: 'w2', name: 'Travel' };

/** The storage promise the copy makes, verbatim from the spec's §3.4. */
const STORAGE_SENTENCE
    = /Enter it once to finish setting up this device\. It will be stored on this device, protected by your wallet password, so you are not asked again\./;

function mount({ unlockWallet, capturePassphrase } = {}) {
    const onUnlocked = vi.fn();
    const messaging = {
        unlockWallet: unlockWallet || vi.fn(async () => ({ unlocked: true, passphraseCaptureNeeded: [] })),
        capturePassphrase: capturePassphrase || vi.fn(async () => ({ stored: true })),
    };
    render(
        <MessagingProvider shell="popup" messaging={messaging}>
            <Locked onUnlocked={onUnlocked} />
        </MessagingProvider>,
    );
    return { onUnlocked, messaging };
}

/** Type a password and submit step 1. */
function submitPassword(pw = 'correct horse') {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: pw } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
}

/** Type a passphrase into step 2 and press Continue. */
function submitPassphrase(value) {
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

/** Wait for the capture step to be showing this wallet. */
async function expectStepTwoFor(name) {
    await waitFor(() => expect(screen.getByText(`${name} uses a passphrase.`)).toBeTruthy());
}

describe('Locked: unlock with nothing to capture', () => {
    it('fires onUnlocked and never shows the capture step', async () => {
        const { onUnlocked, messaging } = mount();
        submitPassword();

        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
        expect(screen.queryByLabelText('Passphrase')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
        expect(messaging.capturePassphrase).not.toHaveBeenCalled();
    });

    it('no longer offers a 25th-word field on the password step', () => {
        mount();

        expect(screen.queryByLabelText('25th-word passphrase')).toBeNull();
        expect(screen.queryByRole('button', { name: /25th-word passphrase/i })).toBeNull();
        expect(screen.queryByText(/25th word/i)).toBeNull();
    });
});

describe('Locked: the one-time capture step', () => {
    it('withholds onUnlocked and names the wallet plus the storage promise', async () => {
        const { onUnlocked } = mount({
            unlockWallet: vi.fn(async () => ({ unlocked: true, passphraseCaptureNeeded: [COLD] })),
        });
        submitPassword();
        await expectStepTwoFor(COLD.name);

        expect(screen.getByText(STORAGE_SENTENCE)).toBeTruthy();
        expect(screen.getByLabelText('Passphrase')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
        expect(onUnlocked).not.toHaveBeenCalled();
    });

    it('Continue stores the passphrase with the password that opened the vault, then unlocks', async () => {
        const capturePassphrase = vi.fn(async () => ({ stored: true }));
        const { onUnlocked } = mount({
            unlockWallet: vi.fn(async () => ({ unlocked: true, passphraseCaptureNeeded: [COLD] })),
            capturePassphrase,
        });
        submitPassword('correct horse');
        await expectStepTwoFor(COLD.name);

        submitPassphrase('the 25th word');
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
        expect(capturePassphrase).toHaveBeenCalledWith({
            walletId: 'w1',
            password: 'correct horse',
            bip39Passphrase: 'the 25th word',
        });
    });

    it('a mismatch marks the field, stays mounted and leaves the lockout untouched', async () => {
        const capturePassphrase = vi.fn(async () => {
            throw new PassphraseMismatchError([COLD.name]);
        });
        const { onUnlocked } = mount({
            unlockWallet: vi.fn(async () => ({ unlocked: true, passphraseCaptureNeeded: [COLD] })),
            capturePassphrase,
        });
        submitPassword();
        await expectStepTwoFor(COLD.name);

        submitPassphrase('wrong word');
        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

        // Still on step 2, with the field itself marked invalid.
        expect(screen.getByText(`${COLD.name} uses a passphrase.`)).toBeTruthy();
        expect(screen.getByLabelText('Passphrase').getAttribute('aria-invalid')).toBe('true');
        expect(onUnlocked).not.toHaveBeenCalled();

        // The password was right, so nothing here is a bad-password guess.
        expect(getLockoutState().failedAttempts).toBe(0);
        expect(getLockoutState().lockedUntilMs).toBe(0);
    });

    it('a retry after a mismatch can still succeed', async () => {
        const capturePassphrase = vi.fn()
            .mockRejectedValueOnce(new PassphraseMismatchError([COLD.name]))
            .mockResolvedValueOnce({ stored: true });
        const { onUnlocked } = mount({
            unlockWallet: vi.fn(async () => ({ unlocked: true, passphraseCaptureNeeded: [COLD] })),
            capturePassphrase,
        });
        submitPassword();
        await expectStepTwoFor(COLD.name);

        submitPassphrase('wrong word');
        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

        submitPassphrase('right word');
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
    });
});

describe('Locked: several legacy wallets, one at a time', () => {
    it('capturing wallet 1 advances to wallet 2 rather than finishing', async () => {
        const capturePassphrase = vi.fn(async () => ({ stored: true }));
        const { onUnlocked } = mount({
            unlockWallet: vi.fn(async () => ({
                unlocked: true,
                passphraseCaptureNeeded: [COLD, TRAVEL],
            })),
            capturePassphrase,
        });
        submitPassword();
        await expectStepTwoFor(COLD.name);

        submitPassphrase('first word');
        await expectStepTwoFor(TRAVEL.name);

        expect(onUnlocked).not.toHaveBeenCalled();
        expect(capturePassphrase).toHaveBeenCalledTimes(1);
        expect(capturePassphrase.mock.calls[0][0].walletId).toBe('w1');
        // The field is cleared, so wallet 2's passphrase cannot be typed
        // on top of wallet 1's.
        expect(screen.getByLabelText('Passphrase').value).toBe('');

        submitPassphrase('second word');
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
        expect(capturePassphrase.mock.calls[1][0].walletId).toBe('w2');
    });

    it('Not now on wallet 1 of 2 abandons the queue and unlocks immediately', async () => {
        const capturePassphrase = vi.fn(async () => ({ stored: true }));
        const { onUnlocked } = mount({
            unlockWallet: vi.fn(async () => ({
                unlocked: true,
                passphraseCaptureNeeded: [COLD, TRAVEL],
            })),
            capturePassphrase,
        });
        submitPassword();
        await expectStepTwoFor(COLD.name);

        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
        expect(capturePassphrase).not.toHaveBeenCalled();
        expect(screen.queryByText(`${TRAVEL.name} uses a passphrase.`)).toBeNull();
    });
});
