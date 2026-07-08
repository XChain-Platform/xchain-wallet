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

const KEY = 'xchain:autolock';

function sessionArea() {
    return globalThis.chrome?.storage?.session ?? null;
}

/**
 * @typedef {Object} AutoLockState
 * @property {boolean} armed          foreground says auto-lock applies to the active wallet
 * @property {number} idleMs          idle threshold (already clamped by the foreground)
 * @property {number} lastActivity    ms epoch of the last observed UI activity
 */

/** @returns {Promise<AutoLockState | null>} */
export async function readAutoLockState() {
    const area = sessionArea();
    if (!area) return null;
    try {
        const got = await area.get(KEY);
        const v = got?.[KEY];
        if (!v || typeof v !== 'object') return null;
        return {
            armed: v.armed === true,
            idleMs: typeof v.idleMs === 'number' ? v.idleMs : 0,
            lastActivity: typeof v.lastActivity === 'number' ? v.lastActivity : 0,
        };
    } catch {
        return null;
    }
}

async function writeAutoLockState(next) {
    const area = sessionArea();
    if (!area) return;
    try { await area.set({ [KEY]: next }); } catch { /* best-effort */ }
}

/**
 * Arm or disarm the backstop. Arming also stamps `lastActivity = now` so the
 * user always gets a full idle window after arming (never an immediate lock).
 *
 * @param {{ armed: boolean, idleMs?: number }} signal
 * @param {number} now
 */
export async function applyAutoLockSignal(signal, now) {
    if (!signal || signal.armed !== true) {
        // Disarm: keep the record but flip armed off so the alarm no-ops.
        await writeAutoLockState({ armed: false, idleMs: 0, lastActivity: now });
        return;
    }
    const idleMs = Number(signal.idleMs);
    await writeAutoLockState({
        armed: true,
        idleMs: Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 0,
        lastActivity: now,
    });
}

/**
 * Record UI activity (a message from the trusted extension UI). Only touches
 * `lastActivity`; leaves armed/idleMs untouched. No-ops when unarmed so a
 * disarmed session doesn't accumulate writes.
 *
 * @param {number} now
 */
export async function stampAutoLockActivity(now) {
    const state = await readAutoLockState();
    if (!state || !state.armed) return;
    await writeAutoLockState({ ...state, lastActivity: now });
}

/** Clear the backstop entirely (on lock). */
export async function clearAutoLockState() {
    const area = sessionArea();
    if (!area) return;
    try { await area.remove(KEY); } catch { /* best-effort */ }
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
    return now - state.lastActivity >= state.idleMs;
}
