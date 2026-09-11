// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The unlock lockout ladder has to survive concurrent attempts.
//
// Failure accounting is a persisted read-modify-write (load -> recordFailure
// -> save) that spans an awaited vault open, and nothing above it serialized
// the handler. So a burst of wrong-password attempts all read the same
// pre-state and each saved failCount 1: the backoff never advanced, and the
// pre-KDF gate they had all passed together stayed open. This drives seven
// concurrent attempts through the real throttle helpers and asserts the
// ladder counts every one of them.
//
// The KDF and the Vault are faked: a real Argon2id round costs ~100ms of
// blocked event loop per attempt and proves nothing about the accounting.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, deriveMasterKey: () => new Uint8Array(32).fill(3) },
        storage: {
            ...actual.storage,
            // Always a wrong password: open() rejects with the typed tag
            // mismatch core's aead raises, after a real microtask gap so the
            // attempts genuinely interleave.
            Vault: class WrongPasswordVault {
                async open() {
                    await new Promise((r) => setTimeout(r, 1));
                    throw new actual.crypto.AeadAuthError(new Error('aes/gcm: invalid ghash tag'));
                }
                close() { /* nothing to zero */ }
            },
        },
    };
});

const { handleWalletUnlock } = await import('../../../packages/extension/src/background/walletUnlock.js');
const { FREE_ATTEMPTS } = await import('../../../packages/extension/src/background/unlockThrottle.js');

/**
 * In-memory throttle store with an await on both sides of the mutation, which
 * is exactly the window a lost update needs.
 */
function makeThrottleStore() {
    const store = { state: null, loads: 0, saves: 0 };
    return {
        store,
        async load() {
            store.loads += 1;
            await new Promise((r) => setTimeout(r, 1));
            return store.state ? { ...store.state } : null;
        },
        async save(next) {
            await new Promise((r) => setTimeout(r, 1));
            store.saves += 1;
            store.state = { ...next };
        },
        async clear() { store.state = null; },
    };
}

function makeDeps(throttle) {
    return {
        storageBackend: {},
        sessionBackend: { save: vi.fn(async () => { }) },
        signingSecretBackend: { save: vi.fn(async () => { }) },
        metaBackend: { load: async () => ({ kdfParams: { salt: 'x', memory: 1, iterations: 1, parallelism: 1 } }) },
        unlockThrottleStore: throttle,
    };
}

describe('concurrent wallet.unlock attempts', () => {
    let throttle;
    beforeEach(() => { throttle = makeThrottleStore(); });

    it('charges every concurrent wrong password to the ladder', async () => {
        const attempts = FREE_ATTEMPTS + 2;   // 7: six charged, the seventh gated
        const settled = await Promise.allSettled(
            Array.from({ length: attempts }, () => handleWalletUnlock(
                { password: 'wrong' }, makeDeps(throttle),
            )),
        );

        const names = settled.map((r) => r.reason?.name);
        expect(settled.every((r) => r.status === 'rejected')).toBe(true);
        // Six reached the vault and were counted; the seventh was refused by
        // the gate the sixth failure closed. Before serialization, all seven
        // passed the gate and the store held failCount 1.
        expect(names.filter((n) => n === 'InvalidPasswordError')).toHaveLength(FREE_ATTEMPTS + 1);
        expect(names.filter((n) => n === 'UnlockThrottledError')).toHaveLength(1);
        expect(throttle.store.state.failCount).toBe(FREE_ATTEMPTS + 1);
        expect(throttle.store.state.lockedUntil).toBeGreaterThan(Date.now());
    });

    it('does not wedge the queue after a rejected attempt', async () => {
        await handleWalletUnlock({ password: 'wrong' }, makeDeps(throttle)).catch(() => { });
        await handleWalletUnlock({ password: 'wrong' }, makeDeps(throttle)).catch(() => { });
        // A rejection must not poison the shared chain: the second attempt
        // still ran and still counted.
        expect(throttle.store.state.failCount).toBe(2);
    });
});
