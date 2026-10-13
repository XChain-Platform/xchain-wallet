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
    clearDemoWalletId,
    clearLockoutState,
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
    render(
        <MessagingProvider shell="popup" messaging={{ unlockWallet }}>
            <Locked onUnlocked={vi.fn()} />
        </MessagingProvider>,
    );
}

beforeEach(() => {
    vi.useFakeTimers();
    clearDemoWalletId();
    clearLockoutState();
    setBiometricProvider(null);
    nextPaint.mockClear();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    clearLockoutState();
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
});
