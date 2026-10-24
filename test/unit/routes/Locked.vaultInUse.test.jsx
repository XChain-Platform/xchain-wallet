// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unlocking while another tab holds the vault must say so. A generic
// "Close and reopen the app" would send the user to reopen the very tab that
// is the problem.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { clearDemoWalletId, clearLockoutState } from '../../../packages/core/src/flows/index.js';

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
});

afterEach(() => {
    cleanup();
    clearLockoutState();
});

function unlockRejectedWith(name, message) {
    const unlockWallet = vi.fn().mockRejectedValue(Object.assign(new Error(message), { name }));
    render(
        <MessagingProvider shell="web" messaging={{ unlockWallet }}>
            <Locked onUnlocked={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
}

describe('Locked screen vault coordination failures', () => {
    it('names the other tab when it holds the vault', async () => {
        unlockRejectedWith('VaultInUseError', 'This wallet is already open in another tab. Lock or close that tab, then try again.');
        expect(await screen.findByText('This wallet is already open in another tab. Lock or close that tab, then try again.')).toBeTruthy();
        expect(screen.queryByText(/Close and reopen the app/)).toBeNull();
    });

    it('keeps the generic sentence for any other failure', async () => {
        unlockRejectedWith('Error', 'IDB exploded');
        expect(await screen.findByText('Could not unlock the wallet. Close and reopen the app, then try again.')).toBeTruthy();
    });
});
