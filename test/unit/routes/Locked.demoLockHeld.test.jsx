// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pressing Lock on the demo wallet keeps it locked. The Locked screen's
// silent demo re-unlock is for a cold start; it must not undo a user lock,
// and it must never exist for a real wallet.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { lockImmediately } from '../../../packages/core/src/shared/utils/lockAction.js';
import {
    clearDemoWalletId,
    clearLockoutState,
    getDemoWalletId,
    isDemoLockHeld,
    markDemoWallet,
} from '../../../packages/core/src/flows/index.js';

function mount(messaging, onUnlocked = vi.fn()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Locked onUnlocked={onUnlocked} />
        </MessagingProvider>,
    );
    return onUnlocked;
}

function userLock() {
    return lockImmediately({
        clearTransientState: () => {},
        showLocked: () => {},
        lockWallet: () => Promise.resolve({ locked: true }),
        recover: () => {},
    });
}

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
});

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    clearLockoutState();
});

describe('Locked demo re-unlock', () => {
    it('still re-unlocks a demo wallet on a cold start', async () => {
        markDemoWallet('demo-1', { password: 'throwaway' });
        const messaging = { unlockWallet: vi.fn().mockResolvedValue({}) };
        const onUnlocked = mount(messaging);
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
        expect(messaging.unlockWallet).toHaveBeenCalledWith('throwaway');
    });

    it('stays locked after the user presses Lock on the demo wallet', async () => {
        markDemoWallet('demo-1', { password: 'throwaway' });
        await userLock();
        expect(isDemoLockHeld()).toBe(true);

        const messaging = { unlockWallet: vi.fn().mockResolvedValue({}) };
        const onUnlocked = mount(messaging);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(messaging.unlockWallet).not.toHaveBeenCalled();
        expect(onUnlocked).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('releases the hold when the demo is exited or a new demo starts', async () => {
        markDemoWallet('demo-1', { password: 'throwaway' });
        await userLock();
        markDemoWallet('demo-2', { password: 'fresh' });
        expect(isDemoLockHeld()).toBe(false);
        await userLock();
        clearDemoWalletId();
        expect(isDemoLockHeld()).toBe(false);
    });
});

describe('real wallet through the same events', () => {
    it('never auto-unlocks on mount, with or without a lock press', async () => {
        const messaging = { unlockWallet: vi.fn().mockResolvedValue({}) };
        const onUnlocked = mount(messaging);
        await new Promise((resolve) => setTimeout(resolve, 50));
        cleanup();
        await userLock();
        expect(isDemoLockHeld()).toBe(false);
        mount(messaging, onUnlocked);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(messaging.unlockWallet).not.toHaveBeenCalled();
        expect(onUnlocked).not.toHaveBeenCalled();
    });

    it('does not take a stored demo password for a different wallet', async () => {
        // A password left in storage without a demo id is inert.
        globalThis.localStorage.setItem('xc:demoWalletPassword', 'stale');
        const messaging = { unlockWallet: vi.fn().mockResolvedValue({}) };
        mount(messaging);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(messaging.unlockWallet).not.toHaveBeenCalled();
        globalThis.localStorage.removeItem('xc:demoWalletPassword');
    });
});

describe('demo password "demo"', () => {
    it('re-unlocks a demo marked without a stored password with the fixed one', async () => {
        markDemoWallet('demo-1');
        const messaging = { unlockWallet: vi.fn().mockResolvedValue({}) };
        const onUnlocked = mount(messaging);
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
        expect(messaging.unlockWallet).toHaveBeenCalledWith('demo');
    });

    it('names the password under the field, and typing demo unlocks with no length error', async () => {
        markDemoWallet('demo-1', { password: 'demo' });
        await userLock();
        const messaging = { unlockWallet: vi.fn().mockResolvedValue({ unlocked: true, passphraseCaptureNeeded: [] }) };
        const onUnlocked = mount(messaging);
        // A visible line under the field, read with it, not a help tooltip.
        const hint = screen.getByText('The demo wallet password is “demo”.');
        expect(screen.getByLabelText('Password').getAttribute('aria-describedby')).toContain(hint.id);
        // The immediate exit stays beside it.
        expect(screen.getByRole('button', { name: 'Exit Demo & Wipe' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'demo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
        expect(messaging.unlockWallet).toHaveBeenCalledWith('demo');
        expect(screen.queryByText(/at least 8|too short/i)).toBeNull();
    });

    it('shows no demo password line for a real wallet', () => {
        mount({ unlockWallet: vi.fn() });
        expect(screen.queryByText(/demo wallet password/i)).toBeNull();
    });

    it('re-marks a demo whose marker was lost once demo opens it', async () => {
        const messaging = {
            unlockWallet: vi.fn().mockResolvedValue({ unlocked: true, passphraseCaptureNeeded: [] }),
            listWallets: vi.fn().mockResolvedValue([{ id: 'demo-7', origin: 'demo' }]),
        };
        const onUnlocked = mount(messaging);
        // Without the marker the screen is the real-wallet one.
        expect(screen.getByRole('button', { name: 'Forgot Password?' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'demo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
        expect(getDemoWalletId()).toBe('demo-7');
    });

    it('never marks a real wallet unlocked with its own password', async () => {
        const messaging = {
            unlockWallet: vi.fn().mockResolvedValue({ unlocked: true, passphraseCaptureNeeded: [] }),
            listWallets: vi.fn().mockResolvedValue([{ id: 'demo-7', origin: 'demo' }]),
        };
        const onUnlocked = mount(messaging);
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-real-password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
        expect(getDemoWalletId()).toBe(null);
    });
});
