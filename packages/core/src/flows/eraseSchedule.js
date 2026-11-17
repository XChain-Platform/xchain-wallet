// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Forgot Password's "Erase everything" waits 48 hours (operator ruling
// 2026-11-16). Anyone at the lock screen could otherwise destroy a wallet,
// imported private keys included, that no phrase brings back. Typing WIPE only
// schedules the erase; the lock screen shows it with the time left and a
// Cancel Erase that needs the password, any successful unlock cancels it, and
// once the hold has passed the next app start with no unlock performs it.
//
// The schedule is pre-unlock state read on the lock screen, the same kind as
// the lockout ladder, so it is stored the same way: localStorage by default,
// and on the native shells the guard slot (web/src/storage/nativeGuards.js),
// injected through configureEraseSchedulePersistence. Losing the record only
// ever cancels an erase; it can never cause one.
//
// The hold trusts the device clock. Setting the clock forward moves the due
// time closer; that needs the unlocked device's settings, which the person at
// the lock screen may have, so the hold is a delay, not a guarantee.
//
// A cancel must stay cancelled (security review 2026-11-16). It throws when
// the store refuses the clear, and it first leaves a marker in localStorage
// naming the schedule it cancels. The due erase goes through ONE gate,
// shouldRunDueErase: it re-reads every store the record could live in, skips
// on a marker, a missing record or a disagreeing copy, never runs in a boot
// whose native guard store failed to load, and never while any tab holds the
// web vault lease (an unlocked session elsewhere). runDueErase also holds
// that lease for the wipe itself, so no tab can unlock halfway through.

export const ERASE_HOLD_MS = 48 * 60 * 60 * 1000;
export const ERASE_SCHEDULE_STORAGE_KEY = 'xchain-wallet:erase-schedule';
/** localStorage marker `{ scheduledAt }` naming the schedule a cancel ended. */
export const ERASE_CANCELLED_STORAGE_KEY = 'xchain-wallet:erase-cancelled';
/**
 * The Web Locks name an unlocked web session holds for its whole life
 * (web/src/hostBridge.js). Core owns it so the erase gate and the lease agree.
 */
export const VAULT_SESSION_LOCK_NAME = 'xchain-wallet:vault-session';

/** The store refused the clear, so the erase is still scheduled. */
export class EraseCancelError extends Error {
    /** @param {unknown} [cause] */
    constructor(cause) {
        super('Could not cancel the scheduled erase on this device. Try again.');
        this.name = 'EraseCancelError';
        this.cause = cause;
    }
}

/**
 * @typedef {Object} EraseSchedule
 * @property {number} scheduledAt   epoch ms
 * @property {number} dueAt         epoch ms
 */

/**
 * `reload`, when present, reads the backing store itself rather than a cache
 * the store keeps (the native guard view's `load` answers from its boot cache).
 * @type {{ load: () => Promise<unknown>, reload?: () => Promise<unknown>, save: (s: EraseSchedule) => Promise<void>, clear: () => Promise<void> } | null}
 */
let persistentStore = null;
/** @type {EraseSchedule | null} */
let cache = null;
// Set when this boot's native guard store failed to load: the record that
// would decide the erase cannot be read, so no erase runs this boot.
let guardUnavailable = false;

function getStorage() {
    try {
        if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
            return globalThis.localStorage;
        }
    } catch {
        // SecurityError on cross-origin frames: no schedule can be kept.
    }
    return null;
}

/**
 * Untrusted stored value to a schedule, or null.
 * @param {unknown} raw
 * @returns {EraseSchedule | null}
 */
function coerce(raw) {
    const r = /** @type {any} */ (raw);
    if (!r || !Number.isFinite(r.scheduledAt) || !Number.isFinite(r.dueAt)) return null;
    if (r.scheduledAt <= 0 || r.dueAt <= r.scheduledAt) return null;
    // This code writes exactly one hold. Further out is not its record, and
    // shorter would let a planted record skip the 48-hour wait.
    if (r.dueAt - r.scheduledAt > ERASE_HOLD_MS) return null;
    if (r.dueAt - r.scheduledAt < ERASE_HOLD_MS) return null;
    return { scheduledAt: Math.floor(r.scheduledAt), dueAt: Math.floor(r.dueAt) };
}

/** @param {string | null} raw */
function parseStored(raw) {
    if (!raw) return null;
    try {
        return coerce(JSON.parse(raw));
    } catch {
        return null;
    }
}

/** @param {EraseSchedule | null} a @param {EraseSchedule | null} b */
function sameSchedule(a, b) {
    return Boolean(a && b) && a.scheduledAt === b.scheduledAt && a.dueAt === b.dueAt;
}

/**
 * Wire the native guard slot and hydrate from it. Await before the lock
 * screen mounts, as with the lockout ladder.
 *
 * @param {{ load: () => Promise<unknown>, save: (s: EraseSchedule) => Promise<void>, clear: () => Promise<void> } | null} store
 */
export async function configureEraseSchedulePersistence(store) {
    persistentStore = store || null;
    cache = null;
    if (!persistentStore) return;
    try {
        cache = coerce(await persistentStore.load());
    } catch {
        cache = null;
    }
}

/** @returns {EraseSchedule | null} */
export function getEraseSchedule() {
    if (persistentStore) return cache;
    const storage = getStorage();
    if (!storage) return null;
    try {
        const raw = storage.getItem(ERASE_SCHEDULE_STORAGE_KEY);
        return raw ? coerce(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

/**
 * Schedule the erase ERASE_HOLD_MS from now. A schedule already standing is
 * kept as it is: typing WIPE again must not push the due time out or pull it in.
 *
 * @param {number} [nowMs]
 * @returns {Promise<EraseSchedule>}
 */
export async function scheduleErase(nowMs = Date.now()) {
    const existing = getEraseSchedule();
    if (existing) return existing;
    const schedule = { scheduledAt: nowMs, dueAt: nowMs + ERASE_HOLD_MS };
    if (persistentStore) {
        await persistentStore.save(schedule);
        cache = schedule;
        return schedule;
    }
    const storage = getStorage();
    if (!storage) throw new Error('This device cannot keep an erase schedule.');
    storage.setItem(ERASE_SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
    return schedule;
}

/**
 * Cancel a scheduled erase. The cancel marker goes into localStorage first, so
 * a due erase that finds it never runs even when the clear does not land; the
 * localStorage copy goes too (on a native shell it can only be a legacy copy a
 * failed migration left, which the next boot would adopt again).
 *
 * @returns {Promise<boolean>}  true when one was scheduled
 * @throws {EraseCancelError} when an erase was scheduled and its store refused the
 *   clear: the erase still shows as scheduled, and the caller says so
 */
export async function cancelEraseSchedule() {
    const existing = getEraseSchedule();
    const storage = getStorage();
    if (existing && storage) {
        try {
            storage.setItem(ERASE_CANCELLED_STORAGE_KEY, JSON.stringify({ scheduledAt: existing.scheduledAt }));
        } catch { /* the clear below decides the outcome */ }
    }
    let localFailure = null;
    try {
        storage?.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
    } catch (err) {
        localFailure = err;
    }
    if (persistentStore) {
        try {
            await persistentStore.clear();
        } catch (err) {
            if (existing) throw new EraseCancelError(err);
            return false;
        }
        cache = null;
        return existing !== null;
    }
    if (existing && localFailure) throw new EraseCancelError(localFailure);
    return existing !== null;
}

/** Called when this boot's native guard store failed to load: no due erase runs this boot. */
export function markEraseGuardUnavailable() {
    guardUnavailable = true;
}

/** @param {Storage | null} storage @param {EraseSchedule} schedule */
function cancelledByMarker(storage, schedule) {
    try {
        const raw = storage?.getItem(ERASE_CANCELLED_STORAGE_KEY);
        if (!raw) return false;
        return /** @type {any} */ (JSON.parse(raw))?.scheduledAt === schedule.scheduledAt;
    } catch {
        // An unreadable marker may be a cancel: hold the erase.
        return true;
    }
}

/** Whether any tab of this origin holds the unlocked web session's lease. */
async function vaultLeaseHeld() {
    const locks = /** @type {any} */ (globalThis.navigator)?.locks;
    if (!locks || typeof locks.query !== 'function') return false;
    try {
        const { held = [] } = await locks.query();
        return held.some((lock) => lock?.name === VAULT_SESSION_LOCK_NAME);
    } catch {
        return true;
    }
}

/**
 * The one gate before a due erase. Re-reads every store the record could live
 * in instead of trusting this boot's copy: on a native shell the guard slot
 * itself (it must still hold this record) and any legacy localStorage copy
 * (absent, or the same record), on web the localStorage record. Skips on a
 * cancel marker for this schedule, in a boot whose native guard store failed
 * to load, and while any tab holds the vault lease.
 *
 * @param {number} [nowMs]
 * @returns {Promise<boolean>}
 */
export async function shouldRunDueErase(nowMs = Date.now()) {
    if (guardUnavailable) return false;
    const expected = getEraseSchedule();
    if (!expected || !isEraseDue(expected, nowMs)) return false;
    const storage = getStorage();
    if (cancelledByMarker(storage, expected)) return false;
    let local;
    try {
        local = storage?.getItem(ERASE_SCHEDULE_STORAGE_KEY) ?? null;
    } catch {
        return false;
    }
    if (persistentStore) {
        let stored;
        try {
            stored = coerce(await (persistentStore.reload ?? persistentStore.load)());
        } catch {
            return false;
        }
        if (!sameSchedule(stored, expected)) return false;
        if (local !== null && !sameSchedule(parseStored(local), expected)) return false;
    } else if (!sameSchedule(parseStored(local), expected)) {
        return false;
    }
    return !(await vaultLeaseHeld());
}

/**
 * Run `wipe` for a due erase, only if shouldRunDueErase passes and, where Web
 * Locks exist, while holding the vault lease, so no tab unlocks mid-wipe.
 * Never nest this inside another holder of the lease: Web Locks do not re-enter.
 *
 * @param {() => Promise<void>} wipe
 * @param {number} [nowMs]
 * @returns {Promise<boolean>}  true when the wipe ran
 */
export async function runDueErase(wipe, nowMs = Date.now()) {
    if (!(await shouldRunDueErase(nowMs))) return false;
    const locks = /** @type {any} */ (globalThis.navigator)?.locks;
    if (!locks || typeof locks.request !== 'function') {
        await wipe();
        return true;
    }
    return locks.request(VAULT_SESSION_LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) return false;
        await wipe();
        return true;
    });
}

/** @param {EraseSchedule | null} schedule @param {number} [nowMs] */
export function eraseRemainingMs(schedule, nowMs = Date.now()) {
    if (!schedule) return 0;
    return Math.max(0, schedule.dueAt - nowMs);
}

/** @param {EraseSchedule | null} schedule @param {number} [nowMs] */
export function isEraseDue(schedule, nowMs = Date.now()) {
    return Boolean(schedule) && nowMs >= /** @type {EraseSchedule} */ (schedule).dueAt;
}

/** Test seam. */
export function __resetEraseScheduleForTests() {
    persistentStore = null;
    cache = null;
    guardUnavailable = false;
}
