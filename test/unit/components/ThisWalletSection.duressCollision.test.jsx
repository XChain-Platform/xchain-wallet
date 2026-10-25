// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A wallet password equal to the duress passphrase turns the duress
// passphrase into the real one: the Locked screen tries the real unlock
// first, so typing it under duress opens the wallet and arms nothing. The
// duress row refuses the wallet password as the passphrase; a password
// change refuses the passphrase as the new password for the same reason.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThisWalletSection } from '../../../packages/core/src/shared/components/settings/ThisWalletSection.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import {
    __resetDuressPersistenceForTests,
    clearDuressPassphrase,
    setDuressPassphrase,
} from '../../../packages/core/src/flows/duressPassphrase.js';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,eA==') } }));

beforeEach(() => {
    localStorage.clear();
    __resetDuressPersistenceForTests();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearDuressPassphrase();
    __resetDuressPersistenceForTests();
    localStorage.clear();
});

function changeTo(messaging, next) {
    render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <ToastHost>
                <ThisWalletSection
                    activeWallet={{ id: 'wallet-1', name: 'Duress Wallet', format: 'bip39' }}
                    activeAccount={{ id: 'account-0', name: 'Main', index: 0 }}
                />
            </ToastHost>
        </MessagingContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    fireEvent.change(screen.getByLabelText('Current wallet password'), { target: { value: 'current-password-1' } });
    fireEvent.change(screen.getByLabelText('New wallet password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Confirm new wallet password'), { target: { value: next } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    return screen.getByLabelText('New wallet password');
}

describe('change password and the duress passphrase', () => {
    it('refuses a new password equal to the duress passphrase and changes nothing', () => {
        setDuressPassphrase('duress-passphrase-9');
        const changePassword = vi.fn(async () => ({}));

        const next = changeTo({ changePassword }, 'duress-passphrase-9');

        expect(changePassword).not.toHaveBeenCalled();
        expect(screen.getByText('Choose a password that differs from your duress passphrase.')).toBeInTheDocument();
        expect(next).toHaveFocus();
    });

    it('accepts any other new password while a duress passphrase is set', () => {
        setDuressPassphrase('duress-passphrase-9');
        const changePassword = vi.fn(async () => ({}));

        changeTo({ changePassword }, 'replacement-password-1');

        expect(changePassword).toHaveBeenCalledWith(expect.objectContaining({ newPassword: 'replacement-password-1' }));
    });
});
