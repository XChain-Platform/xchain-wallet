// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A wait another tab started binds this tab too: the counter sits in storage
// the whole origin shares, and the web build has no host-side throttle behind
// the screen, so a tab that never saw the wait must not skip it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const nextPaint = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../../packages/core/src/shared/utils/nextPaint.js', () => ({ nextPaint }));

import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    clearLockoutState,
    recordLockoutFailure,
} from '../../../packages/core/src/flows/index.js';

beforeEach(() => {
    clearLockoutState();
    nextPaint.mockClear();
});
afterEach(() => {
    cleanup();
    clearLockoutState();
    vi.useRealTimers();
});

function mount() {
    const messaging = {
        unlockWallet: vi.fn(async () => ({})),
        capturePassphrase: vi.fn(async () => ({ stored: true })),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Locked onUnlocked={vi.fn()} />
        </MessagingProvider>,
    );
    return messaging;
}

describe('Locked wait started by another tab', () => {
    it('refuses an attempt that a second tab has put under a wait', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
        const messaging = mount();
        expect(screen.queryByRole('status')).toBeNull();

        // The other tab records its third miss; no event reaches this tab.
        recordLockoutFailure();
        recordLockoutFailure();
        recordLockoutFailure();

        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right-password' } });
        await act(async () => {
            fireEvent.submit(screen.getByLabelText('Password').closest('form'));
        });

        expect(messaging.unlockWallet).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent(/wait 5 seconds before trying again/i);
    });

    it('shows the wait as soon as the storage event from another tab arrives', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
        mount();
        expect(screen.queryByRole('status')).toBeNull();

        recordLockoutFailure();
        recordLockoutFailure();
        recordLockoutFailure();
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'xchain-wallet:lockout' }));
        });

        expect(screen.getByRole('status')).toHaveTextContent(/wait 5 seconds before trying again/i);
        expect(screen.getByRole('button', { name: 'Unlock Wallet' })).toBeDisabled();
    });
});
