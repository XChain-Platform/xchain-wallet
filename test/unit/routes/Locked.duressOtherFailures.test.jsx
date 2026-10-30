// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The duress passphrase arms the freeze however the unlock attempt fails.
// A second tab whose vault is held by the first, or a worker-side attempt
// throttle, refuses the attempt before any password check; the duress
// passphrase typed there still arms the freeze, which the open tab's signer
// then reads, and the screen says exactly what it says for any password.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { clearDemoWalletId, clearLockoutState } from '../../../packages/core/src/flows/index.js';
import {
    __resetDuressPersistenceForTests,
    clearDuressPassphrase,
    setDuressPassphrase,
} from '../../../packages/core/src/flows/duressPassphrase.js';
import {
    __resetPanicModePersistenceForTests,
    getPanicArmedBy,
    isSigningFrozen,
} from '../../../packages/core/src/flows/panicMode.js';

const DURESS = 'duress-passphrase-9';
const IN_USE = 'This wallet is already open in another tab. Lock or close that tab, then try again.';

beforeEach(() => {
    localStorage.clear();
    clearDemoWalletId();
    clearLockoutState();
    __resetDuressPersistenceForTests();
    __resetPanicModePersistenceForTests();
    setDuressPassphrase(DURESS);
});

afterEach(() => {
    cleanup();
    clearLockoutState();
    clearDuressPassphrase();
    __resetDuressPersistenceForTests();
    __resetPanicModePersistenceForTests();
    localStorage.clear();
});

async function submitWhileRejected(name, message, typed) {
    const unlockWallet = vi.fn().mockRejectedValue(Object.assign(new Error(message), { name }));
    render(
        <MessagingProvider shell="web" messaging={{ unlockWallet }}>
            <Locked onUnlocked={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
    await vi.waitFor(() => expect(unlockWallet).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue(''));
    return (await screen.findByRole('alert')).textContent;
}

describe('duress passphrase on an unlock refused before the password check', () => {
    it('arms the freeze when another tab holds the vault, with the same message', async () => {
        const shown = await submitWhileRejected('VaultInUseError', IN_USE, DURESS);
        expect(shown).toBe(IN_USE);
        expect(isSigningFrozen()).toBe(true);
        expect(getPanicArmedBy()).toBe('duress');
    });

    it('arms the freeze when the worker throttles the attempt', async () => {
        await submitWhileRejected('UnlockThrottledError', 'Too many attempts', DURESS);
        expect(isSigningFrozen()).toBe(true);
        expect(getPanicArmedBy()).toBe('duress');
    });

    it('arms nothing for any other password', async () => {
        const shown = await submitWhileRejected('VaultInUseError', IN_USE, 'not-the-duress-1');
        expect(shown).toBe(IN_USE);
        expect(isSigningFrozen()).toBe(false);
    });
});
