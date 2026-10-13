/**
 * @vitest-environment node
 *
 * Node, not jsdom: this is Electron main-process code writing real files
 * under a real temp dir. The whole point of the record under test is that
 * it survives a process, so a fake in-memory store would be testing the
 * one property that does not matter.
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

// The auto-lock window the user configured, enforced across a QUIT.
//
// What was broken: the desktop shell caches the vault master key
// safeStorage-encrypted in `session.bin`, `before-quit` deliberately leaves
// it there, and the next launch re-opened the vault from it with no
// password and no policy check. `autolockMinutes` was enforced only by a
// foreground timer that dies with the renderer, so someone who set a
// 15-minute auto-lock and quit got an unlocked wallet back weeks later.
//
// So the assertion that matters is not "the gate returns ok". It is that
// the cached key FILE is gone afterwards in every case where the window
// has lapsed or cannot be shown to have held, and still present in the two
// cases where the user is entitled to the skip-the-prompt relaunch.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, statSync, promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    FileAutoLockStore,
    autoLockStatePathFor,
    applyAutoLockReport,
    stampAutoLockActivity,
} from '../../../packages/desktop/main/autoLockState.js';
import {
    createRuntime,
    enforceLaunchAutoLock,
    ensureHost,
    handleIpcMessage,
    AUTO_LOCK_REPORT_TYPE,
} from '../../../packages/desktop/main/runtime.js';
import {
    KeychainSessionBackend,
    sessionKeyPathFor,
} from '../../../packages/desktop/main/keychain.js';

const MINUTE = 60 * 1000;
const FILESYSTEM_FIXTURE_TIMEOUT = 60_000;

/** safeStorage stand-in: the real seam KeychainSessionBackend already takes. */
const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8').replace(/^enc:/, ''),
};

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xchain-autolock-')); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });

/**
 * A runtime with the two stores the gate reads and a session.bin that
 * really exists on disk, so "the key survived" is a file-system fact.
 */
async function runtimeWithCachedKey({ withAutoLockStore = true } = {}) {
    const sessionBackend = new KeychainSessionBackend({
        safeStorage: fakeSafeStorage,
        filePath: sessionKeyPathFor(dir),
    });
    await sessionBackend.save(new Uint8Array([1, 2, 3, 4]));
    // Drop the in-memory slot so load() has to come off disk, which is the
    // relaunch it is standing in for.
    sessionBackend._inMemory = null;
    const runtime = createRuntime({
        storageBackend: { load: async () => null, save: async () => {}, clear: async () => {} },
        metaBackend: { load: async () => null, save: async () => {}, clear: async () => {} },
        sessionBackend,
        autoLockStore: withAutoLockStore ? new FileAutoLockStore(autoLockStatePathFor(dir)) : undefined,
        chainRegistry: {},
        sdkRegistry: {},
    });
    return runtime;
}

const sessionFile = () => sessionKeyPathFor(dir);

describe('desktop launch auto-lock gate', { timeout: FILESYSTEM_FIXTURE_TIMEOUT }, () => {
    it('locks when the configured window has elapsed since the last activity', async () => {
        const runtime = await runtimeWithCachedKey();
        const now = Date.now();
        await runtime.autoLockStore.save({
            armed: true,
            idleMs: 15 * MINUTE,
            lastActivity: now - 60 * MINUTE,
        });
        expect(existsSync(sessionFile())).toBe(true);

        const res = await enforceLaunchAutoLock(runtime, now);

        expect(res).toEqual({ locked: true, reason: 'idle-window-elapsed' });
        expect(existsSync(sessionFile())).toBe(false);
        expect(await runtime.sessionBackend.load()).toBe(null);
        // The stale record goes with it; it describes a session that ended.
        expect(await runtime.autoLockStore.load()).toBe(null);
    });

    it('keeps the relaunch skip well inside the window', async () => {
        const runtime = await runtimeWithCachedKey();
        const now = Date.now();
        await runtime.autoLockStore.save({
            armed: true,
            idleMs: 15 * MINUTE,
            lastActivity: now - 2 * MINUTE,
        });

        const res = await enforceLaunchAutoLock(runtime, now);

        expect(res).toEqual({ locked: false, reason: 'within-window' });
        expect(existsSync(sessionFile())).toBe(true);
        expect(await runtime.sessionBackend.load()).not.toBe(null);
    });

    it('honours "Never": a disarmed record keeps the cached key', async () => {
        const runtime = await runtimeWithCachedKey();
        const now = Date.now();
        await runtime.autoLockStore.save({ armed: false, idleMs: 0, lastActivity: now - 999 * MINUTE });

        const res = await enforceLaunchAutoLock(runtime, now);

        expect(res).toEqual({ locked: false, reason: 'disarmed' });
        expect(existsSync(sessionFile())).toBe(true);
    });

    it('fails CLOSED with no record at all: this is the crash/kill path', async () => {
        const runtime = await runtimeWithCachedKey();
        expect(existsSync(autoLockStatePathFor(dir))).toBe(false);

        const res = await enforceLaunchAutoLock(runtime, Date.now());

        expect(res).toEqual({ locked: true, reason: 'no-record' });
        expect(existsSync(sessionFile())).toBe(false);
    });

    it('fails CLOSED on a corrupt record rather than trusting it', async () => {
        const runtime = await runtimeWithCachedKey();
        writeFileSync(autoLockStatePathFor(dir), '{ not json', 'utf8');

        const res = await enforceLaunchAutoLock(runtime, Date.now());

        expect(res).toEqual({ locked: true, reason: 'no-record' });
        expect(existsSync(sessionFile())).toBe(false);
    });

    it('fails CLOSED on a record whose armed flag was tampered to a non-boolean', async () => {
        const runtime = await runtimeWithCachedKey();
        writeFileSync(
            autoLockStatePathFor(dir),
            JSON.stringify({ armed: 'yes', idleMs: 1, lastActivity: Date.now() }),
            'utf8',
        );

        const res = await enforceLaunchAutoLock(runtime, Date.now());

        expect(res.locked).toBe(true);
        expect(existsSync(sessionFile())).toBe(false);
    });

    // An armed record whose window cannot be enforced must not read as
    // "within window": the shared idle check answers "never lock" there.
    it.each([
        ['a zero idleMs', { armed: true, idleMs: 0, lastActivity: 'NOW' }],
        ['a missing idleMs', { armed: true, lastActivity: 'NOW' }],
        ['a non-numeric idleMs', { armed: true, idleMs: 'abc', lastActivity: 'NOW' }],
        ['a negative idleMs', { armed: true, idleMs: -1, lastActivity: 'NOW' }],
        ['a zero lastActivity', { armed: true, idleMs: 15 * MINUTE, lastActivity: 0 }],
        ['a missing lastActivity', { armed: true, idleMs: 15 * MINUTE }],
    ])('fails CLOSED on an armed record with %s', async (_label, record) => {
        const runtime = await runtimeWithCachedKey();
        const now = Date.now();
        const onDisk = { ...record };
        if (onDisk.lastActivity === 'NOW') onDisk.lastActivity = now;
        writeFileSync(autoLockStatePathFor(dir), JSON.stringify(onDisk), 'utf8');

        const res = await enforceLaunchAutoLock(runtime, now);

        expect(res).toEqual({ locked: true, reason: 'no-record' });
        expect(existsSync(sessionFile())).toBe(false);
        expect(await runtime.autoLockStore.load()).toBe(null);
    });

    it('fails CLOSED on an armed zero-window state from any injected store', async () => {
        const runtime = await runtimeWithCachedKey();
        runtime.autoLockStore = {
            load: async () => ({ armed: true, idleMs: 0, lastActivity: Date.now() }),
            save: async () => {},
            clear: async () => {},
        };

        const res = await enforceLaunchAutoLock(runtime, Date.now());

        expect(res).toEqual({ locked: true, reason: 'no-record' });
        expect(existsSync(sessionFile())).toBe(false);
    });

    it('does nothing when no key was cached in the first place', async () => {
        const runtime = await runtimeWithCachedKey();
        await runtime.sessionBackend.clear();

        const res = await enforceLaunchAutoLock(runtime, Date.now());

        expect(res).toEqual({ locked: false, reason: 'no-session' });
    });

    it('is inert for a runtime built without the store, so older callers are unchanged', async () => {
        const runtime = await runtimeWithCachedKey({ withAutoLockStore: false });

        const res = await enforceLaunchAutoLock(runtime, Date.now());

        expect(res).toEqual({ locked: false, reason: 'no-store' });
        expect(existsSync(sessionFile())).toBe(true);
    });
});

describe('desktop auto-lock record', { timeout: FILESYSTEM_FIXTURE_TIMEOUT }, () => {
    it('is written 0600 and survives a fresh store instance (a relaunch)', async () => {
        const path = autoLockStatePathFor(dir);
        await new FileAutoLockStore(path).save({ armed: true, idleMs: 900000, lastActivity: 42 });
        expect(statSync(path).mode & 0o777).toBe(0o600);
        // A DIFFERENT instance reads it back: the point of the file.
        expect(await new FileAutoLockStore(path).load()).toEqual({
            armed: true, idleMs: 900000, lastActivity: 42,
        });
    });

    it('arming re-stamps lastActivity, so nobody is locked out the instant they arm', async () => {
        const store = new FileAutoLockStore(autoLockStatePathFor(dir));
        const now = 1_000_000;
        await applyAutoLockReport(store, { armed: true, idleMs: 15 * MINUTE }, now);
        expect(await store.load()).toEqual({ armed: true, idleMs: 15 * MINUTE, lastActivity: now });
    });

    it('a disarm keeps a record, which is what separates "Never" from "no report yet"', async () => {
        const store = new FileAutoLockStore(autoLockStatePathFor(dir));
        await applyAutoLockReport(store, { armed: false }, 500);
        expect(await store.load()).toEqual({ armed: false, idleMs: 0, lastActivity: 500 });
    });

    it('throttles the activity stamp instead of writing on every message', async () => {
        const store = new FileAutoLockStore(autoLockStatePathFor(dir));
        const t0 = 1_000_000;
        await applyAutoLockReport(store, { armed: true, idleMs: 15 * MINUTE }, t0);
        await stampAutoLockActivity(store, t0 + 5_000);
        expect((await store.load()).lastActivity).toBe(t0);      // inside the throttle
        await stampAutoLockActivity(store, t0 + 45_000);
        expect((await store.load()).lastActivity).toBe(t0 + 45_000);
    });

    it('never stamps a disarmed record', async () => {
        const store = new FileAutoLockStore(autoLockStatePathFor(dir));
        await applyAutoLockReport(store, { armed: false }, 500);
        await stampAutoLockActivity(store, 500 + 10 * MINUTE);
        expect((await store.load()).lastActivity).toBe(500);
    });
});

describe('desktop session.autolock IPC', { timeout: FILESYSTEM_FIXTURE_TIMEOUT }, () => {
    it('arms the record from the renderer without reaching the shared pre-host dispatcher', async () => {
        const runtime = await runtimeWithCachedKey();
        const res = await handleIpcMessage(runtime, {
            type: AUTO_LOCK_REPORT_TYPE,
            request: { armed: true, idleMs: 15 * MINUTE },
        });
        expect(res.ok).toBe(true);
        expect(res.result).toEqual({ armed: true });
        const state = await runtime.autoLockStore.load();
        expect(state.armed).toBe(true);
        expect(state.idleMs).toBe(15 * MINUTE);
    });

    it.each([
        ['a zero idleMs', 0],
        ['a non-numeric idleMs', 'nope'],
    ])('an armed report with %s leaves no record, so the next launch locks', async (_label, idleMs) => {
        const runtime = await runtimeWithCachedKey();
        await handleIpcMessage(runtime, {
            type: AUTO_LOCK_REPORT_TYPE,
            request: { armed: true, idleMs },
        });
        expect(existsSync(autoLockStatePathFor(dir))).toBe(false);

        const res = await enforceLaunchAutoLock(runtime, Date.now());

        expect(res).toEqual({ locked: true, reason: 'no-record' });
        expect(existsSync(sessionFile())).toBe(false);
    });

    it('an armed session that keeps talking is not locked by the next launch', async () => {
        const runtime = await runtimeWithCachedKey();
        await handleIpcMessage(runtime, {
            type: AUTO_LOCK_REPORT_TYPE,
            request: { armed: true, idleMs: 15 * MINUTE },
        });
        // Ordinary renderer traffic. The message itself is rejected (locked
        // runtime, no host) and that is fine: the stamp is the subject.
        await handleIpcMessage(runtime, { type: 'wallet.list' });
        const res = await enforceLaunchAutoLock(runtime, Date.now());
        expect(res.locked).toBe(false);
    });
});

describe('a cached key the lock could not delete is never used again', { timeout: FILESYSTEM_FIXTURE_TIMEOUT }, () => {
    /** Refuse the unlink of `target` only, the way an AV handle on session.bin does. */
    function refuseUnlinkOf(target, code = 'EPERM') {
        const real = fsPromises.unlink.bind(fsPromises);
        return vi.spyOn(fsPromises, 'unlink').mockImplementation(async (p) => {
            if (String(p) === target) throw Object.assign(new Error(code), { code });
            return real(p);
        });
    }

    it('locks this launch and every relaunch while session.bin cannot be removed', async () => {
        const runtime = await runtimeWithCachedKey();
        const now = Date.now();
        await runtime.autoLockStore.save({ armed: true, idleMs: 15 * MINUTE, lastActivity: now - 60 * MINUTE });
        const spy = refuseUnlinkOf(sessionFile());

        expect(await enforceLaunchAutoLock(runtime, now)).toEqual({ locked: true, reason: 'idle-window-elapsed' });
        expect(existsSync(sessionFile())).toBe(true);
        expect(await runtime.sessionBackend.load()).toBe(null);
        expect(await ensureHost(runtime)).toBe(null);
        expect(runtime.host).toBe(null);

        // Relaunch with the fault still there: the record is gone, so 'no-record'.
        const relaunched = createRuntime({
            storageBackend: { load: async () => null, save: async () => {}, clear: async () => {} },
            metaBackend: { load: async () => null, save: async () => {}, clear: async () => {} },
            sessionBackend: new KeychainSessionBackend({ safeStorage: fakeSafeStorage, filePath: sessionFile() }),
            autoLockStore: new FileAutoLockStore(autoLockStatePathFor(dir)),
            chainRegistry: {},
            sdkRegistry: {},
        });
        expect(await enforceLaunchAutoLock(relaunched, Date.now())).toEqual({ locked: true, reason: 'no-record' });
        expect(await ensureHost(relaunched)).toBe(null);

        spy.mockRestore();
        const third = await runtimeWithCachedKey();
        await enforceLaunchAutoLock(third, Date.now());
        expect(existsSync(sessionFile())).toBe(false);
    });

    it('a fresh save after the failed clear is a fresh session again', async () => {
        const backend = new KeychainSessionBackend({ safeStorage: fakeSafeStorage, filePath: sessionFile() });
        await backend.save(new Uint8Array([9, 9]));
        const spy = refuseUnlinkOf(sessionFile(), 'EBUSY');
        await expect(backend.clear()).rejects.toThrow('EBUSY');
        expect(await backend.load()).toBe(null);
        spy.mockRestore();

        await backend.save(new Uint8Array([7, 7]));
        expect(Array.from(await backend.load())).toEqual([7, 7]);
    });

    it('still removes the .tmp sibling when the live file refuses', async () => {
        const backend = new KeychainSessionBackend({ safeStorage: fakeSafeStorage, filePath: sessionFile() });
        await backend.save(new Uint8Array([1]));
        writeFileSync(`${sessionFile()}.tmp`, 'half-written');
        refuseUnlinkOf(sessionFile());
        await expect(backend.clear()).rejects.toThrow('EPERM');
        expect(existsSync(`${sessionFile()}.tmp`)).toBe(false);
    });
});

describe('a presence probe zeroes the key copy it loads', { timeout: FILESYSTEM_FIXTURE_TIMEOUT }, () => {
    /** Wrap load() so every buffer it hands out is kept for inspection. */
    function captureLoads(backend) {
        const handed = [];
        const real = backend.load.bind(backend);
        backend.load = async () => {
            const bytes = await real();
            if (bytes) handed.push(bytes);
            return bytes;
        };
        return handed;
    }

    it('the launch gate leaves no plaintext key bytes behind', async () => {
        const runtime = await runtimeWithCachedKey();
        const now = Date.now();
        await runtime.autoLockStore.save({ armed: true, idleMs: 15 * MINUTE, lastActivity: now });
        const handed = captureLoads(runtime.sessionBackend);

        expect((await enforceLaunchAutoLock(runtime, now)).locked).toBe(false);
        expect(handed).toHaveLength(1);
        expect(Array.from(handed[0])).toEqual([0, 0, 0, 0]);
        expect(Array.from(await runtime.sessionBackend.load())).toEqual([1, 2, 3, 4]);
    });

    it('session.status reports the session and zeroes the copy it read', async () => {
        const runtime = await runtimeWithCachedKey();
        runtime.storageBackend.load = async () => new Uint8Array([5]);
        const handed = captureLoads(runtime.sessionBackend);

        const res = await handleIpcMessage(runtime, { type: 'session.status', request: {} });
        expect(res.result).toEqual({ hasWallet: true, hasSession: true, state: 'unlocked' });
        expect(handed).toHaveLength(1);
        expect(Array.from(handed[0])).toEqual([0, 0, 0, 0]);
    });
});
