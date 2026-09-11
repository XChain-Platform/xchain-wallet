// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// FileAutoLockStore (§26): the desktop parallel of the extension's
// chrome.storage.session auto-lock record, and it has to survive a QUIT.
//
// Why desktop needs one at all. The shell caches the vault master key
// safeStorage-encrypted in `session.bin`, `before-quit` deliberately leaves
// that file behind, and `ensureHost` re-opens the vault from it at the next
// launch with no password. Nothing on that path consulted the user's
// `autolockMinutes`: the foreground hook's timer dies with the renderer and
// desktop had no wall-clock backstop, so someone who set a 15-minute
// auto-lock and quit got an unlocked vault back hours or weeks later.
//
// The extension's record lives in chrome.storage.session, which dies with
// the browser, and that is exactly the lifetime desktop cannot borrow: the
// question here is what happened ACROSS process life, so the stamp has to
// outlive the process. Hence a file, with the same mechanics as
// FileUnlockThrottleStore (atomic tmp-write + rename, mode 0600, a reader
// that tolerates a missing or corrupt file by returning null).
//
// The pure decision stays shared: `shouldAutoLock(state, now)` is imported
// from the extension module rather than reimplemented, so the two shells
// cannot drift on what "idle" means.
//
// The file is plaintext and discloses the idle threshold and a last-use
// time to anyone reading the same OS account. That is strictly less than
// the encrypted master key already sitting beside it, and 0600 keeps it to
// that account.

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @typedef {Object} AutoLockState
 * @property {boolean} armed        foreground says auto-lock applies to the active wallet
 * @property {number} idleMs        idle threshold, already clamped by the foreground
 * @property {number} lastActivity  ms epoch of the last observed UI activity
 */

/**
 * File-backed auto-lock record. Same three-method contract
 * (load / save / clear) the runtime's other stores use, so
 * `wipeRuntimeStores` clears it with no special case.
 */
export class FileAutoLockStore {
    /**
     * @param {string} filePath  absolute path, typically
     *                            `path.join(app.getPath('userData'), 'autolock.json')`
     */
    constructor(filePath) {
        if (typeof filePath !== 'string' || !filePath) {
            throw new Error('FileAutoLockStore: filePath is required');
        }
        this._filePath = filePath;
        this._tmpPath = `${filePath}.tmp`;
    }

    get filePath() { return this._filePath; }

    /**
     * Read the record. Returns null for missing, unreadable and malformed
     * alike; the launch gate treats null as "refuse to auto-unlock", so a
     * reader that swallowed a fault would be failing OPEN.
     *
     * @returns {Promise<AutoLockState | null>}
     */
    async load() {
        let raw;
        try {
            raw = await fs.readFile(this._filePath, 'utf8');
        } catch {
            return null;
        }
        let v;
        try {
            v = JSON.parse(raw);
        } catch {
            return null;
        }
        if (!v || typeof v !== 'object') return null;
        if (typeof v.armed !== 'boolean') return null;
        return {
            armed: v.armed,
            idleMs: Number(v.idleMs) || 0,
            lastActivity: Number(v.lastActivity) || 0,
        };
    }

    /** @param {AutoLockState} state */
    async save(state) {
        const payload = JSON.stringify({
            armed: state?.armed === true,
            idleMs: Number(state?.idleMs) || 0,
            lastActivity: Number(state?.lastActivity) || 0,
        });
        await fs.mkdir(dirname(this._filePath), { recursive: true });
        await fs.writeFile(this._tmpPath, payload, { mode: 0o600 });
        await fs.rename(this._tmpPath, this._filePath);
    }

    async clear() {
        // Both the live file and any half-written tmp sibling: a crash
        // mid-save must not leave a stamp the next launch trusts.
        for (const p of [this._filePath, this._tmpPath]) {
            try {
                await fs.unlink(p);
            } catch (err) {
                if (err && err.code === 'ENOENT') continue;
                throw err;
            }
        }
    }
}

/**
 * Path helper. Pure (takes the userData dir) so non-Electron harnesses and
 * unit tests can use it.
 *
 * @param {string} userDataDir
 */
export function autoLockStatePathFor(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir) {
        throw new Error('autoLockStatePathFor: userDataDir is required');
    }
    return join(userDataDir, 'autolock.json');
}

/**
 * Fold a renderer `autolock.report` signal into the stored record.
 *
 * Arming re-stamps `lastActivity` so the user always gets a full window
 * from the moment they armed, never an instant lock. Disarming keeps a
 * record with `armed: false`, which is what tells the launch gate "the
 * user chose Never" as against "no report has ever arrived".
 *
 * @param {FileAutoLockStore} store
 * @param {{ armed?: unknown, idleMs?: unknown }} signal
 * @param {number} now
 */
export async function applyAutoLockReport(store, signal, now) {
    if (!store) return;
    if (signal?.armed !== true) {
        await store.save({ armed: false, idleMs: 0, lastActivity: now });
        return;
    }
    const idleMs = Number(signal.idleMs);
    await store.save({
        armed: true,
        idleMs: Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 0,
        lastActivity: now,
    });
}

/**
 * Refresh `lastActivity` on real renderer traffic, throttled.
 *
 * Every IPC message is activity, and an open window sends bursts of them,
 * so an unthrottled stamp would turn message bursts into disk-write bursts.
 * 30s of granularity is far below any auto-lock window a user can set.
 * No-op while disarmed, so a session the user excluded accumulates nothing.
 *
 * @param {FileAutoLockStore} store
 * @param {number} now
 * @param {number} [minIntervalMs]
 */
export async function stampAutoLockActivity(store, now, minIntervalMs = 30_000) {
    if (!store) return;
    const state = await store.load();
    if (!state || state.armed !== true) return;
    if (now - state.lastActivity < minIntervalMs) return;
    await store.save({ ...state, lastActivity: now });
}
