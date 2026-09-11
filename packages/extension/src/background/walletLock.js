// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// wallet.lock handler: clears the session backend and signals the
// background to tear down its host + vault references. Pairs with the
// `wallet.unlock` handler: unlock builds the host, lock tears it down.
//
// Runs via the pre-host dispatcher so lock works even if the host is
// already in a bad state (e.g. a handler threw and left things partial).
// No vault access needed; clearing the session key on its own is
// enough to gate future reads. The host-teardown callback is the
// belt-and-braces step that releases the closed-over vault reference
// so a later re-unlock doesn't race against stale state.

import { clearSigningSecret } from './signingSecretSession.js';

/**
 * Raised when any step of the lock sequence failed. Every other step still
 * ran, so a caller that sees this knows teardown happened and that at least
 * one secret may have survived. `steps` names the failed stages and `causes`
 * carries the underlying errors for logging; neither holds a secret value.
 */
export class WalletLockIncompleteError extends Error {
    /**
     * @param {string[]} steps
     * @param {unknown[]} causes
     */
    constructor(steps, causes) {
        super(`Wallet lock incomplete: ${steps.join(', ')} failed.`);
        this.name = 'WalletLockIncompleteError';
        this.code = 'LOCK_INCOMPLETE';
        this.steps = steps;
        this.causes = causes;
    }
}

/**
 * @typedef {Object} WalletLockDeps
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} sessionBackend
 * @property {import('../storage/ChromeSessionBackend.js').ChromeSessionBackend} [signingSecretBackend]   cleared alongside the session key so no signing secret outlives the lock
 * @property {(result: { secretsCleared: boolean }) => Promise<void> | void} [onLocked]   told whether BOTH secret clears succeeded, so a shell can keep its auto-lock retry record when they did not
 */

/**
 * Lock the wallet. Each step is attempted independently and teardown always
 * runs: a bare await chain abandons the rest of the sequence on the first
 * rejection, so a failed session-key clear would leave the cached signing
 * secret in place AND skip `onLocked`, holding the vault open and the
 * SignerPool on seed material while the UI renders "locked".
 *
 * Throws `WalletLockIncompleteError` when anything failed, and only after
 * teardown has run, so no caller reads a partial lock as a clean one.
 *
 * @param {unknown} _request
 * @param {WalletLockDeps} deps
 * @returns {Promise<{ locked: true }>}
 * @throws {WalletLockIncompleteError} when a clear or the teardown failed
 */
export async function handleWalletLock(_request, deps) {
    /** @type {string[]} */
    const failedSteps = [];
    /** @type {unknown[]} */
    const causes = [];

    // Record a step's failure rather than abandoning the sequence.
    const attempt = async (step, run) => {
        try {
            await run();
            return true;
        } catch (err) {
            failedSteps.push(step);
            causes.push(err);
            console.error(`[xchain] wallet.lock: ${step} failed:`, err);
            return false;
        }
    };

    const sessionCleared = await attempt('sessionBackend.clear', () => deps.sessionBackend.clear());
    const signingCleared = await attempt(
        'clearSigningSecret',
        () => clearSigningSecret(deps.signingSecretBackend),
    );

    // Teardown must never be skipped: closing the vault and zeroing the
    // SignerPool is the one cleanup a surviving session key cannot undo.
    if (typeof deps.onLocked === 'function') {
        await attempt('onLocked', () => deps.onLocked({
            secretsCleared: sessionCleared && signingCleared,
        }));
    }

    if (failedSteps.length > 0) {
        throw new WalletLockIncompleteError(failedSteps, causes);
    }
    return { locked: true };
}

/**
 * @typedef {Object} LockBackstopDeps
 * @property {() => { sessionBackend: unknown, signingSecretBackend: unknown }} lockDeps   built per attempt, since an attempt can be retried
 * @property {() => void} tearDownHost                     release host + vault, zero the SignerPool
 * @property {() => boolean} isUnlocked                     shell still holds a host AND a vault
 * @property {() => Promise<unknown>} readAutoLockState
 * @property {() => Promise<void>} clearAutoLockState
 * @property {(state: unknown, now: number) => boolean} shouldAutoLock
 * @property {() => number} [now]
 * @property {{ log: Function, error: Function }} [logger]
 * @property {typeof handleWalletLock} [lock]               seam for tests; defaults to the real handler
 */

/**
 * Build the service worker's §26 auto-lock backstop.
 *
 * Lives here rather than inline in background.js because background.js
 * registers chrome.* listeners at module load and so cannot be imported by a
 * test: inline, the ordering this returns could only ever be asserted by
 * pattern-matching the source text, which pins the words and not the
 * behaviour.
 *
 * The ordering it exists to hold: `clearAutoLockState` runs only AFTER a lock
 * that fully succeeded. Clearing first (or on the way out of a rejecting lock)
 * discards the armed record that is the sole thing bringing the idle alarm
 * back, so a lock whose session-key clear threw left a live secret with
 * nothing scheduled to retry it. `cleanupPending` is the paired half: teardown
 * has already nulled host and vault, so the "already locked" guard would
 * otherwise refuse that very retry.
 *
 * @param {LockBackstopDeps} deps
 */
export function createLockBackstop(deps) {
    const now = deps.now ?? Date.now;
    const logger = deps.logger ?? console;
    const lock = deps.lock ?? handleWalletLock;

    // Set when a lock attempt failed to clear a secret; see above.
    let cleanupPending = false;

    async function lockWalletNow() {
        const { sessionBackend, signingSecretBackend } = deps.lockDeps();
        try {
            await lock(null, {
                sessionBackend,
                signingSecretBackend,
                onLocked: () => deps.tearDownHost(),
            });
        } catch (err) {
            cleanupPending = true;
            throw err;
        }
        cleanupPending = false;
        await deps.clearAutoLockState();
    }

    async function maybeAutoLock() {
        // Already locked; nothing to do, unless a previous lock left a secret
        // behind and is waiting on this alarm to retry the clear.
        if (!deps.isUnlocked() && !cleanupPending) return 'skipped';
        let state;
        try { state = await deps.readAutoLockState(); } catch { return 'skipped'; }
        if (!deps.shouldAutoLock(state, now())) return 'skipped';
        logger.log('[xchain] auto-lock: idle timeout reached, locking wallet');
        try {
            await lockWalletNow();
            return 'locked';
        } catch (err) {
            logger.error('[xchain] auto-lock lock failed:', err);
            return 'failed';
        }
    }

    // The dispatcher's own lock path (a popup-driven `wallet.lock`) reports
    // the same outcome, so it keeps the record on the same condition.
    function onLocked(result) {
        if (result?.secretsCleared === false) {
            cleanupPending = true;
        } else {
            cleanupPending = false;
            deps.clearAutoLockState().catch(() => { /* best-effort */ });
        }
        deps.tearDownHost();
    }

    // A session is legitimately live again, so any secret a previous failed
    // lock left behind is no longer something to chase.
    function noteUnlocked() {
        cleanupPending = false;
    }

    return {
        lockWalletNow,
        maybeAutoLock,
        onLocked,
        noteUnlocked,
        get cleanupPending() { return cleanupPending; },
    };
}
