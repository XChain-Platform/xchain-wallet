// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Change password, export encrypted backup and reveal recovery phrase put
// every password error in a bordered box below the whole form, so a wrong
// current password showed under the confirmation field and the export showed
// two boxes at once. Each message now renders under the field it is about,
// tied to it with aria-describedby and announced as an alert; only a failure
// that names no field stays in the form status.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThisWalletSection } from '../../../packages/core/src/shared/components/settings/ThisWalletSection.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,eA==') } }));

const WALLET = { id: 'wallet-active', name: 'Active Wallet', format: 'bip39' };

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function mount(node, messaging) {
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <ToastHost>{node}</ToastHost>
        </MessagingContext.Provider>,
    );
}

/** The alert under `field`: inside the same Input and named by its aria-describedby. */
function errorUnder(field) {
    const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const alerts = ids.map((id) => document.getElementById(id))
        .filter((node) => node?.getAttribute('role') === 'alert');
    expect(alerts, `no alert describes ${field.getAttribute('aria-label')}`).toHaveLength(1);
    expect(field.closest('div[class*="field"]').contains(alerts[0])).toBe(true);
    return alerts[0].textContent;
}

describe('change wallet password errors', () => {
    function openChange(messaging) {
        mount(<ThisWalletSection activeWallet={WALLET} activeAccount={{ id: 'a', name: 'Main', index: 0 }} />, messaging);
        fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
        return {
            current: screen.getByLabelText('Current wallet password'),
            next: screen.getByLabelText('New wallet password'),
            confirm: screen.getByLabelText('Confirm new wallet password'),
        };
    }

    it('shows a wrong current password under the current password field', async () => {
        const error = Object.assign(new Error('bad'), { name: 'InvalidPasswordError' });
        const { current, next, confirm } = openChange({ changePassword: vi.fn(async () => { throw error; }) });
        fireEvent.change(current, { target: { value: 'wrong-password' } });
        fireEvent.change(next, { target: { value: 'replacement-1' } });
        fireEvent.change(confirm, { target: { value: 'replacement-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

        expect(await screen.findByText('Current wallet password is incorrect.')).toBeInTheDocument();
        expect(errorUnder(current)).toBe('Current wallet password is incorrect.');
        expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    it('shows the length rule under the new password and a mismatch under the confirmation', () => {
        const { current, next, confirm } = openChange({ changePassword: vi.fn() });
        fireEvent.change(current, { target: { value: 'old-password' } });
        fireEvent.change(next, { target: { value: 'short' } });
        fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
        expect(errorUnder(next)).toBe('New password must be at least 8 characters.');

        fireEvent.change(next, { target: { value: 'replacement-1' } });
        fireEvent.change(confirm, { target: { value: 'replacement-' } });
        expect(errorUnder(confirm)).toBe("Passwords don't match.");
        // Still shown after the next keystroke, not dismissed as stale.
        fireEvent.change(confirm, { target: { value: 'replacement-2' } });
        expect(errorUnder(confirm)).toBe("Passwords don't match.");
        fireEvent.change(confirm, { target: { value: 'replacement-1' } });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('keeps a failure that names no field in the form status', async () => {
        const { current, next, confirm } = openChange({
            changePassword: vi.fn(async () => { throw new Error('Vault is busy.'); }),
        });
        fireEvent.change(current, { target: { value: 'old-password' } });
        fireEvent.change(next, { target: { value: 'replacement-1' } });
        fireEvent.change(confirm, { target: { value: 'replacement-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Vault is busy.');
        expect(current).not.toHaveAttribute('aria-invalid', 'true');
    });
});

describe('Backup password errors', () => {
    it('shows the export rules under the field each one is about, one at a time', () => {
        mount(<BackupSection activeWallet={WALLET} />, { exportBackupFile: vi.fn() });
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        const first = screen.getByLabelText('Backup password');
        const confirm = screen.getByLabelText('Confirm backup password');

        fireEvent.change(first, { target: { value: 'short' } });
        expect(errorUnder(first)).toBe('Backup password must be at least 8 characters.');
        fireEvent.change(first, { target: { value: 'shortish' } });
        expect(screen.queryByRole('alert')).toBeNull();

        fireEvent.change(confirm, { target: { value: 'shortisH' } });
        expect(errorUnder(confirm)).toBe("Backup passwords don't match.");
        expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    it('shows a wrong password for the recovery phrase under the password field', async () => {
        const error = Object.assign(new Error('tag'), { name: 'AeadAuthError' });
        mount(<BackupSection activeWallet={WALLET} />, {
            revealMnemonicRequest: vi.fn(async () => { throw error; }),
        });
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        const field = screen.getByLabelText('Wallet password');
        fireEvent.change(field, { target: { value: 'wrong-password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));

        expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
        expect(errorUnder(field)).toBe('Incorrect password.');
    });
});
