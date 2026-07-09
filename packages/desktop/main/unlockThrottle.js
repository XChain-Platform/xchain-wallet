// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// FileUnlockThrottleStore (§26): the desktop parallel of the extension's
// ChromeUnlockThrottleStore. Persists the unlock-attempt backoff state
// under `app.getPath('userData')` so it survives an app restart (an
// attacker can't reset the lockout by relaunching), and is read BEFORE
// the Argon2id KDF runs so a locked-out attempt costs no CPU.
//
// The pure policy (FREE_ATTEMPTS, exponential backoff, checkUnlockAllowed,
// recordFailure) lives in the shared extension module; this file only
// supplies the { load, save, clear } persistence contract handleWalletUnlock
// consumes. Without a store passed in, desktop wallet.unlock ran with NO
// brute-force gate at all (the extension shipped one; desktop dropped it).

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * File-backed unlock-throttle store. Same three-method contract
 * (load/save/clear) as ChromeUnlockThrottleStore so the shared
 * `handleWalletUnlock` gate works unchanged.
 */
export class FileUnlockThrottleStore {
    /**
     * @param {string} filePath  absolute path, typically
     *                            `path.join(app.getPath('userData'), 'unlock-throttle.json')`
     */
    constructor(filePath) {
        if (typeof filePath !== 'string' || !filePath) {
            throw new Error('FileUnlockThrottleStore: filePath is required');
        }
        this._filePath = filePath;
        this._tmpPath = `${filePath}.tmp`;
    }

    get filePath() { return this._filePath; }

    /** @returns {Promise<{ failCount: number, lockedUntil: number } | null>} */
    async load() {
        let raw;
        try {
            raw = await fs.readFile(this._filePath, 'utf8');
        } catch (err) {
            if (err && err.code === 'ENOENT') return null;
            // A transient read fault must not silently disable the gate;
            // treat it as "no state" (fail toward prompting) rather than
            // throwing into the unlock path.
            return null;
        }
        let v;
        try {
            v = JSON.parse(raw);
        } catch {
            return null;
        }
        if (!v || typeof v !== 'object') return null;
        return {
            failCount: Number(v.failCount) || 0,
            lockedUntil: Number(v.lockedUntil) || 0,
        };
    }

    /** @param {{ failCount: number, lockedUntil: number }} state */
    async save(state) {
        const payload = JSON.stringify({
            failCount: Number(state?.failCount) || 0,
            lockedUntil: Number(state?.lockedUntil) || 0,
        });
        await fs.mkdir(dirname(this._filePath), { recursive: true });
        await fs.writeFile(this._tmpPath, payload, { mode: 0o600 });
        await fs.rename(this._tmpPath, this._filePath);
    }

    async clear() {
        // Remove both the live file and any half-written tmp sibling so a
        // stale lockout can't linger after a successful unlock.
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
 * Path helper. Pure (takes the userData dir) so it is reusable by
 * non-Electron harnesses and unit tests.
 *
 * @param {string} userDataDir
 */
export function unlockThrottlePathFor(userDataDir) {
    if (typeof userDataDir !== 'string' || !userDataDir) {
        throw new Error('unlockThrottlePathFor: userDataDir is required');
    }
    return join(userDataDir, 'unlock-throttle.json');
}
