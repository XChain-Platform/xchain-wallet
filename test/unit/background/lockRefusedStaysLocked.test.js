// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A lock whose session-key clear is refused tears the host down while the key
// stays in storage. Until the clear lands, the worker reads as locked: the
// keepalive host build does not rebuild from that key, session.status answers
// locked, and the next tick retries the clear even with no idle deadline due.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    createLockBackstop,
    createHostBuildFlight,
    createKeepaliveTick,
} from '../../../packages/extension/src/background/walletLock.js';
import { dispatchPreHost } from '../../../packages/extension/src/background/sessionMeta.js';
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

/** Session-key slot holding a key, whose clear() rejects the first `failures` times. */
function keySlot(failures) {
    let left = failures;
    let key = new Uint8Array(32).fill(7);
    const slot = {
        clears: 0,
        loads: 0,
        hasKey: () => key !== null,
        async load() { slot.loads += 1; return key ? Uint8Array.from(key) : null; },
        async save(next) { key = Uint8Array.from(next); },
        async clear() {
            if (left > 0) {
                left -= 1;
                throw new Error('storage clear failed');
            }
            key = null;
            slot.clears += 1;
        },
    };
    return slot;
}

function emptySlot() {
    return { async load() { return null; }, async save() {}, async clear() {} };
}

/**
 * The service worker's wiring: host + vault nulled by teardown, a host build
 * that reads the session key through the backstop's gate, and the keepalive
 * tick that runs the build and then the idle-lock check.
 */
function shell(sessionBackend) {
    const sw = { host: {}, vault: {}, teardowns: 0, builds: 0, clock: 5_000 };
    const backstop = createLockBackstop({
        lockDeps: () => ({ sessionBackend, signingSecretBackend: emptySlot() }),
        tearDownHost: () => {
            sw.host = null;
            sw.vault = null;
            sw.teardowns += 1;
        },
        isUnlocked: () => Boolean(sw.host && sw.vault),
        readAutoLockState,
        clearAutoLockState,
        shouldAutoLock,
        now: () => sw.clock,
        logger: { log() { }, error() { } },
    });

    // background.js buildHost's read: nothing while a clear is pending.
    const buildHost = async () => {
        if (sw.host) return sw.host;
        const masterKey = backstop.cleanupPending ? null : await sessionBackend.load();
        if (!masterKey) return null;
        masterKey.fill(0);
        sw.builds += 1;
        sw.host = {};
        sw.vault = {};
        return sw.host;
    };
    const ensureHost = createHostBuildFlight(buildHost);
    const keepaliveTick = createKeepaliveTick({
        ensureHost,
        maybeAutoLock: backstop.maybeAutoLock,
        refresh: () => {},
        logger: { error() { } },
    });
    const status = () => dispatchPreHost('session.status', null, {
        storageBackend: { async load() { return new Uint8Array([1]); } },
        sessionBackend,
        metaBackend: { async load() { return null; } },
        isLockPending: () => backstop.cleanupPending,
    });
    return { sw, backstop, ensureHost, keepaliveTick, status };
}

describe('a refused lock keeps the wallet locked until the clear lands', () => {
    let priorChrome;
    let consoleError;

    beforeEach(async () => {
        // The lock handler logs each refused clear; the tests assert those lines.
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        priorChrome = globalThis.chrome;
        globalThis.chrome = { storage: { session: sessionArea() } };
        // Armed, but the idle deadline is far off: only the pending clear
        // brings the next tick into the lock path.
        await applyAutoLockSignal({ armed: true, idleMs: 600_000 }, 1_000);
    });

    afterEach(() => {
        globalThis.chrome = priorChrome;
    });

    it('refuses the rebuild, reports locked, and retries the clear on the next tick', async () => {
        const sessionBackend = keySlot(1);
        const { sw, backstop, ensureHost, keepaliveTick, status } = shell(sessionBackend);

        // (1) The lock rejects, the host is torn down, the key survives.
        await expect(backstop.lockWalletNow()).rejects.toMatchObject({
            name: 'WalletLockIncompleteError',
        });
        expect(sw.teardowns).toBe(1);
        expect(sw.host).toBeNull();
        expect(sessionBackend.hasKey()).toBe(true);
        expect(backstop.cleanupPending).toBe(true);
        expect(consoleError).toHaveBeenCalledWith(
            '[xchain] wallet.lock: sessionBackend.clear failed:',
            expect.any(Error),
        );

        // (2) The host build does not rebuild from the surviving key.
        await expect(ensureHost()).resolves.toBeNull();
        expect(sw.builds).toBe(0);
        expect(sessionBackend.loads).toBe(0);
        expect(sw.host).toBeNull();

        // (3) Status reads locked while the clear is pending.
        await expect(status()).resolves.toMatchObject({
            hasWallet: true,
            hasSession: false,
            state: 'locked',
        });

        // (4) The tick retries the clear with no deadline due, and it lands.
        sw.clock = 6_000;
        expect(shouldAutoLock(await readAutoLockState(), sw.clock)).toBe(false);
        await expect(keepaliveTick()).resolves.toBe('locked');
        expect(sessionBackend.clears).toBe(1);
        expect(sessionBackend.hasKey()).toBe(false);
        expect(backstop.cleanupPending).toBe(false);
        expect(sw.builds).toBe(0);
        await expect(status()).resolves.toMatchObject({ hasSession: false, state: 'locked' });

        // A later tick stays locked: no key to build from, nothing left to retry.
        sw.clock = 7_000;
        await expect(keepaliveTick()).resolves.toBe('skipped');
        expect(sw.host).toBeNull();
        expect(sessionBackend.clears).toBe(1);
    });

    it('keeps retrying each tick while the clear keeps refusing', async () => {
        const sessionBackend = keySlot(2);
        const { sw, backstop, keepaliveTick, status } = shell(sessionBackend);

        await expect(backstop.lockWalletNow()).rejects.toBeTruthy();
        await expect(keepaliveTick()).resolves.toBe('failed');
        expect(backstop.cleanupPending).toBe(true);
        expect(sessionBackend.hasKey()).toBe(true);
        expect(sw.host).toBeNull();
        await expect(status()).resolves.toMatchObject({ state: 'locked' });

        await expect(keepaliveTick()).resolves.toBe('locked');
        expect(sessionBackend.hasKey()).toBe(false);
        expect(sw.builds).toBe(0);
    });

    it('a fresh unlock ends the pending window and the host builds again', async () => {
        const sessionBackend = keySlot(1);
        const { sw, backstop, ensureHost, status } = shell(sessionBackend);

        await expect(backstop.lockWalletNow()).rejects.toBeTruthy();
        backstop.noteUnlocked();
        await expect(ensureHost()).resolves.toBeTruthy();
        expect(sw.builds).toBe(1);
        await expect(status()).resolves.toMatchObject({ state: 'unlocked' });
    });

    it('a status read with no pending clear still reports the key', async () => {
        const { status } = shell(keySlot(0));
        await expect(status()).resolves.toMatchObject({ hasSession: true, state: 'unlocked' });
    });
});

describe('background.js routes the host build and status through the backstop', () => {
    const bg = readFileSync(join(wsRoot, 'packages', 'extension', 'src', 'background.js'), 'utf8');

    it('reads no build key while a clear is pending and wires status to it', () => {
        const start = bg.indexOf('async function buildHost()');
        const head = bg.slice(start, bg.indexOf('new storageLib.Vault', start));
        expect(head).toMatch(/const sessionBackend = lockBackstop\.cleanupPending === true\s*\?\s*LOCK_PENDING_SESSION/);
        expect(bg).toMatch(/const LOCK_PENDING_SESSION = Object\.freeze\(\{ load: async \(\) => null \}\);/);
        expect(bg).toMatch(/isLockPending: \(\) => lockBackstop\.cleanupPending/);
    });
});
