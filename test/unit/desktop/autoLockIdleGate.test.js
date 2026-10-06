/**
 * @vitest-environment node
 *
 * Node, not jsdom: this is Electron main-process code writing real files
 * under a real temp dir, the same seam the launch-gate suite uses.
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

// The auto-lock window the user configured, enforced while the app runs
// with no window. On macOS closing the last window does not quit, so the
// open vault, the in-memory master key and the signer pool outlive the
// renderer whose timer was the only idle check, and reopening a window
// re-stamped the clock before anything read it. The assertions that matter
// are that a lapsed window leaves nothing able to sign or reopen the vault,
// and that the in-session check never locks where the user is entitled to
// stay unlocked.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileAutoLockStore, autoLockStatePathFor } from '../../../packages/desktop/main/autoLockState.js';
import {
    createRuntime,
    enforceIdleAutoLock,
    handleIpcMessage,
} from '../../../packages/desktop/main/runtime.js';
import { KeychainSessionBackend, sessionKeyPathFor } from '../../../packages/desktop/main/keychain.js';

const MINUTE = 60 * 1000;
const FILESYSTEM_FIXTURE_TIMEOUT = 60_000;

/** safeStorage stand-in: the real seam KeychainSessionBackend already takes. */
const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8').replace(/^enc:/, ''),
};

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xchain-idlelock-')); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });

const sessionFile = () => sessionKeyPathFor(dir);

/**
 * A runtime in the windowless state: the session key cached on disk AND held
 * in memory, and a host, vault and signer pool standing in for an unlocked
 * session, so "nothing can sign" is checkable on each one.
 */
async function unlockedWindowlessRuntime() {
    const sessionBackend = new KeychainSessionBackend({ safeStorage: fakeSafeStorage, filePath: sessionFile() });
    await sessionBackend.save(new Uint8Array([1, 2, 3, 4]));
    const runtime = createRuntime({
        storageBackend: { load: async () => null, save: async () => {}, clear: async () => {} },
        metaBackend: { load: async () => null, save: async () => {}, clear: async () => {} },
        sessionBackend,
        autoLockStore: new FileAutoLockStore(autoLockStatePathFor(dir)),
        chainRegistry: {},
        sdkRegistry: {},
    });
    const vault = { close: vi.fn() };
    const signerPool = { lockAll: vi.fn() };
    runtime.vault = vault;
    runtime.signerPool = signerPool;
    runtime.host = { handle: vi.fn(async () => ({ ok: true, result: 'signed' })) };
    return { runtime, vault, signerPool };
}

describe('windowless idle auto-lock', { timeout: FILESYSTEM_FIXTURE_TIMEOUT }, () => {
    it('locks an unlocked session once the configured window has lapsed', async () => {
        const { runtime, vault, signerPool } = await unlockedWindowlessRuntime();
        const now = Date.now();
        await runtime.autoLockStore.save({ armed: true, idleMs: 15 * MINUTE, lastActivity: now - 16 * MINUTE });

        expect(await enforceIdleAutoLock(runtime, now)).toEqual({ locked: true, reason: 'idle-window-elapsed' });

        expect(runtime.host).toBe(null);
        expect(runtime.vault).toBe(null);
        expect(vault.close).toHaveBeenCalled();
        expect(signerPool.lockAll).toHaveBeenCalled();
        expect(existsSync(sessionFile())).toBe(false);
        expect(runtime.sessionBackend._inMemory).toBe(null);
        expect(await runtime.sessionBackend.load()).toBe(null);
        expect(await runtime.autoLockStore.load()).toBe(null);
        // The reopened renderer's first vault-backed message finds a locked wallet.
        const res = await handleIpcMessage(runtime, { type: 'wallet.list' });
        expect(res.ok).toBe(false);
        expect(res.error?.name).toBe('WalletLockedError');
        expect(runtime.host).toBe(null);
    });

    it('keeps the session inside the window', async () => {
        const { runtime } = await unlockedWindowlessRuntime();
        const now = Date.now();
        await runtime.autoLockStore.save({ armed: true, idleMs: 15 * MINUTE, lastActivity: now - 2 * MINUTE });

        expect(await enforceIdleAutoLock(runtime, now)).toEqual({ locked: false, reason: 'within-window' });
        expect(runtime.host).not.toBe(null);
        expect(existsSync(sessionFile())).toBe(true);
    });

    it('honours "Never": a disarmed record keeps the session', async () => {
        const { runtime } = await unlockedWindowlessRuntime();
        const now = Date.now();
        await runtime.autoLockStore.save({ armed: false, idleMs: 15 * MINUTE, lastActivity: now - 60 * MINUTE });

        expect(await enforceIdleAutoLock(runtime, now)).toEqual({ locked: false, reason: 'disarmed' });
        expect(runtime.host).not.toBe(null);
    });

    it('does not lock on a missing record, the deliberate opposite of the launch gate', async () => {
        const { runtime } = await unlockedWindowlessRuntime();

        expect(await enforceIdleAutoLock(runtime, Date.now())).toEqual({ locked: false, reason: 'no-record' });
        expect(runtime.host).not.toBe(null);
        expect(existsSync(sessionFile())).toBe(true);
    });

    it('does not lock an armed record whose window cannot be enforced', async () => {
        const { runtime } = await unlockedWindowlessRuntime();
        // An injected store, since the file store already drops such a record on read.
        const record = { armed: true, idleMs: 0, lastActivity: Date.now() - 60 * MINUTE };
        runtime.autoLockStore = { load: async () => record, clear: async () => {} };

        expect(await enforceIdleAutoLock(runtime, Date.now())).toEqual({ locked: false, reason: 'no-window' });
        expect(runtime.host).not.toBe(null);
    });

    it('runs the lock once when two callers race', async () => {
        const { runtime } = await unlockedWindowlessRuntime();
        const now = Date.now();
        await runtime.autoLockStore.save({ armed: true, idleMs: 15 * MINUTE, lastActivity: now - 60 * MINUTE });
        const clear = vi.spyOn(runtime.sessionBackend, 'clear');

        const [a, b] = await Promise.all([enforceIdleAutoLock(runtime, now), enforceIdleAutoLock(runtime, now)]);

        expect(a).toEqual({ locked: true, reason: 'idle-window-elapsed' });
        expect(b).toBe(a);
        expect(clear).toHaveBeenCalledTimes(1);
        expect(runtime.idleLockInFlight).toBe(null);
    });

    it('never throws when the store cannot be read', async () => {
        const { runtime } = await unlockedWindowlessRuntime();
        runtime.autoLockStore = { load: async () => { throw new Error('EIO'); }, clear: async () => {} };

        expect(await enforceIdleAutoLock(runtime, Date.now())).toEqual({ locked: false, reason: 'no-record' });
        expect(runtime.host).not.toBe(null);
    });
});
