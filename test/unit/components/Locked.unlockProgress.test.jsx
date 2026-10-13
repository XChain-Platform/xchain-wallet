// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const nextPaint = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../../packages/core/src/shared/utils/nextPaint.js', () => ({ nextPaint }));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import {
    activatePanicMode,
    clearDemoWalletId,
    clearLockoutState,
    clearPanicModeState,
    configureLockoutPersistence,
    configurePanicModePersistence,
    getLockoutState,
    getPanicModeState,
    recordLockoutFailure,
    setBiometricProvider,
} from '../../../packages/core/src/flows/index.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function mount(unlockWallet) {
    const onUnlocked = vi.fn();
    render(
        <MessagingProvider shell="popup" messaging={{ unlockWallet }}>
            <Locked onUnlocked={onUnlocked} />
        </MessagingProvider>,
    );
    return { onUnlocked };
}

beforeEach(() => {
    vi.useFakeTimers();
    clearDemoWalletId();
    clearLockoutState();
    setBiometricProvider(null);
    nextPaint.mockClear();
});

afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    await configureLockoutPersistence(null);
    await configurePanicModePersistence(null);
    clearLockoutState();
    clearPanicModeState();
    setBiometricProvider(null);
});

describe('Locked unlock progress', () => {
    it('shows immediate busy feedback, delays the explanation, and submits only once', async () => {
        const pending = deferred();
        const unlockWallet = vi.fn(() => pending.promise);
        mount(unlockWallet);

        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'wallet password' },
        });
        const button = screen.getByRole('button', { name: 'Unlock Wallet' });
        const form = button.closest('form');

        await act(async () => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await Promise.resolve();
        });

        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');
        expect(unlockWallet).toHaveBeenCalledOnce();
        expect(screen.queryByText(/unlocking your wallet securely/i)).toBeNull();

        act(() => vi.advanceTimersByTime(1999));
        expect(screen.queryByText(/unlocking your wallet securely/i)).toBeNull();

        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByText('Unlocking your wallet securely. This may take a moment.'))
            .toBeTruthy();

        await act(async () => pending.resolve({}));
    });

    it('cancels the delayed explanation when unlock finishes early', async () => {
        const pending = deferred();
        mount(vi.fn(() => pending.promise));

        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'wallet password' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await act(async () => Promise.resolve());
        await act(async () => pending.reject(new Error('Unlock failed quickly')));

        act(() => vi.advanceTimersByTime(2000));
        expect(screen.queryByText(/unlocking your wallet securely/i)).toBeNull();
        expect(screen.getByText('Unlock failed quickly')).toBeTruthy();
    });

    it('restores focus and selection after a failed attempt re-enables the field', async () => {
        const pending = deferred();
        mount(vi.fn(() => pending.promise));
        const password = screen.getByLabelText('Password');
        const button = screen.getByRole('button', { name: 'Unlock Wallet' });

        fireEvent.change(password, { target: { value: 'wallet password' } });
        button.focus();
        fireEvent.click(button);
        await act(async () => pending.reject(new Error('Unlock failed')));

        expect(password).toHaveFocus();
        expect(password.selectionStart).toBe(0);
        expect(password.selectionEnd).toBe('wallet password'.length);
    });

    it('clears a prior error when a retry succeeds', async () => {
        const unlockWallet = vi.fn()
            .mockRejectedValueOnce(new Error('Temporary unlock failure'))
            .mockResolvedValueOnce({});
        const { onUnlocked } = mount(unlockWallet);
        const password = screen.getByLabelText('Password');

        fireEvent.change(password, { target: { value: 'wallet password' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.getByText('Temporary unlock failure')).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(onUnlocked).toHaveBeenCalledOnce();
        expect(screen.queryByText('Temporary unlock failure')).toBeNull();
    });

    it('disarms the delayed explanation as soon as unlock succeeds', async () => {
        const pending = deferred();
        const { onUnlocked } = mount(vi.fn(() => pending.promise));

        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'wallet password' },
        });
        const timersBeforeUnlock = vi.getTimerCount();
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await act(async () => Promise.resolve());
        expect(vi.getTimerCount()).toBe(timersBeforeUnlock + 1);

        await act(async () => pending.resolve({}));

        expect(onUnlocked).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(timersBeforeUnlock);
        act(() => vi.advanceTimersByTime(2000));
        expect(screen.queryByText(/unlocking your wallet securely/i)).toBeNull();
    });

    it('contains rejected best-effort writes from unlock guard state', async () => {
        const persistenceError = new Error('Guard storage unavailable');
        const lockoutStore = {
            load: vi.fn(async () => null),
            save: vi.fn(() => Promise.reject(persistenceError)),
            clear: vi.fn(() => Promise.reject(persistenceError)),
        };
        const panicStore = {
            load: vi.fn(async () => null),
            save: vi.fn(() => Promise.reject(persistenceError)),
            clear: vi.fn(() => Promise.reject(persistenceError)),
        };
        await configureLockoutPersistence(lockoutStore);
        await configurePanicModePersistence(panicStore);

        recordLockoutFailure(1_000);
        activatePanicMode({ nowMs: 1_000 });
        await Promise.resolve();

        expect(getLockoutState().failedAttempts).toBe(1);
        expect(getPanicModeState().expiresAt).toBeGreaterThan(1_000);
        expect(lockoutStore.save).toHaveBeenCalledOnce();
        expect(panicStore.save).toHaveBeenCalledOnce();

        await configureLockoutPersistence(null);
        await configurePanicModePersistence(null);
        clearLockoutState();
        clearPanicModeState();
    });
});
