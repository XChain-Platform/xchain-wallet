// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// wallet.lock must finish what it started.
//
// Three bare awaits let the FIRST rejection abandon the rest: a session-key
// clear that throws skips the cached signing secret and skips the
// host/SignerPool teardown, leaving an open vault and live seed material
// behind a UI that has already rendered "locked". Every case below drives a
// rejecting step and asserts the remaining steps still ran.

import { describe, it, expect, vi } from 'vitest';

import { handleWalletLock, WalletLockIncompleteError } from '../../../packages/extension/src/background/walletLock.js';

/** A session backend stub whose clear() either resolves or rejects. */
function backend({ fails = false } = {}) {
    const calls = { clear: 0 };
    return {
        calls,
        clear: vi.fn(async () => {
            calls.clear += 1;
            if (fails) throw new Error('storage unavailable');
        }),
    };
}

describe('handleWalletLock', () => {
    it('returns locked and runs every step on the happy path', async () => {
        const sessionBackend = backend();
        const signingSecretBackend = backend();
        const onLocked = vi.fn();

        const result = await handleWalletLock(null, {
            sessionBackend, signingSecretBackend, onLocked,
        });

        expect(result).toEqual({ locked: true });
        expect(sessionBackend.calls.clear).toBe(1);
        expect(signingSecretBackend.calls.clear).toBe(1);
        expect(onLocked).toHaveBeenCalledTimes(1);
        expect(onLocked.mock.calls[0][0]).toEqual({ secretsCleared: true });
    });

    it('still clears the signing secret and tears down when the session clear fails', async () => {
        const sessionBackend = backend({ fails: true });
        const signingSecretBackend = backend();
        const onLocked = vi.fn();

        await expect(handleWalletLock(null, {
            sessionBackend, signingSecretBackend, onLocked,
        })).rejects.toBeInstanceOf(WalletLockIncompleteError);

        expect(signingSecretBackend.calls.clear).toBe(1);
        expect(onLocked).toHaveBeenCalledTimes(1);
        expect(onLocked.mock.calls[0][0]).toEqual({ secretsCleared: false });
    });

    it('still tears down when the signing-secret clear fails', async () => {
        const sessionBackend = backend();
        const signingSecretBackend = backend({ fails: true });
        const onLocked = vi.fn();

        await expect(handleWalletLock(null, {
            sessionBackend, signingSecretBackend, onLocked,
        })).rejects.toMatchObject({ name: 'WalletLockIncompleteError' });

        expect(sessionBackend.calls.clear).toBe(1);
        expect(onLocked).toHaveBeenCalledTimes(1);
        expect(onLocked.mock.calls[0][0]).toEqual({ secretsCleared: false });
    });

    it('still tears down when BOTH clears fail, and names both steps', async () => {
        const sessionBackend = backend({ fails: true });
        const signingSecretBackend = backend({ fails: true });
        const onLocked = vi.fn();

        const err = await handleWalletLock(null, {
            sessionBackend, signingSecretBackend, onLocked,
        }).catch((e) => e);

        expect(err).toBeInstanceOf(WalletLockIncompleteError);
        expect(err.steps).toEqual(['sessionBackend.clear', 'clearSigningSecret']);
        expect(onLocked).toHaveBeenCalledTimes(1);
    });

    it('reports a teardown failure instead of hiding it', async () => {
        const sessionBackend = backend();
        const signingSecretBackend = backend();
        const onLocked = vi.fn(async () => { throw new Error('teardown blew up'); });

        const err = await handleWalletLock(null, {
            sessionBackend, signingSecretBackend, onLocked,
        }).catch((e) => e);

        expect(err).toBeInstanceOf(WalletLockIncompleteError);
        expect(err.steps).toEqual(['onLocked']);
        // Both secrets were cleared before teardown was even attempted.
        expect(sessionBackend.calls.clear).toBe(1);
        expect(signingSecretBackend.calls.clear).toBe(1);
    });

    it('carries no secret material in the error it raises', async () => {
        const sessionBackend = {
            clear: async () => { throw new Error('hunter2 at key xchain-wallet:session'); },
        };
        const err = await handleWalletLock(null, {
            sessionBackend, signingSecretBackend: backend(), onLocked: () => { },
        }).catch((e) => e);

        expect(err.message).toBe('Wallet lock incomplete: sessionBackend.clear failed.');
        expect(err.message).not.toMatch(/hunter2/);
    });
});
