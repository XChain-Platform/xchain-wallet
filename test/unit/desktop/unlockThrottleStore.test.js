/**
 * @vitest-environment node
 *
 * Node, not jsdom: this is Electron main-process code reading and writing
 * real files under a real temp dir.
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop unlock-throttle store: the persistence half of the pre-KDF
// brute-force gate. Pins which way a read fault fails (open, on purpose)
// so the store's own comment and its behaviour cannot drift apart again.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileUnlockThrottleStore } from '../../../packages/desktop/main/unlockThrottle.js';
import {
    checkUnlockAllowed,
    recordFailure,
} from '../../../packages/extension/src/background/unlockThrottle.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xchain-unlock-throttle-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('desktop unlock-throttle store', () => {
    it('reads a missing file as no state', async () => {
        const store = new FileUnlockThrottleStore(join(dir, 'unlock-throttle.json'));
        expect(await store.load()).toBe(null);
    });

    it('reads a non-ENOENT fault as no state, which lets the attempt through', async () => {
        // A directory at the file path makes readFile fail with EISDIR.
        const path = join(dir, 'unlock-throttle.json');
        mkdirSync(path);
        const store = new FileUnlockThrottleStore(path);

        const state = await store.load();

        expect(state).toBe(null);
        expect(checkUnlockAllowed(state, Date.now())).toEqual({ allowed: true });
    });

    it('reads invalid JSON as no state', async () => {
        const path = join(dir, 'unlock-throttle.json');
        writeFileSync(path, '{ not json', 'utf8');
        expect(await new FileUnlockThrottleStore(path).load()).toBe(null);
    });

    it('round-trips a saved lockout through a fresh instance, written 0600', async () => {
        const path = join(dir, 'unlock-throttle.json');
        await new FileUnlockThrottleStore(path).save({ failCount: 7, lockedUntil: 12345 });
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(await new FileUnlockThrottleStore(path).load()).toEqual({ failCount: 7, lockedUntil: 12345 });
    });

    it('persists the first background ladder penalty after two free failures', async () => {
        const path = join(dir, 'unlock-throttle.json');
        const store = new FileUnlockThrottleStore(path);
        let state = null;
        state = recordFailure(state, 1_000);
        state = recordFailure(state, 1_000);
        state = recordFailure(state, 1_000);
        await store.save(state);

        expect(await new FileUnlockThrottleStore(path).load()).toEqual({
            failCount: 3,
            lockedUntil: 6_000,
        });
    });

    it('clear removes the record and is safe to repeat', async () => {
        const path = join(dir, 'unlock-throttle.json');
        const store = new FileUnlockThrottleStore(path);
        await store.save({ failCount: 3, lockedUntil: 999 });
        await store.clear();
        expect(existsSync(path)).toBe(false);
        expect(await store.load()).toBe(null);
        await expect(store.clear()).resolves.toBeUndefined();
    });
});
