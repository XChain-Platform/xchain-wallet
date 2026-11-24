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
import { AUTO_LOCK_REQUEST_CEILING_MS } from '@xchain-wallet/core/shared/hooks/autoLockGuard.js';
import { createPersistentLockBackstop } from './lock/backstop.js';

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
 * Clear an earlier session's idle deadline before the unlocked UI can arm a
 * new one. Waiting here prevents a slow storage removal from deleting the new
 * record after the UI receives the successful unlock response.
 *
 * @param {{ clearAutoLockState: () => Promise<void>, continueUnlock: () => Promise<unknown> }} deps
 * @returns {Promise<unknown>}
 */
export async function sequenceUnlockedSession(deps) {
    await deps.clearAutoLockState();
    return deps.continueUnlock();
}

// The ceiling is shared with the foreground hold in core.
export { AUTO_LOCK_REQUEST_CEILING_MS };

// Requests that sign or broadcast. A due idle lock waits for one of these to
// settle, the same work the foreground hook holds its lock for. A read never
// holds it: offline, a balance read the closed popup left behind waits on the
// network, and the lock must not wait with it.
const LOCK_HOLDING_REQUEST = /^(action\.|auth\.sign|broadcast\.(signedTx|queue\.broadcast)$|multisigSign\.)/;

/**
 * Whether a trusted UI request of this type holds a due idle lock.
 *
 * @param {unknown} type
 * @returns {boolean}
 */
export function requestHoldsAutoLock(type) {
    return typeof type === 'string' && LOCK_HOLDING_REQUEST.test(type);
}

/**
 * Read the persisted idle deadline before a restored host is published.
 * Missing, disarmed and unexpired records are valid; unreadable and expired
 * records require the caller to lock the restored session.
 *
 * @param {{ readAutoLockState: () => Promise<unknown>, shouldAutoLock: (state: unknown, now: number) => boolean, now?: () => number }} deps
 * @returns {Promise<'valid' | 'expired' | 'unreadable'>}
 */
export async function checkAutoLockDeadline(deps) {
    let state;
    try {
        state = await deps.readAutoLockState();
    } catch {
        return 'unreadable';
    }
    return deps.shouldAutoLock(state, (deps.now ?? Date.now)()) ? 'expired' : 'valid';
}

/**
 * Finish a restored-session deadline check without letting a superseded
 * result lock a newer session.
 *
 * @param {{ masterKey: Uint8Array, checkDeadline: () => Promise<string>, isCurrent: () => boolean, lockWalletNow: () => Promise<void>, logger?: { error: Function } }} deps
 * @returns {Promise<string>}
 */
export async function gateRestoredSession(deps) {
    const deadline = await deps.checkDeadline();
    if (!deps.isCurrent()) {
        deps.masterKey.fill(0);
        return 'superseded';
    }
    if (deadline === 'valid') return deadline;
    deps.masterKey.fill(0);
    try {
        await deps.lockWalletNow();
    } catch (err) {
        (deps.logger ?? console).error('[xchain] restored-session auto-lock failed:', err);
    }
    return deadline;
}

/**
 * Track the trusted UI requests in flight that hold a due idle lock. `begin`
 * runs once per request and returns its completion callback. A request holds
 * the lock from its start until it ends or `ceilingMs` passes, whichever
 * comes first.
 *
 * @param {{ now?: () => number, ceilingMs?: number }} [opts]
 * @returns {{ begin: (type: unknown) => () => void, isActive: () => boolean }}
 */
export function createUiRequestTracker(opts = {}) {
    const now = opts.now ?? Date.now;
    const ceilingMs = opts.ceilingMs ?? AUTO_LOCK_REQUEST_CEILING_MS;
    /** @type {Set<{ startedAt: number }>} */
    const inFlight = new Set();
    return {
        begin(type) {
            if (!requestHoldsAutoLock(type)) return () => {};
            const entry = { startedAt: now() };
            inFlight.add(entry);
            return () => { inFlight.delete(entry); };
        },
        isActive() {
            const at = now();
            for (const entry of inFlight) {
                if (at - entry.startedAt < ceilingMs) return true;
                // Past the ceiling the request stops holding and is dropped.
                inFlight.delete(entry);
            }
            return false;
        },
    };
}

/**
 * @typedef {Object} LockBackstopDeps
 * @property {() => { sessionBackend: unknown, signingSecretBackend: unknown }} lockDeps   built per attempt, since an attempt can be retried
 * @property {() => void} tearDownHost                     release host + vault, zero the SignerPool
 * @property {() => boolean} isUnlocked                     shell still holds a host AND a vault
 * @property {() => boolean} [isRequestActive]              trusted UI work that must settle before locking
 * @property {() => Promise<unknown>} readAutoLockState
 * @property {() => Promise<void>} clearAutoLockState
 * @property {(state: unknown, now: number) => boolean} shouldAutoLock
 * @property {{ load: () => Promise<boolean>, save: (pending: boolean) => Promise<void> }} [pendingStore]   where the failed-clear marker outlives the worker
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
 * While a clear is pending the session key may still be in storage, so the
 * worker must read as locked: a host build reads `cleanupPending` and builds
 * nothing from that key, and the next tick retries the clear whether or not
 * an idle deadline is due. With a `pendingStore` the flag outlives the worker,
 * so an eviction before the retry cannot forget the clear (lock/backstop.js).
 *
 * @param {LockBackstopDeps} deps
 */
export function createLockBackstop(deps) {
    const checkRestoreDeadline = () => checkAutoLockDeadline({
        readAutoLockState: deps.readAutoLockState,
        shouldAutoLock: deps.shouldAutoLock,
        now: deps.now ?? Date.now,
    });
    return createPersistentLockBackstop(
        deps,
        deps.lock ?? handleWalletLock,
        AUTO_LOCK_REQUEST_CEILING_MS,
        checkRestoreDeadline,
    );
}

/**
 * Share one in-flight host build among overlapping callers, so none orphans a Vault or listener.
 * A caller that joined a build which found no session builds once more (it may be the unlock).
 * @template T
 * @param {() => Promise<T | null>} build
 * @returns {() => Promise<T | null>}
 */
export function createHostBuildFlight(build) {
    /** @type {Promise<T | null> | null} */
    let inFlight = null;
    const start = () => {
        if (!inFlight) inFlight = build().finally(() => { inFlight = null; });
        return inFlight;
    };
    return async function ensure() {
        const joined = inFlight !== null;
        const result = await start();
        return result == null && joined ? start() : result;
    };
}

/**
 * Build the MV3 keepalive tick: rebuild the host, run the idle-lock check, then refresh.
 * The lock check never waits on the refresh (its socket connects carry no timeout),
 * and a rejected host build or refresh never skips it.
 * @param {{ ensureHost: () => Promise<unknown>, maybeAutoLock: () => Promise<string>,
 *   refresh: () => unknown, logger?: { error: Function } }} deps
 * @returns {() => Promise<string>} resolves to the idle-lock outcome
 */
export function createKeepaliveTick(deps) {
    const logger = deps.logger ?? console;
    return async function keepaliveTick() {
        // Run the check after the host rebuild: a cold worker reads locked until then.
        try { await deps.ensureHost(); } catch (err) { logger.error('[xchain] keepalive ensureHost failed:', err); }
        let outcome = 'failed';
        try { outcome = await deps.maybeAutoLock(); } catch (err) { logger.error('[xchain] keepalive auto-lock failed:', err); }
        // Fire the refresh unawaited; a session that just locked has nothing to refresh.
        if (outcome !== 'locked') {
            Promise.resolve().then(deps.refresh)
                .catch((err) => logger.error('[xchain] keepalive refresh failed:', err));
        }
        return outcome;
    };
}
