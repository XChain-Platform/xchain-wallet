// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

/** An InvalidPasswordError look-alike: only `name` is checked by Locked.jsx. */
function invalidPasswordError() {
    const err = new Error('bad password');
    err.name = 'InvalidPasswordError';
    return err;
}

function mount({ unlockWallet } = {}) {
    const onUnlocked = vi.fn();
    const messaging = {
        unlockWallet: unlockWallet || vi.fn(async () => { throw invalidPasswordError(); }),
        capturePassphrase: vi.fn(async () => ({ stored: true })),
    };
    render(
        <MessagingProvider shell="popup" messaging={messaging}>
            <Locked onUnlocked={onUnlocked} />
        </MessagingProvider>,
    );
    return { onUnlocked, messaging };
}

function submitPassword(pw = 'guess') {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: pw } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
}

describe('Locked password failure feedback', () => {
    it('shows one plain, live lockout message and refocuses after the wait', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
        recordLockoutFailure();
        recordLockoutFailure();

        mount();
        await act(async () => {
            submitPassword();
        });

        const password = screen.getByLabelText('Password');
        const banner = screen.getByRole('status');
        expect(banner).toHaveTextContent(
            'Too many incorrect passwords on this device. '
            + 'Wait 5 seconds before trying again. '
            + 'Changing networks will not skip the wait.',
        );
        expect(screen.getAllByText(/too many incorrect passwords on this device/i))
            .toHaveLength(1);
        expect(password).toHaveValue('');
        expect(password).toBeDisabled();

        act(() => vi.advanceTimersByTime(1000));
        expect(banner).toHaveTextContent(/wait 4 seconds before trying again/i);

        act(() => vi.advanceTimersByTime(4000));
        expect(screen.queryByRole('status')).toBeNull();
        expect(password).toBeEnabled();
        expect(password).toHaveFocus();
    });

    it('leaves the plain "Incorrect password." message alone on the first miss (no lockout yet)', async () => {
        mount();
        submitPassword();

        await waitFor(() => {
            expect(screen.getAllByText(/incorrect password/i).length).toBeGreaterThan(0);
        });
        expect(screen.getAllByText('Incorrect password.')).toHaveLength(1);
        expect(screen.getByLabelText('Password')).toHaveValue('');
        expect(screen.getByLabelText('Password')).toHaveFocus();
        expect(screen.queryByText(/too many incorrect passwords/i)).toBeNull();
        expect(screen.queryByText(/changing networks/i)).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('never mentions rate limiting, an IP address, or a network-level block anywhere in the locked copy', async () => {
        recordLockoutFailure();
        recordLockoutFailure();

        mount();
        submitPassword();

        await waitFor(() => {
            expect(screen.getByRole('status')).toBeTruthy();
        });

        const bodyText = document.body.textContent || '';
        expect(bodyText).not.toMatch(/rate.?limit/i);
        expect(bodyText).not.toMatch(/ip address/i);
    });
});
