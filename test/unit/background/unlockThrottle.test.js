// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security regression (unlock-throttle): the renderer lockout was keyed on
// localStorage + client Date.now() and thus bypassable by driving wallet.unlock
// directly. The authoritative throttle lives in the background handler, is
// checked BEFORE the Argon2id KDF, and escalates a backoff after a run of
// failures. These tests pin the backoff math, the gate, and that a locked-out
// attempt is rejected without ever deriving the key.

import { describe, it, expect } from 'vitest';
import {
    computeBackoffMs,
    checkUnlockAllowed,
    recordFailure,
    FREE_ATTEMPTS,
} from '../../../packages/extension/src/background/unlockThrottle.js';
import {
    handleWalletUnlock,
    UnlockThrottledError,
} from '../../../packages/extension/src/background/walletUnlock.js';

describe('unlockThrottle pure logic', () => {
    it('gives FREE_ATTEMPTS mistypes with no delay, then escalates', () => {
        for (let n = 0; n <= FREE_ATTEMPTS; n++) {
            expect(computeBackoffMs(n)).toBe(0);
        }
        expect(computeBackoffMs(FREE_ATTEMPTS + 1)).toBe(15_000);
        expect(computeBackoffMs(FREE_ATTEMPTS + 2)).toBe(30_000);
        expect(computeBackoffMs(FREE_ATTEMPTS + 3)).toBe(60_000);
        // Caps at 15 minutes.
        expect(computeBackoffMs(FREE_ATTEMPTS + 50)).toBe(15 * 60 * 1000);
    });

    it('checkUnlockAllowed reflects lockedUntil vs now', () => {
        expect(checkUnlockAllowed(null, 1000).allowed).toBe(true);
        expect(checkUnlockAllowed({ failCount: 3, lockedUntil: 0 }, 1000).allowed).toBe(true);
        const locked = { failCount: 7, lockedUntil: 5000 };
        expect(checkUnlockAllowed(locked, 4000)).toEqual({ allowed: false, retryAfterMs: 1000 });
        expect(checkUnlockAllowed(locked, 5000).allowed).toBe(true);
    });

    it('recordFailure increments and sets lockedUntil once past the free attempts', () => {
        let s = null;
        for (let i = 0; i < FREE_ATTEMPTS; i++) s = recordFailure(s, 1000);
        expect(s.failCount).toBe(FREE_ATTEMPTS);
        expect(s.lockedUntil).toBe(0); // still free
        s = recordFailure(s, 1000);
        expect(s.failCount).toBe(FREE_ATTEMPTS + 1);
        expect(s.lockedUntil).toBe(1000 + 15_000);
    });
});

describe('handleWalletUnlock throttle gate', () => {
    it('rejects a locked-out attempt BEFORE running the KDF', async () => {
        let derivedCalled = false;
        const deps = {
            // If the gate fails to short-circuit, load() would be reached and
            // we'd run argon2; instead the throttle store reports a live lock.
            metaBackend: { load: async () => ({ kdfParams: { algorithm: 'argon2id' } }) },
            storageBackend: { load: async () => { derivedCalled = true; return null; } },
            sessionBackend: { save: async () => {} },
            unlockThrottleStore: {
                load: async () => ({ failCount: 8, lockedUntil: Date.now() + 60_000 }),
                save: async () => {},
                clear: async () => {},
            },
        };
        await expect(handleWalletUnlock({ password: 'whatever' }, deps))
            .rejects.toBeInstanceOf(UnlockThrottledError);
        // The storage backend (only touched inside Vault.open, after the KDF)
        // was never reached, confirming we short-circuited pre-KDF.
        expect(derivedCalled).toBe(false);
    });

    it('does not throttle when no store is supplied (other shells gate elsewhere)', async () => {
        // metaBackend -> null gives NoVaultError; the point is that the absence
        // of a throttle store never yields UnlockThrottledError.
        const deps = { metaBackend: { load: async () => null } };
        await expect(handleWalletUnlock({ password: 'x' }, deps))
            .rejects.not.toBeInstanceOf(UnlockThrottledError);
    });
});
