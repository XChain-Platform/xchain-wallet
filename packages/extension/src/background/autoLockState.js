// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Background auto-lock backstop state (§26).
//
// The foreground `useAutoLock` hook locks the wallet on idle while a popup /
// tab is OPEN, but the extension popup is destroyed the moment it closes, so
// its timer stops and a configured idle timeout never fires while the popup is
// closed (the unlocked session key lives on in the service worker until the
// browser closes). This module is the closed-popup backstop:
//
//   - the foreground ARMS it (armed + idleMs) whenever auto-lock is active for
//     the current wallet, and DISARMS it when auto-lock is off (e.g. a demo
//     wallet, which the foreground deliberately never auto-locks); the SW
//     cannot itself tell whether the active wallet is a demo (that id lives in
//     the popup's localStorage), so it trusts the foreground's arm decision.
//   - the background stamps `lastActivity` from real UI message traffic.
//   - a periodic alarm calls `shouldAutoLock` and locks when armed + idle.
//
// State lives in chrome.storage.session: it survives service-worker eviction
// within the browser session (so the alarm keeps working across SW restarts)
// but is cleared on browser close, the same lifetime as the session key.
//
// The backstop fails closed. A record storage cannot read or that has no
// enforceable armed deadline throws AutoLockStateUnreadableError, so the alarm
// locks. An arm with no usable idle window, or one storage refuses, reports
// `saved: false` so the route locks.

import { provisionalAutoLockSignal } from '@xchain-wallet/core/shared/hooks/autoLockGuard.js';

const KEY = 'xchain:autolock';

// The session.autolock reply reason for an arm storage refused; the shared
// useAutoLockPolicy hook reads the same literal.
export const AUTO_LOCK_UNSAVED = 'auto-lock-unsaved';

// Ordinary clock corrections (NTP steps, a second device syncing) stay well
// inside this; anything larger is treated as a clock set backwards.
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;

function sessionArea() {
    return globalThis.chrome?.storage?.session ?? null;
}

/**
 * @typedef {Object} AutoLockState
 * @property {boolean} armed          foreground says auto-lock applies to the active wallet
 * @property {number} idleMs          idle threshold (already clamped by the foreground)
 * @property {number} lastActivity    ms epoch of the last observed UI activity
 * @property {number} [armedAt]       ms epoch the surface issued the arm on record,
 *                                    so a disarm issued before it cannot undo it
 */

// The state this worker last set that storage refused to take, or undefined
// when storage holds everything this worker set. A refused arm would otherwise
// leave the alarm reading no record and never locking, while the popup that
// sent the arm believes the backstop is set. Kept per worker: a restart drops
// it along with every other in-memory copy.
/** @type {AutoLockState | null | undefined} */
let unsavedState;

/** Storage refused the read, so the armed deadline is unknown. */
export class AutoLockStateUnreadableError extends Error {
    constructor(cause) {
        super('auto-lock record could not be read');
        this.name = 'AutoLockStateUnreadableError';
        this.cause = cause;
    }
}

/** Storage returned a record that cannot enforce the promised deadline. */
export class AutoLockStateMalformedError extends AutoLockStateUnreadableError {
    constructor() {
        super(new Error('malformed auto-lock record'));
        this.name = 'AutoLockStateMalformedError';
        this.message = 'auto-lock record is malformed';
    }
}

/**
 * Null means no record. A read storage refuses throws
 * AutoLockStateUnreadableError rather than reading as no record, which would
 * leave a restarted worker with no deadline to enforce.
 *
 * @returns {Promise<AutoLockState | null>}
 */
export async function readAutoLockState() {
    if (unsavedState !== undefined) return unsavedState ? { ...unsavedState } : null;
    const area = sessionArea();
    if (!area) return null;
    let got;
    try {
        got = await area.get(KEY);
    } catch (err) {
        throw new AutoLockStateUnreadableError(err);
    }
    const v = got?.[KEY];
    if (v === undefined) return null;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        throw new AutoLockStateMalformedError();
    }
    if (typeof v.armed !== 'boolean') throw new AutoLockStateMalformedError();
    if (v.armed === true) {
        if (!Number.isFinite(v.idleMs) || v.idleMs <= 0) throw new AutoLockStateMalformedError();
        if (!Number.isFinite(v.lastActivity) || v.lastActivity <= 0) throw new AutoLockStateMalformedError();
    }
    if (v.armedAt !== undefined && !Number.isFinite(v.armedAt)) {
        throw new AutoLockStateMalformedError();
    }
    /** @type {AutoLockState} */
    const state = {
        armed: v.armed,
        idleMs: Number.isFinite(v.idleMs) ? v.idleMs : 0,
        lastActivity: Number.isFinite(v.lastActivity) ? v.lastActivity : 0,
    };
    if (Number.isFinite(v.armedAt)) state.armedAt = v.armedAt;
    return state;
}

// The read the writers below start from; an unreadable record reads as absent
// there, since each of them writes a whole record anyway.
async function readForUpdate() {
    try {
        return await readAutoLockState();
    } catch {
        return null;
    }
}

/** @returns {Promise<boolean>} whether storage took the record */
async function writeAutoLockState(next) {
    const area = sessionArea();
    if (!area) return true;
    try {
        await area.set({ [KEY]: next });
        unsavedState = undefined;
        return true;
    } catch {
        unsavedState = { ...next };
        return false;
    }
}

/**
 * Arm or disarm the backstop. A newly armed session starts a full idle window.
 * Updating an armed session keeps its activity stamp so a shorter timeout
 * takes effect against idle time that has already elapsed.
 *
 * Resolves `saved: false` only for an arm storage refused. A refused
 * disarm or activity stamp stays in this worker's memory: the record left in
 * storage then locks a restarted worker sooner, never later.
 *
 * `issuedAt` is when the surface issued the signal, kept across its retries.
 * A disarm issued before the arm on record changes nothing: it is a retry
 * that reached the worker after a newer arm, typically one the Locked screen
 * sent while the worker had no host and that landed after the unlock rebuilt
 * it. An arm is never refused on its stamp, so a clock set backwards can
 * only keep a session armed, never leave one disarmed.
 *
 * @param {{ armed: boolean, idleMs?: number, activity?: boolean, issuedAt?: number }} signal
 * @param {number} now
 * @returns {Promise<{ saved: boolean }>}
 */
export async function applyAutoLockSignal(signal, now) {
    const issuedAt = Number.isFinite(signal?.issuedAt) ? Number(signal.issuedAt) : null;
    if (!signal || signal.armed !== true) {
        if (issuedAt !== null) {
            const current = await readForUpdate();
            if (current?.armed && typeof current.armedAt === 'number' && issuedAt < current.armedAt) {
                return { saved: true };
            }
        }
        // Disarm: keep the record but flip armed off so the alarm no-ops.
        await writeAutoLockState({ armed: false, idleMs: 0, lastActivity: now });
        return { saved: true };
    }
    const idleMs = Number(signal.idleMs);
    if (!Number.isFinite(idleMs) || idleMs <= 0) {
        return { saved: signal.activity === true };
    }
    const current = await readForUpdate();
    if (signal.activity === true && !current?.armed) return { saved: true };
    let lastActivity = now;
    if (signal.activity !== true && current?.armed && current.lastActivity > 0) {
        lastActivity = current.lastActivity;
    }
    // An activity report keeps the arm stamp; an arm moves it forward only.
    const priorArmedAt = current?.armed && typeof current.armedAt === 'number' ? current.armedAt : null;
    let armedAt = priorArmedAt;
    if (signal.activity !== true && issuedAt !== null) {
        armedAt = priorArmedAt === null ? issuedAt : Math.max(priorArmedAt, issuedAt);
    }
    /** @type {AutoLockState} */
    const next = {
        armed: true,
        idleMs,
        lastActivity,
    };
    if (armedAt !== null) next.armedAt = armedAt;
    const written = await writeAutoLockState(next);
    return { saved: written || signal.activity === true };
}

/**
 * Record the deadline an unlocked session carries until a foreground reports:
 * the popup that would arm it can close mid-unlock, or sit on a screen that
 * never reaches the unlocked state, and a session with no record never locks.
 * The first settled report overwrites this one, so Never and a demo wallet
 * still disarm on the normal path.
 *
 * Settings the reader cannot return take the default window rather than no
 * deadline.
 *
 * @param {() => unknown} readSettings
 * @param {number} now
 * @returns {Promise<{ saved: boolean }>}
 */
export async function armProvisionalAutoLock(readSettings, now) {
    let settings = null;
    try { settings = await readSettings(); } catch { /* default window */ }
    return applyAutoLockSignal(provisionalAutoLockSignal(settings), now);
}

/**
 * Record UI activity (a message from the trusted extension UI). Only touches
 * `lastActivity`; leaves armed/idleMs untouched. No-ops when unarmed so a
 * disarmed session doesn't accumulate writes.
 *
 * @param {number} now
 */
export async function stampAutoLockActivity(now) {
    const state = await readForUpdate();
    if (!state || !state.armed) return;
    await writeAutoLockState({ ...state, lastActivity: now });
}

/** Clear the backstop entirely (on lock). */
export async function clearAutoLockState() {
    const area = sessionArea();
    if (!area) return;
    try {
        await area.remove(KEY);
        unsavedState = undefined;
    } catch {
        // Read as cleared, as asked: the earlier deadline left in storage
        // would otherwise lock the next session the moment it unlocks.
        unsavedState = null;
    }
}

/**
 * Pure decision: should the backstop lock the wallet now? Locks only when the
 * foreground armed it with a positive idle threshold and the idle window has
 * elapsed since the last observed activity. A null/absent/disarmed state, a
 * non-positive idleMs, or a missing activity stamp never locks.
 *
 * @param {AutoLockState | null} state
 * @param {number} now
 * @returns {boolean}
 */
export function shouldAutoLock(state, now) {
    if (!state || state.armed !== true) return false;
    if (!(typeof state.idleMs === 'number' && state.idleMs > 0)) return false;
    if (!(typeof state.lastActivity === 'number' && state.lastActivity > 0)) return false;
    // A stamp ahead of the clock means the wall clock moved backwards since it
    // was written, so the idle time cannot be measured. Locking is the safe
    // answer: waiting for the clock to catch up would keep the session open
    // for as long as the clock was set back.
    if (state.lastActivity - now > CLOCK_ROLLBACK_TOLERANCE_MS) return true;
    return now - state.lastActivity >= state.idleMs;
}
