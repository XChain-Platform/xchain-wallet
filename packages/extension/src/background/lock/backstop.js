// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The auto-lock backstop with its "a failed lock left a secret behind" marker
// kept in session storage, so a service worker evicted before the retry wakes
// knowing the clear is still owed instead of forgetting it with its memory.

import { clearSigningSecret } from '../signingSecretSession.js';

async function loadPending(ctx) {
    if (!ctx.deps.pendingStore) return;
    const revision = ctx.pendingRevision;
    try {
        const pending = await ctx.deps.pendingStore.load();
        if (ctx.pendingRevision === revision) ctx.cleanupPending = pending === true;
    } catch (err) {
        if (ctx.pendingRevision === revision) ctx.cleanupPending = true;
        ctx.logger.error('[xchain] auto-lock pending state could not be read:', err);
    }
}

// Saves run one at a time in call order, so the stored marker always ends at
// the newest in-memory value; overlapping saves could otherwise land out of
// order and hand a restarted worker the opposite of what this one holds.
async function setPending(ctx, pending) {
    ctx.pendingRevision += 1;
    const revision = ctx.pendingRevision;
    ctx.cleanupPending = pending;
    if (!ctx.deps.pendingStore) return true;
    const write = ctx.pendingWrites.then(() => ctx.deps.pendingStore.save(pending));
    ctx.pendingWrites = write.catch(() => { /* reported to its own caller */ });
    try {
        await write;
        return true;
    } catch (err) {
        ctx.logger.error('[xchain] auto-lock pending state could not be saved:', err);
        // A newer save queued behind this one decides what is stored.
        if (revision !== ctx.pendingRevision) return true;
        if (!pending) ctx.cleanupPending = true;
        return false;
    }
}

async function lockWalletNow(ctx) {
    await ctx.ready;
    const { sessionBackend, signingSecretBackend } = ctx.deps.lockDeps();
    try {
        await ctx.lock(null, {
            sessionBackend,
            signingSecretBackend,
            onLocked: () => ctx.deps.tearDownHost(),
        });
    } catch (err) {
        await setPending(ctx, true);
        throw err;
    }
    await setPending(ctx, false);
    await ctx.deps.clearAutoLockState();
}

// Retry a clear a failed lock left behind. The host is already torn down,
// so no deadline or in-flight request has anything left to hold open.
async function retryPendingClear(ctx) {
    await ctx.ready;
    if (!ctx.cleanupPending) return 'skipped';
    ctx.logger.log('[xchain] auto-lock: retrying the secret clear a failed lock left behind');
    try {
        await lockWalletNow(ctx);
        return 'locked';
    } catch (err) {
        ctx.logger.error('[xchain] auto-lock clear retry failed:', err);
        return 'failed';
    }
}

// A signing secret with no master key beside it is what a lock leaves when its
// marker save failed too; a locked worker clears it unless a session is starting.
async function sweepOrphanedSecret(ctx) {
    const generation = ctx.sessionGeneration;
    const { sessionBackend, signingSecretBackend } = ctx.deps.lockDeps();
    if (typeof signingSecretBackend?.load !== 'function') return;
    let signingSecret = null;
    let masterKey = null;
    try {
        signingSecret = await signingSecretBackend.load();
        if (!signingSecret) return;
        masterKey = await sessionBackend.load();
        if (masterKey || generation !== ctx.sessionGeneration || ctx.deps.isUnlocked()) return;
        await clearSigningSecret(signingSecretBackend);
    } catch (err) {
        ctx.logger.error('[xchain] orphaned signing secret sweep failed:', err);
    } finally {
        signingSecret?.fill?.(0);
        masterKey?.fill?.(0);
    }
}

// Status reads the flag only once the persisted marker has loaded; before that
// it holds the fail-closed default, which a live cold worker would report as locked.
async function isLockPending(ctx) {
    await ctx.ready;
    return ctx.cleanupPending === true;
}

function unlockIsSettling(ctx, at) {
    const started = ctx.unlockSettlingSince;
    return started !== null && at >= started && at - started < ctx.ceilingMs;
}

async function maybeAutoLock(ctx) {
    await ctx.ready;
    if (ctx.cleanupPending) return retryPendingClear(ctx);
    if (!ctx.deps.isUnlocked()) {
        await sweepOrphanedSecret(ctx);
        return 'skipped';
    }
    // A record storage cannot read, or a live session with none at all, is a
    // deadline this worker cannot enforce, so it locks rather than leaving the
    // session open for good; an unlock still writing its record is the exception.
    let unreadable = false;
    let state;
    try { state = await ctx.deps.readAutoLockState(); } catch { unreadable = true; }
    const missing = !unreadable && state == null;
    if (missing && unlockIsSettling(ctx, ctx.now())) return 'deferred';
    if (!missing && !unreadable && !ctx.deps.shouldAutoLock(state, ctx.now())) return 'skipped';
    // A due lock waits for in-flight signing work. The request tracker
    // stops counting a request after its ceiling, so a hung one cannot
    // hold the wallet open for good.
    if (ctx.deps.isRequestActive?.()) return 'deferred';
    ctx.logger.log(unreadable
        ? '[xchain] auto-lock: record unreadable, locking wallet'
        : missing
            ? '[xchain] auto-lock: live session has no auto-lock record, locking wallet'
            : '[xchain] auto-lock: idle timeout reached, locking wallet');
    try {
        await lockWalletNow(ctx);
        return 'locked';
    } catch (err) {
        ctx.logger.error('[xchain] auto-lock lock failed:', err);
        return 'failed';
    }
}

// The dispatcher's own lock path (a popup-driven `wallet.lock`) reports the
// same outcome; the reply waits for the teardown, which may first hand armed
// auto pay to its locked session.
async function onLocked(ctx, result) {
    const failed = result?.secretsCleared === false;
    const persistence = setPending(ctx, failed);
    const record = failed
        ? Promise.resolve()
        : ctx.deps.clearAutoLockState().catch(() => { /* best-effort */ });
    const teardown = Promise.resolve(ctx.deps.tearDownHost());
    await Promise.all([persistence, record, teardown]);
}

// A stale marker a fresh unlock cannot clear would make the next worker read
// the live session as locked and wipe it, so the unlock is refused instead.
async function noteUnlocked(ctx) {
    ctx.unlockSettlingSince = ctx.now();
    if (!await setPending(ctx, false)) {
        throw new Error('Auto-lock cleanup state could not be reset.');
    }
}

/**
 * @param {import('../walletLock.js').LockBackstopDeps} deps
 * @param {Function} lock                  the wallet.lock handler
 * @param {number} ceilingMs               how long an unlock may take to write its record
 * @param {() => Promise<string>} checkRestoreDeadline   the restored-host deadline read
 */
export function createPersistentLockBackstop(deps, lock, ceilingMs, checkRestoreDeadline) {
    const ctx = {
        deps,
        lock,
        ceilingMs,
        now: deps.now ?? Date.now,
        logger: deps.logger ?? console,
        // Fail closed until the stored marker is read: a cold worker must not
        // rebuild a host from a key a refused lock left behind.
        cleanupPending: Boolean(deps.pendingStore),
        pendingRevision: 0,
        pendingWrites: Promise.resolve(),
        sessionGeneration: 0,
        unlockSettlingSince: null,
        ready: null,
    };
    ctx.ready = loadPending(ctx);
    return {
        checkRestoreDeadline,
        lockWalletNow: () => lockWalletNow(ctx),
        maybeAutoLock: () => maybeAutoLock(ctx),
        onLocked: (result) => onLocked(ctx, result),
        noteUnlocked: () => noteUnlocked(ctx),
        noteUnlockSettled: () => { ctx.unlockSettlingSince = null; },
        noteSessionStarting: () => { ctx.sessionGeneration += 1; },
        retryPendingClear: () => retryPendingClear(ctx),
        whenReady: () => ctx.ready,
        isLockPending: () => isLockPending(ctx),
        get cleanupPending() { return ctx.cleanupPending; },
    };
}
