// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Security review of the Forgot Password recovery, 2026-11-16: the lock
// screen's half of the 48-hour erase. An unlock's cancel is awaited and a
// failed one is said; a due erase never runs while another tab holds the
// vault, or after the store that held it stopped holding it.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const wipeWalletStorage = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/utils/wipeWalletStorage.js', () => ({
    wipeWalletStorage,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { clearDemoWalletId, clearLockoutState } from '../../../packages/core/src/flows/index.js';
import {
    ERASE_CANCELLED_STORAGE_KEY,
    ERASE_HOLD_MS,
    ERASE_SCHEDULE_STORAGE_KEY,
    __resetEraseScheduleForTests,
    configureEraseSchedulePersistence,
    getEraseSchedule,
    scheduleErase,
} from '../../../packages/core/src/flows/eraseSchedule.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

const CANCELLED_KEY = ERASE_CANCELLED_STORAGE_KEY;
let reload;

function mount(messaging = { unlockWallet: vi.fn().mockResolvedValue({ unlocked: true, passphraseCaptureNeeded: [] }) }) {
    const onUnlocked = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Locked onUnlocked={onUnlocked} />
        </MessagingProvider>,
    );
    return { messaging, onUnlocked };
}

function dueRecord() {
    const dueAt = Date.now() - 60_000;
    return { scheduledAt: dueAt - ERASE_HOLD_MS, dueAt };
}

function stubLocks(held) {
    Object.defineProperty(globalThis.navigator, 'locks', {
        configurable: true,
        value: {
            query: vi.fn(async () => ({ held, pending: [] })),
            request: vi.fn(async (name, _opts, fn) => fn(held.length ? null : { name })),
        },
    });
}

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
    __resetEraseScheduleForTests();
    globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
    globalThis.localStorage.removeItem(CANCELLED_KEY);
    wipeWalletStorage.mockReset();
    wipeWalletStorage.mockResolvedValue(undefined);
    reload = vi.fn();
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { reload } });
});

afterEach(async () => {
    cleanup();
    resetBackStackForTests();
    clearLockoutState();
    await configureEraseSchedulePersistence(null);
    __resetEraseScheduleForTests();
    globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
    globalThis.localStorage.removeItem(CANCELLED_KEY);
    delete globalThis.navigator.locks;
    delete globalThis.location;
});

describe('Locked: the scheduled erase', () => {
    it('an unlock whose cancel the store refuses says the erase is still scheduled', async () => {
        let slot = null;
        await configureEraseSchedulePersistence({
            load: async () => slot,
            save: async (s) => { slot = s; },
            clear: async () => { throw new Error('keystore is locked'); },
        });
        await scheduleErase();
        const { onUnlocked } = mount();
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        expect(await screen.findByText('Erase Still Scheduled')).toBeInTheDocument();
        expect(screen.queryByText('Erase Cancelled')).toBeNull();
        expect(getEraseSchedule()).not.toBeNull();
        expect(onUnlocked).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(onUnlocked).toHaveBeenCalledOnce();
    });

    it('a due erase does not run while another tab holds the vault lease', async () => {
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify(dueRecord()));
        stubLocks([{ name: 'xchain-wallet:vault-session', mode: 'exclusive' }]);
        mount();
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
    });

    it('a due erase does not run once the record left its store', async () => {
        const state = { slot: dueRecord() };
        await configureEraseSchedulePersistence({
            load: async () => state.slot,
            save: async (s) => { state.slot = s; },
            clear: async () => { state.slot = null; },
        });
        // Cleared by another context after this start hydrated.
        state.slot = null;
        mount();
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('a due erase still runs when every check passes', async () => {
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify(dueRecord()));
        stubLocks([]);
        mount();
        await waitFor(() => expect(wipeWalletStorage).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    });
});
