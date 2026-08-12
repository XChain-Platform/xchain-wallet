// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The screen for a vault that exists and will not open.
//
// Found by corrupting the Keystore ciphertext on an Android emulator
// (2026-08-01, first-run session). The storage contract behaved
// perfectly - CORRUPT rather than ABSENT, and the app refused rather than
// offering "create new wallet" - and then showed the user
// `vault storage unavailable: vault failed its integrity check` in red, with
// no mention that their recovery phrase still holds everything and nothing to
// do next.
//
// The assertions that matter most here are the ones about what this screen
// must NOT offer. A `locked` vault is intact and its owner has simply not
// unlocked their phone; putting an erase button on that screen would destroy
// working wallets to fix nothing.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { VaultUnavailable } from '../../../packages/core/src/shared/routes/VaultUnavailable.jsx';
import {
    vaultErrorKind,
    VaultCorruptError,
    VaultLockedError,
    VaultUnavailableError,
} from '../../../packages/core/src/storage/backend.js';

afterEach(cleanup);

function renderScreen(props = {}) {
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: {} },
            React.createElement(VaultUnavailable, { kind: 'corrupt', ...props }),
        ),
    );
}

describe('vaultErrorKind', () => {
    it('narrows each of the three', () => {
        expect(vaultErrorKind(new VaultCorruptError())).toBe('corrupt');
        expect(vaultErrorKind(new VaultLockedError())).toBe('locked');
        expect(vaultErrorKind(new VaultUnavailableError())).toBe('unavailable');
    });

    it('is null for an ordinary error, so the generic screen still shows', () => {
        expect(vaultErrorKind(new Error('network is down'))).toBeNull();
        expect(vaultErrorKind(undefined)).toBeNull();
        expect(vaultErrorKind('a string')).toBeNull();
    });

    it('classifies an error from ANOTHER REALM, where instanceof is false', () => {
        // Not hypothetical: the native vault seam already produced a real bug
        // where `instanceof Uint8Array` was false for a TextEncoder result
        // from a different realm. A plugin reply decoded in another bundle
        // must not fall through to the generic red-text screen.
        const alien = new Error('the stored vault failed its integrity check');
        alien.name = 'VaultCorruptError';
        expect(alien instanceof VaultCorruptError).toBe(false);
        expect(vaultErrorKind(alien)).toBe('corrupt');
    });

    it('does not mistake the base class for the specific ones', () => {
        // VaultLockedError and VaultCorruptError both EXTEND
        // VaultUnavailableError, so an instanceof-first implementation would
        // answer 'unavailable' for all three and every vault would get the
        // vaguest of the three screens.
        expect(vaultErrorKind(new VaultLockedError())).not.toBe('unavailable');
        expect(vaultErrorKind(new VaultCorruptError())).not.toBe('unavailable');
    });
});

describe('VaultUnavailable: what every kind says', () => {
    it.each(['corrupt', 'locked', 'unavailable'])(
        'tells a %s user their recovery phrase still holds everything',
        (kind) => {
            renderScreen({ kind });
            expect(
                screen.getByText(/recovery phrase still holds everything/i),
            ).toBeTruthy();
            expect(screen.getByText(/coins live on the blockchain/i)).toBeTruthy();
        },
    );

    it.each(['corrupt', 'locked', 'unavailable'])(
        'gives a %s user something to do',
        (kind) => {
            renderScreen({ kind });
            expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
        },
    );

    it('never says the raw error where the headline goes', () => {
        renderScreen({ kind: 'corrupt', detail: 'vault storage unavailable: bad tag' });
        const heading = screen.getByRole('heading');
        expect(heading.textContent).not.toMatch(/vault storage unavailable/);
        // Still reachable, because support needs it.
        expect(screen.getByText(/Technical detail: vault storage unavailable: bad tag/)).toBeTruthy();
    });

    it('says something different for each kind', () => {
        const seen = new Set();
        for (const kind of ['corrupt', 'locked', 'unavailable']) {
            cleanup();
            renderScreen({ kind });
            seen.add(screen.getByRole('heading').textContent);
        }
        expect(seen.size).toBe(3);
    });

    it('tells a locked user the actual fix: unlock the device', () => {
        renderScreen({ kind: 'locked' });
        // The fix, not just the diagnosis - and it must say the wallet is
        // safe, because "your wallet could not be opened" reads as loss.
        expect(screen.getByText(/Unlock it, then try again/i)).toBeTruthy();
        expect(screen.getByText(/Your wallet is safe on this device/i)).toBeTruthy();
    });
});

describe('VaultUnavailable: the destructive escape', () => {
    it.each(['locked', 'unavailable'])('is NOT offered for %s', (kind) => {
        renderScreen({ kind });
        expect(screen.queryByText(/start over from my recovery phrase/i)).toBeNull();
        expect(screen.queryByText(/^Type WIPE to confirm$/)).toBeNull();
    });

    it('is offered for corrupt, because nothing else lets that user proceed', () => {
        renderScreen({ kind: 'corrupt' });
        expect(screen.getByText(/start over from my recovery phrase/i)).toBeTruthy();
    });

    it('is never one tap: it needs the panel opened AND the word typed', async () => {
        const wipe = vi.fn().mockResolvedValue(undefined);
        renderScreen({ kind: 'corrupt', wipe });

        // Nothing destructive is reachable before the panel is opened.
        expect(screen.queryByRole('button', { name: /remove damaged data/i })).toBeNull();

        fireEvent.click(screen.getByText(/start over from my recovery phrase/i));
        const confirm = screen.getByRole('button', { name: /remove damaged data/i });
        expect(confirm.disabled).toBe(true);

        fireEvent.click(confirm);
        expect(wipe).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText(/type wipe to confirm/i), { target: { value: 'WIPE' } });
        await waitFor(() => expect(confirm.disabled).toBe(false));
        fireEvent.click(confirm);
        await waitFor(() => expect(wipe).toHaveBeenCalledTimes(1));
    });

    it('refuses a near-miss confirmation', async () => {
        const wipe = vi.fn().mockResolvedValue(undefined);
        renderScreen({ kind: 'corrupt', wipe });

        fireEvent.click(screen.getByText(/start over from my recovery phrase/i));
        fireEvent.change(screen.getByLabelText(/type wipe to confirm/i), { target: { value: 'WIP' } });
        fireEvent.click(screen.getByRole('button', { name: /remove damaged data/i }));
        expect(wipe).not.toHaveBeenCalled();
    });

    it('surfaces a failed wipe instead of reloading into the same screen', async () => {
        const wipe = vi.fn().mockRejectedValue(new Error('shell wipe failed'));
        renderScreen({ kind: 'corrupt', wipe });

        fireEvent.click(screen.getByText(/start over from my recovery phrase/i));
        fireEvent.change(screen.getByLabelText(/type wipe to confirm/i), { target: { value: 'WIPE' } });
        fireEvent.click(screen.getByRole('button', { name: /remove damaged data/i }));

        await waitFor(() => expect(screen.getByText(/shell wipe failed/)).toBeTruthy());
    });

    it('warns, before the input, that the phrase is needed to come back', async () => {
        renderScreen({ kind: 'corrupt' });
        fireEvent.click(screen.getByText(/start over from my recovery phrase/i));
        expect(screen.getByText(/unless you have your recovery phrase/i)).toBeTruthy();
        expect(screen.getByText(/changes nothing on the blockchain/i)).toBeTruthy();
    });

    it('cancels back to a state with nothing destructive reachable', async () => {
        renderScreen({ kind: 'corrupt' });
        fireEvent.click(screen.getByText(/start over from my recovery phrase/i));
        fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
        expect(screen.queryByRole('button', { name: /remove damaged data/i })).toBeNull();
    });
});

describe('VaultUnavailable: retry', () => {
    it('calls the injected retry rather than reloading', async () => {
        const onRetry = vi.fn();
        renderScreen({ kind: 'locked', onRetry });
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
