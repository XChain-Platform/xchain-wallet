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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, statSync } from 'node:fs';
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
    handleIpcMessage,
    AUTO_LOCK_REPORT_TYPE,
} from '../../../packages/desktop/main/runtime.js';
import {
    KeychainSessionBackend,
    sessionKeyPathFor,
} from '../../../packages/desktop/main/keychain.js';

const MINUTE = 60 * 1000;

/** safeStorage stand-in: the real seam KeychainSessionBackend already takes. */
const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8').replace(/^enc:/, ''),
};

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xchain-autolock-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

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

describe('desktop launch auto-lock gate', () => {
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

describe('desktop auto-lock record', () => {
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

describe('desktop autolock.report IPC', () => {
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
