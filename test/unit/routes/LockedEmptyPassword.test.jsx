// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G130 and G129 (operator 2026-11-16): Unlock Wallet is always enabled and
// green. A tap with no password says why: the password field turns red with
// its message and the error summary leads the form; nothing is sent to the
// host. A wrong password keeps its own message under the field.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { clearLockoutState } from '../../../packages/core/src/flows/index.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

afterEach(() => {
    cleanup();
    clearLockoutState();
});

function mount(unlockWallet = vi.fn(async () => ({}))) {
    const messaging = {
        unlockWallet,
        capturePassphrase: vi.fn(async () => ({ stored: true })),
    };
    render(
        <MessagingProvider shell="popup" messaging={messaging}>
            <Locked onUnlocked={vi.fn()} />
        </MessagingProvider>,
    );
    return messaging;
}

describe('Unlock Wallet with an empty password', () => {
    it('is enabled and green before a password is typed', () => {
        clearLockoutState();
        mount();
        const button = screen.getByRole('button', { name: 'Unlock Wallet' });
        expect(button).toBeEnabled();
        expect(button).not.toHaveAttribute('aria-disabled', 'true');
        expect(button).toHaveClass(buttonStyles.success);
    });

    it('shows the password error and the summary instead of unlocking', async () => {
        clearLockoutState();
        const messaging = mount();
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));

        const summary = await screen.findByRole('alert', { name: /form errors/i });
        expect(summary).toHaveTextContent('Fix 1 thing to continue');
        expect(summary).toHaveTextContent('Enter your wallet password.');
        const password = screen.getByLabelText('Password');
        expect(password).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.unlockWallet).not.toHaveBeenCalled();

        // Typing clears the field's error and its line in the summary.
        fireEvent.change(password, { target: { value: 'p' } });
        await waitFor(() => expect(screen.queryByRole('alert', { name: /form errors/i })).toBeNull());
    });

    it('keeps the wrong-password message under the field', async () => {
        clearLockoutState();
        const err = Object.assign(new Error('bad'), { name: 'InvalidPasswordError' });
        mount(vi.fn(async () => { throw err; }));
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        });
        expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
        expect(screen.queryByRole('alert', { name: /form errors/i })).toBeNull();
    });
});
