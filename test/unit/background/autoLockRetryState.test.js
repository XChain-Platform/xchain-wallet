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
// Every case here drives the SHIPPING sequencer (createLockBackstop, which
// background.js wires verbatim) over the real lock handler and the real
// backstop state, so what is asserted is the ordering itself. The one
// structural check at the bottom only pins that background.js still delegates
// rather than re-inlining a second copy of the sequence.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    createLockBackstop,
    AUTO_LOCK_REQUEST_CEILING_MS,
    createUiRequestTracker,
    requestHoldsAutoLock,
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

/**
 * The service worker's own wiring: a shell whose host + vault are nulled by
 * teardown, the real auto-lock state module, and a clock the test advances.
 */
function shell(sessionBackend, signingSecretBackend) {
    const sw = { host: {}, vault: {}, teardowns: 0, clock: 5_000 };

    const backstop = createLockBackstop({
        lockDeps: () => ({ sessionBackend, signingSecretBackend }),
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

    return { sw, backstop };
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
        const { sw, backstop } = shell(sessionBackend, signingSecretBackend);

        expect(await backstop.maybeAutoLock()).toBe('failed');
        expect(sw.teardowns).toBe(1);
        expect(sw.host).toBeNull();
        expect(backstop.cleanupPending).toBe(true);
        // The armed record is the only thing that brings the alarm back.
        expect(await readAutoLockState()).toMatchObject({ armed: true, idleMs: 1_000 });

        // Host and vault are already null, so this second pass runs only
        // because the retry flag admits it.
        sw.clock = 6_000;
        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(sessionBackend.clears).toBe(1);
        expect(backstop.cleanupPending).toBe(false);
        expect(await readAutoLockState()).toBeNull();
    });

    it('keeps the record when only the signing-secret clear fails', async () => {
        const signingSecretBackend = flakyBackend(1);
        const { sw, backstop } = shell(flakyBackend(0), signingSecretBackend);

        expect(await backstop.maybeAutoLock()).toBe('failed');
        expect(sw.teardowns).toBe(1);
        expect(await readAutoLockState()).toMatchObject({ armed: true });

        sw.clock = 6_000;
        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(signingSecretBackend.clears).toBe(1);
        expect(await readAutoLockState()).toBeNull();
    });

    it('drops the record on a clean lock and stops re-arming the alarm', async () => {
        const { sw, backstop } = shell(flakyBackend(0), flakyBackend(0));

        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(backstop.cleanupPending).toBe(false);
        expect(await readAutoLockState()).toBeNull();

        sw.clock = 9_000;
        expect(await backstop.maybeAutoLock()).toBe('skipped');
        expect(sw.teardowns).toBe(1);
    });

    it('refuses a locked shell that has no secret left behind', async () => {
        const sessionBackend = flakyBackend(0);
        const { sw, backstop } = shell(sessionBackend, flakyBackend(0));
        sw.host = null;
        sw.vault = null;

        expect(await backstop.maybeAutoLock()).toBe('skipped');
        expect(sessionBackend.clears).toBe(0);
        expect(sw.teardowns).toBe(0);
        // Nothing locked, so the record must still be there for a real session.
        expect(await readAutoLockState()).toMatchObject({ armed: true });
    });

    it('does not lock, or touch the record, before the idle window elapses', async () => {
        const sessionBackend = flakyBackend(0);
        const { sw, backstop } = shell(sessionBackend, flakyBackend(0));
        sw.clock = 1_500; // armed at 1_000 with idleMs 1_000

        expect(await backstop.maybeAutoLock()).toBe('skipped');
        expect(sessionBackend.clears).toBe(0);
        expect(sw.teardowns).toBe(0);
        expect(await readAutoLockState()).toMatchObject({ armed: true });
    });

    it('propagates the rejection out of lockWalletNow so a rollback can catch it', async () => {
        // ensureHost force-locks in the vault.open() catch and reports the
        // rollback separately; swallowing here would hide a failed rollback.
        const { backstop } = shell(flakyBackend(1), flakyBackend(0));

        await expect(backstop.lockWalletNow()).rejects.toMatchObject({
            name: 'WalletLockIncompleteError',
        });
        expect(backstop.cleanupPending).toBe(true);
        expect(await readAutoLockState()).toMatchObject({ armed: true });
    });

    it('re-unlocking stops the retry chase', async () => {
        const { sw, backstop } = shell(flakyBackend(1), flakyBackend(0));

        expect(await backstop.maybeAutoLock()).toBe('failed');
        expect(backstop.cleanupPending).toBe(true);

        backstop.noteUnlocked();
        sw.clock = 6_000;
        expect(backstop.cleanupPending).toBe(false);
        expect(await backstop.maybeAutoLock()).toBe('skipped');
    });

    it('keeps the record when a popup-driven wallet.lock leaves a secret behind', async () => {
        // The dispatcher lane, not the alarm: same rule has to hold there.
        const { sw, backstop } = shell(flakyBackend(0), flakyBackend(0));

        await expect(dispatchPreHost('wallet.lock', null, {
            storageBackend: {}, metaBackend: {},
            sessionBackend: flakyBackend(1),
            signingSecretBackend: flakyBackend(0),
            onLocked: backstop.onLocked,
        })).rejects.toMatchObject({ name: 'WalletLockIncompleteError' });

        expect(sw.teardowns).toBe(1);
        expect(backstop.cleanupPending).toBe(true);
        expect(await readAutoLockState()).toMatchObject({ armed: true });
    });

    it('drops the record when a popup-driven wallet.lock cleared both secrets', async () => {
        const { sw, backstop } = shell(flakyBackend(0), flakyBackend(0));

        await expect(dispatchPreHost('wallet.lock', null, {
            storageBackend: {}, metaBackend: {},
            sessionBackend: flakyBackend(0),
            signingSecretBackend: flakyBackend(0),
            onLocked: backstop.onLocked,
        })).resolves.toEqual({ locked: true });

        expect(sw.teardowns).toBe(1);
        expect(backstop.cleanupPending).toBe(false);
        // onLocked clears best-effort, without awaiting; let it settle.
        await Promise.resolve();
        expect(await readAutoLockState()).toBeNull();
    });

    it('locks a session whose auto-lock record storage cannot read', async () => {
        const sessionBackend = flakyBackend(0);
        const { sw, backstop } = shell(sessionBackend, flakyBackend(0));
        // A restarted worker holds no in-memory copy, so the unreadable record
        // is a deadline it cannot enforce.
        globalThis.chrome.storage.session.get = vi.fn(async () => { throw new Error('nope'); });

        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(sessionBackend.clears).toBe(1);
        expect(sw.teardowns).toBe(1);
    });

    it('waits for an active request before locking on an unreadable record', async () => {
        const sessionBackend = flakyBackend(0);
        let active = true;
        const sw = { host: {}, vault: {}, teardowns: 0 };
        const backstop = createLockBackstop({
            lockDeps: () => ({ sessionBackend, signingSecretBackend: flakyBackend(0) }),
            tearDownHost: () => { sw.host = null; sw.vault = null; sw.teardowns += 1; },
            isUnlocked: () => Boolean(sw.host && sw.vault),
            isRequestActive: () => active,
            readAutoLockState,
            clearAutoLockState,
            shouldAutoLock,
            logger: { log() { }, error() { } },
        });
        globalThis.chrome.storage.session.get = vi.fn(async () => { throw new Error('nope'); });

        expect(await backstop.maybeAutoLock()).toBe('deferred');
        active = false;
        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(sw.teardowns).toBe(1);
    });
});

describe('a signing request holds a due idle lock until it ends or hits its ceiling', () => {
    let priorChrome;
    const TICK = 24_000;

    beforeEach(async () => {
        priorChrome = globalThis.chrome;
        globalThis.chrome = { storage: { session: sessionArea() } };
        await applyAutoLockSignal({ armed: true, idleMs: 60_000 }, 1_000);
    });

    afterEach(() => {
        globalThis.chrome = priorChrome;
    });

    // One clock drives the tracker and the backstop, as in the worker.
    function clockedShell() {
        const sw = { host: {}, vault: {}, teardowns: 0, clock: 61_000 + 120_000 };
        const tracker = createUiRequestTracker({ now: () => sw.clock });
        const sessionBackend = flakyBackend(0);
        const backstop = createLockBackstop({
            lockDeps: () => ({ sessionBackend, signingSecretBackend: flakyBackend(0) }),
            tearDownHost: () => { sw.host = null; sw.vault = null; sw.teardowns += 1; },
            isUnlocked: () => Boolean(sw.host && sw.vault),
            isRequestActive: () => tracker.isActive(),
            readAutoLockState,
            clearAutoLockState,
            shouldAutoLock,
            now: () => sw.clock,
            logger: { log() { }, error() { } },
        });
        return { sw, tracker, sessionBackend, backstop };
    }

    it('holds across three ticks and locks on the first tick after the request ends', async () => {
        const { sw, tracker, sessionBackend, backstop } = clockedShell();
        const finish = tracker.begin('auth.signPsbt');

        for (let i = 0; i < 3; i += 1) {
            expect(await backstop.maybeAutoLock()).toBe('deferred');
            sw.clock += TICK;
        }
        expect(sw.teardowns).toBe(0);
        expect(sessionBackend.clears).toBe(0);

        finish();
        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(sessionBackend.clears).toBe(1);
        expect(sw.teardowns).toBe(1);
        expect(await readAutoLockState()).toBeNull();
    });

    it('stops holding once the request passes the ceiling', async () => {
        const { sw, tracker, backstop } = clockedShell();
        tracker.begin('broadcast.signedTx');

        sw.clock += AUTO_LOCK_REQUEST_CEILING_MS - 1;
        expect(await backstop.maybeAutoLock()).toBe('deferred');
        sw.clock += 1;
        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(sw.teardowns).toBe(1);
    });

    it('measures the ceiling from each request\'s own start', async () => {
        const { sw, tracker, backstop } = clockedShell();
        tracker.begin('action.send');
        sw.clock += AUTO_LOCK_REQUEST_CEILING_MS - TICK;
        tracker.begin('action.send');
        sw.clock += TICK;
        // The first request is past its ceiling; the second still holds.
        expect(await backstop.maybeAutoLock()).toBe('deferred');
        sw.clock += AUTO_LOCK_REQUEST_CEILING_MS;
        expect(await backstop.maybeAutoLock()).toBe('locked');
    });

    it('a read never holds, however briefly it has run', async () => {
        const { tracker, backstop, sw } = clockedShell();
        tracker.begin('balances.wallet');
        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(sw.teardowns).toBe(1);
    });
});

describe('which UI requests hold a due idle lock', () => {
    let priorChrome;

    beforeEach(async () => {
        priorChrome = globalThis.chrome;
        globalThis.chrome = { storage: { session: sessionArea() } };
        await applyAutoLockSignal({ armed: true, idleMs: 60_000 }, 1_000);
    });

    afterEach(() => {
        globalThis.chrome = priorChrome;
    });

    function trackedShell(tracker) {
        const sw = { host: {}, vault: {}, teardowns: 0 };
        const backstop = createLockBackstop({
            lockDeps: () => ({ sessionBackend: flakyBackend(0), signingSecretBackend: flakyBackend(0) }),
            tearDownHost: () => { sw.host = null; sw.vault = null; sw.teardowns += 1; },
            isUnlocked: () => Boolean(sw.host && sw.vault),
            isRequestActive: () => tracker.isActive(),
            readAutoLockState,
            clearAutoLockState,
            shouldAutoLock,
            now: () => 61_000 + 120_000,
            logger: { log() { }, error() { } },
        });
        return { sw, backstop };
    }

    it('locks on the first due tick while reads the closed popup left wait on the network', async () => {
        const tracker = createUiRequestTracker();
        // The reads a closed, offline popup left in flight in the live drive.
        tracker.begin('balances.wallet');
        tracker.begin('coinpays.obligationsForAddress');
        tracker.begin('settings.get');
        const { sw, backstop } = trackedShell(tracker);

        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(sw.teardowns).toBe(1);
    });

    it('waits on a signing request until it settles', async () => {
        const tracker = createUiRequestTracker();
        const finish = tracker.begin('action.send');
        const { sw, backstop } = trackedShell(tracker);

        expect(await backstop.maybeAutoLock()).toBe('deferred');
        finish();
        finish();
        expect(tracker.isActive()).toBe(false);
        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(sw.teardowns).toBe(1);
    });

    it('names signing and broadcast routes as holding, and reads as not', () => {
        for (const type of ['action.send', 'action.psbt', 'auth.signPsbt', 'auth.signMessage', 'broadcast.signedTx', 'broadcast.queue.broadcast', 'multisigSign.signLocally']) {
            expect(requestHoldsAutoLock(type), type).toBe(true);
        }
        for (const type of ['balances.wallet', 'coinpays.obligationsForAddress', 'broadcast.queue.list', 'signer.status', 'wallet.list', undefined, 42]) {
            expect(requestHoldsAutoLock(type), String(type)).toBe(false);
        }
    });
});

describe('background.js delegates the lock sequence', () => {
    const bg = readFileSync(
        join(wsRoot, 'packages', 'extension', 'src', 'background.js'),
        'utf8',
    );

    // The behaviour above is only the service worker's behaviour while the SW
    // keeps using the sequencer; background.js registers chrome.* listeners at
    // module load and so cannot itself be imported and driven here.
    it('builds the shipping backstop and keeps no second copy of the flag', () => {
        expect(bg).toMatch(/createLockBackstop\(\{/);
        expect(bg).not.toMatch(/let lockCleanupPending/);
    });
});
