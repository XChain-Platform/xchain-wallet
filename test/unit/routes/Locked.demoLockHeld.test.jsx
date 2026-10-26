// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pressing Lock on the demo wallet keeps it locked. The Locked screen's
// silent demo re-unlock is for a cold start; it must not undo a user lock,
// and it must never exist for a real wallet.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { lockImmediately } from '../../../packages/core/src/shared/utils/lockAction.js';
import {
    clearDemoWalletId,
    clearLockoutState,
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
