// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The §26 auto-lock backstop must survive a lock that fails to clear a secret.
//
// Teardown nulls the service worker's host + vault whatever else happens, so a
// lock whose session-key clear rejected leaves the worker looking locked while
// a secret is still live. Two things have to hold for the idle alarm to come
// back and finish the job: the auto-lock record survives that lock, and the
// "already locked" guard admits the retry the record exists to drive.
//
// Coverage is in two halves because background.js cannot be imported here (it
// registers chrome.* listeners at module load): the first half drives the real
// lock handler and the real backstop state through the retry, the second pins
// that background.js and the pre-host dispatcher wire that shape.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { handleWalletLock } from '../../../packages/extension/src/background/walletLock.js';
import {
    applyAutoLockSignal,
    readAutoLockState,
    clearAutoLockState,
    shouldAutoLock,
} from '../../../packages/extension/src/background/autoLockState.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

/** chrome.storage.session stand-in: the backstop record's real home. */
function sessionArea() {
    const map = new Map();
    return {
        async get(key) { return map.has(key) ? { [key]: map.get(key) } : {}; },
        async set(obj) { for (const [k, v] of Object.entries(obj)) map.set(k, v); },
        async remove(key) { map.delete(key); },
    };
}

/** Secret slot whose clear() rejects the first `failures` times. */
function flakyBackend(failures) {
    let left = failures;
    const backend = {
        clears: 0,
        async load() { return null; },
        async save() { /* unused */ },
        async clear() {
            if (left > 0) {
                left -= 1;
                throw new Error('storage clear failed');
            }
            backend.clears += 1;
        },
    };
    return backend;
}

/** The service worker's lock + alarm pair, over the real lock handler. */
function backstop(sessionBackend, signingSecretBackend) {
    const sw = { host: {}, vault: {}, lockCleanupPending: false, teardowns: 0 };

    async function lockWalletNow() {
        try {
            await handleWalletLock(null, {
                sessionBackend,
                signingSecretBackend,
                onLocked: () => {
                    sw.host = null;
                    sw.vault = null;
                    sw.teardowns += 1;
                },
            });
        } catch (err) {
            sw.lockCleanupPending = true;
            throw err;
        }
        sw.lockCleanupPending = false;
        await clearAutoLockState();
    }

    async function maybeAutoLock(now) {
        if ((!sw.host || !sw.vault) && !sw.lockCleanupPending) return 'skipped';
        const state = await readAutoLockState();
        if (!shouldAutoLock(state, now)) return 'skipped';
        try {
            await lockWalletNow();
            return 'locked';
        } catch {
            return 'failed';
        }
    }

    return { sw, maybeAutoLock };
}

describe('auto-lock retry after an incomplete lock', () => {
    let priorChrome;

    beforeEach(async () => {
        priorChrome = globalThis.chrome;
        globalThis.chrome = { storage: { session: sessionArea() } };
        // Arm at a non-zero stamp: the backstop treats a missing activity
        // stamp as never-armed and refuses to lock.
        await applyAutoLockSignal({ armed: true, idleMs: 1_000 }, 1_000);
    });

    afterEach(() => {
        globalThis.chrome = priorChrome;
    });

    it('keeps the record through a failed clear and finishes on the next alarm', async () => {
        const sessionBackend = flakyBackend(1);
        const signingSecretBackend = flakyBackend(0);
        const { sw, maybeAutoLock } = backstop(sessionBackend, signingSecretBackend);

        expect(await maybeAutoLock(5_000)).toBe('failed');
        expect(sw.teardowns).toBe(1);
        expect(sw.host).toBeNull();
        expect(sw.lockCleanupPending).toBe(true);
        // The armed record is the only thing that brings the alarm back.
        expect(await readAutoLockState()).toMatchObject({ armed: true, idleMs: 1_000 });

        // Host and vault are already null, so this second pass runs only
        // because the retry flag admits it.
        expect(await maybeAutoLock(6_000)).toBe('locked');
        expect(sessionBackend.clears).toBe(1);
        expect(sw.lockCleanupPending).toBe(false);
        expect(await readAutoLockState()).toBeNull();
    });

    it('drops the record on a clean lock and stops re-arming the alarm', async () => {
        const { sw, maybeAutoLock } = backstop(flakyBackend(0), flakyBackend(0));

        expect(await maybeAutoLock(5_000)).toBe('locked');
        expect(sw.lockCleanupPending).toBe(false);
        expect(await readAutoLockState()).toBeNull();
        expect(await maybeAutoLock(9_000)).toBe('skipped');
        expect(sw.teardowns).toBe(1);
    });
});

describe('background.js wires the auto-lock retry', () => {
    const bg = readFileSync(
        join(wsRoot, 'packages', 'extension', 'src', 'background.js'),
        'utf8',
    );

    it('clears the record only once the lock is confirmed', () => {
        const start = bg.indexOf('async function lockWalletNow()');
        expect(start).toBeGreaterThan(-1);
        const region = bg.slice(start, bg.indexOf('async function maybeAutoLock()', start));

        const lockAt = region.indexOf('await handleWalletLock(');
        const clearAt = region.indexOf('await clearAutoLockState();');
        expect(lockAt).toBeGreaterThan(-1);
        expect(clearAt).toBeGreaterThan(lockAt);
        expect(region).toMatch(/catch \(err\)\s*\{\s*lockCleanupPending = true;\s*throw err;\s*\}/);
    });

    it('lets the idle alarm retry once teardown has nulled host and vault', () => {
        const start = bg.indexOf('async function maybeAutoLock()');
        expect(start).toBeGreaterThan(-1);
        const region = bg.slice(start, bg.indexOf('attachSessionMetaListener(', start));

        expect(region).toMatch(/if \(\(!host \|\| !vault\) && !lockCleanupPending\) return;/);
        expect(region).toMatch(/await lockWalletNow\(\)/);
    });

    it('retains the record when the lock reports a surviving secret', () => {
        const start = bg.indexOf('onLocked: (result) =>');
        expect(start).toBeGreaterThan(-1);
        const region = bg.slice(start, bg.indexOf('attachSignerBridgeListener(', start));

        expect(region).toMatch(
            /if \(result\?\.secretsCleared === false\)\s*\{\s*lockCleanupPending = true;\s*\}\s*else\s*\{/,
        );
        const elseAt = region.indexOf('} else {');
        expect(region.indexOf('clearAutoLockState()')).toBeGreaterThan(elseAt);
    });

    it('declares the lock result the dispatcher forwards to onLocked', () => {
        const meta = readFileSync(
            join(wsRoot, 'packages', 'extension', 'src', 'background', 'sessionMeta.js'),
            'utf8',
        );
        const decls = meta
            .split('\n')
            .filter((line) => line.includes('onLocked') && line.includes('Promise<void>'));

        expect(decls).toHaveLength(2);
        for (const line of decls) {
            expect(line).toMatch(/secretsCleared: boolean/);
        }
    });
});
