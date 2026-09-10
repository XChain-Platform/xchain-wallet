// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// the wrong-password lockout copy read like rate limiting to a
// tester, who answered it by reaching for a VPN instead of waiting out the
// local, per-device counter. Both places the copy renders (the aria-live
// banner and the field-level error under the password input) must name the
// lockout as local to this device and say plainly that changing networks
// does not help, so nobody reads it as an IP-based rate limit again.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    clearLockoutState,
    recordLockoutFailure,
} from '../../../packages/core/src/flows/index.js';

beforeEach(() => clearLockoutState());
afterEach(() => { cleanup(); clearLockoutState(); });

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

describe('Locked: lockout copy does not read as rate limiting', () => {
    it('names the counter as local to this device and says changing networks will not help, once locked', async () => {
        // Attempts 1-2 carry no delay (see the schedule in lockoutTracking.js),
        // so drive the counter to N=3 first, which is the first attempt that
        // actually locks and renders the copy under test.
        recordLockoutFailure();
        recordLockoutFailure();

        mount();
        submitPassword();

        await waitFor(() => {
            expect(screen.getByRole('status')).toBeTruthy();
        });

        const banner = screen.getByRole('status');
        expect(banner.textContent).toMatch(/too many incorrect passwords on this device/i);
        expect(banner.textContent).toMatch(/changing networks will not skip the wait/i);
        // Never the old bare "rate limit"-adjacent phrasing the tester
        // misread; the fix must not just append the new sentence next to it.
        expect(banner.textContent).not.toMatch(/incorrect password\. try again/i);

        // Both the banner and the field-level error under the password
        // input carry the fixed copy; neither is the old bare
        // "Incorrect password. Try again in ...".
        const matches = screen.getAllByText(/too many incorrect passwords on this device/i);
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('leaves the plain "Incorrect password." message alone on the first miss (no lockout yet)', async () => {
        mount();
        submitPassword();

        await waitFor(() => {
            expect(screen.getAllByText(/incorrect password/i).length).toBeGreaterThan(0);
        });
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
