// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    AUTO_LOCK_REQUEST_CEILING_MS,
    createLockBackstop,
} from '../../../packages/extension/src/background/walletLock.js';
import {
    applyAutoLockSignal,
    armProvisionalAutoLock,
    clearAutoLockState,
    readAutoLockState,
    shouldAutoLock,
} from '../../../packages/extension/src/background/autoLockState.js';
import { dispatchPreHost } from '../../../packages/extension/src/background/sessionMeta.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function secretBackend(initial = null, clearFailures = 0) {
    let value = initial ? initial.slice() : null;
    let failures = clearFailures;
    return {
        load: vi.fn(async () => value?.slice() ?? null),
        save: vi.fn(async (next) => { value = next.slice(); }),
        clear: vi.fn(async () => {
            if (failures > 0) {
                failures -= 1;
                throw new Error('clear refused');
            }
            value = null;
        }),
        peek: () => value,
    };
}

function pendingStore(initial = false) {
    let value = initial;
    return {
        load: vi.fn(async () => value),
        save: vi.fn(async (next) => { value = next; }),
        peek: () => value,
    };
}

function shell({ session, signing, pending, state = null, clock = 10_000, unlocked = true }) {
    const sw = { host: unlocked ? {} : null, vault: unlocked ? {} : null, clock, state, teardowns: 0 };
    const backstop = createLockBackstop({
        lockDeps: () => ({ sessionBackend: session, signingSecretBackend: signing }),
        tearDownHost: () => {
            sw.host = null;
            sw.vault = null;
            sw.teardowns += 1;
        },
        isUnlocked: () => Boolean(sw.host && sw.vault),
        readAutoLockState: async () => sw.state,
        clearAutoLockState: async () => { sw.state = null; },
        shouldAutoLock,
        pendingStore: pending,
        now: () => sw.clock,
        logger: { log() {}, error() {} },
    });
    return { sw, backstop };
}

describe('worker-restart secret cleanup', () => {
    it('reloads a failed-clear marker and finishes cleanup after restart', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const session = secretBackend(new Uint8Array([1]));
        const signing = secretBackend(new Uint8Array([2]), 1);
        const pending = pendingStore();
        const due = { armed: true, idleMs: 1, lastActivity: 1 };
        const first = shell({ session, signing, pending, state: due });

        expect(await first.backstop.maybeAutoLock()).toBe('failed');
        expect(session.peek()).toBeNull();
        expect(signing.peek()).not.toBeNull();
        expect(pending.peek()).toBe(true);

        const restarted = shell({ session, signing, pending, unlocked: false });
        await restarted.backstop.whenReady();
        expect(restarted.backstop.cleanupPending).toBe(true);
        expect(await restarted.backstop.maybeAutoLock()).toBe('locked');
        expect(signing.peek()).toBeNull();
        expect(pending.peek()).toBe(false);
        consoleError.mockRestore();
    });

    it('sweeps an orphaned signing secret without a persisted marker', async () => {
        const session = secretBackend();
        const signing = secretBackend(new Uint8Array([2]));
        const { backstop } = shell({ session, signing, unlocked: false });

        expect(await backstop.maybeAutoLock()).toBe('skipped');
        expect(signing.peek()).toBeNull();
        expect(session.clear).not.toHaveBeenCalled();
    });

    it('does not sweep while a master key still exists', async () => {
        const session = secretBackend(new Uint8Array([1]));
        const signing = secretBackend(new Uint8Array([2]));
        const { backstop } = shell({ session, signing, unlocked: false });

        expect(await backstop.maybeAutoLock()).toBe('skipped');
        expect(signing.peek()).not.toBeNull();
        expect(signing.clear).not.toHaveBeenCalled();
    });

    it('fails closed when a fresh unlock cannot reset a stale marker', async () => {
        const pending = pendingStore(true);
        pending.save.mockRejectedValue(new Error('write refused'));
        const { backstop } = shell({
            session: secretBackend(new Uint8Array([1])),
            signing: secretBackend(new Uint8Array([2])),
            pending,
        });
        await backstop.whenReady();
        await expect(backstop.noteUnlocked()).rejects.toThrow('could not be reset');
        expect(backstop.cleanupPending).toBe(true);
    });

    it('does not sweep a secret while a new session starts', async () => {
        const session = secretBackend();
        const signing = secretBackend(new Uint8Array([2]));
        const gate = deferred();
        const entered = deferred();
        signing.load.mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
            return new Uint8Array([2]);
        });
        const { backstop } = shell({ session, signing, unlocked: false });

        const sweep = backstop.maybeAutoLock();
        await entered.promise;
        backstop.noteSessionStarting();
        gate.resolve();
        expect(await sweep).toBe('skipped');
        expect(signing.clear).not.toHaveBeenCalled();
    });
});

// Holds the next marker save until released, the shape of a slow storage write.
function delayNextSave(pending) {
    const gate = deferred();
    const entered = deferred();
    const save = pending.save.getMockImplementation();
    pending.save.mockImplementationOnce(async (next) => {
        entered.resolve();
        await gate.promise;
        return save(next);
    });
    return { entered: entered.promise, release: gate.resolve };
}

describe('persisted cleanup marker ordering', () => {
    it('keeps a failed lock marked after a slower unlock reset lands', async () => {
        const pending = pendingStore();
        const session = secretBackend();
        const signing = secretBackend(new Uint8Array([2]));
        const { backstop } = shell({ session, signing, pending });
        await backstop.whenReady();

        const slow = delayNextSave(pending);
        const unlocked = backstop.noteUnlocked();
        await slow.entered;
        const locked = backstop.onLocked({ secretsCleared: false });
        slow.release();
        await Promise.all([unlocked, locked]);

        expect(backstop.cleanupPending).toBe(true);
        expect(pending.peek()).toBe(true);
        const restarted = shell({ session, signing, pending, unlocked: false });
        await restarted.backstop.whenReady();
        expect(restarted.backstop.cleanupPending).toBe(true);
    });

    it('leaves a fresh unlock unmarked after a slower failed-lock save lands', async () => {
        const pending = pendingStore();
        const { backstop } = shell({ session: secretBackend(), signing: secretBackend(), pending });
        await backstop.whenReady();

        const slow = delayNextSave(pending);
        const locked = backstop.onLocked({ secretsCleared: false });
        await slow.entered;
        const unlocked = backstop.noteUnlocked();
        slow.release();
        await Promise.all([locked, unlocked]);

        expect(backstop.cleanupPending).toBe(false);
        expect(pending.peek()).toBe(false);
    });

    it('does not let a superseded failed reset reopen a later lock marker', async () => {
        const pending = pendingStore();
        const { backstop } = shell({ session: secretBackend(), signing: secretBackend(), pending });
        await backstop.whenReady();

        pending.save.mockRejectedValueOnce(new Error('write refused'));
        const unlocked = backstop.noteUnlocked();
        const locked = backstop.onLocked({ secretsCleared: false });
        await expect(unlocked).resolves.toBeUndefined();
        await locked;

        expect(backstop.cleanupPending).toBe(true);
        expect(pending.peek()).toBe(true);
    });
});

describe('missing auto-lock records', () => {
    it('locks a restored live session with no deadline record', async () => {
        const { sw, backstop } = shell({
            session: secretBackend(new Uint8Array([1])),
            signing: secretBackend(new Uint8Array([2])),
        });
        expect(await backstop.maybeAutoLock()).toBe('locked');
        expect(sw.teardowns).toBe(1);
    });

    it('keeps an explicitly disarmed live session open', async () => {
        const { sw, backstop } = shell({
            session: secretBackend(new Uint8Array([1])),
            signing: secretBackend(new Uint8Array([2])),
            state: { armed: false },
        });
        expect(await backstop.maybeAutoLock()).toBe('skipped');
        expect(sw.teardowns).toBe(0);
    });

    it('defers only while an unlock is settling inside the cap', async () => {
        const setup = shell({
            session: secretBackend(new Uint8Array([1])),
            signing: secretBackend(new Uint8Array([2])),
        });
        await setup.backstop.noteUnlocked();
        expect(await setup.backstop.maybeAutoLock()).toBe('deferred');
        setup.backstop.noteUnlockSettled();
        expect(await setup.backstop.maybeAutoLock()).toBe('locked');

        const capped = shell({
            session: secretBackend(new Uint8Array([1])),
            signing: secretBackend(new Uint8Array([2])),
        });
        await capped.backstop.noteUnlocked();
        capped.sw.clock += AUTO_LOCK_REQUEST_CEILING_MS;
        expect(await capped.backstop.maybeAutoLock()).toBe('locked');
    });
});

// Every settled unlock leaves a record, so the missing-record lock above never
// reaches a wallet whose auto-lock is off: Never and a foreground disarm both
// write an explicit disarmed record through the real record writer.
describe('missing-record lock against the real record writer', () => {
    function installSessionArea() {
        const store = new Map();
        globalThis.chrome = {
            storage: {
                session: {
                    async get(key) { return store.has(key) ? { [key]: store.get(key) } : {}; },
                    async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
                    async remove(key) { store.delete(key); },
                },
            },
        };
    }

    function liveShell() {
        const sw = { host: {}, vault: {}, teardowns: 0 };
        const backstop = createLockBackstop({
            lockDeps: () => ({ sessionBackend: secretBackend(new Uint8Array([1])), signingSecretBackend: secretBackend() }),
            tearDownHost: () => { sw.host = null; sw.vault = null; sw.teardowns += 1; },
            isUnlocked: () => Boolean(sw.host && sw.vault),
            readAutoLockState,
            clearAutoLockState,
            shouldAutoLock,
            now: () => 10_000_000,
            logger: { log() {}, error() {} },
        });
        return { sw, backstop };
    }

    it('keeps a Never wallet open after its unlock settles', async () => {
        installSessionArea();
        const { sw, backstop } = liveShell();
        await clearAutoLockState();
        await backstop.noteUnlocked();
        await armProvisionalAutoLock(() => ({ autolockMinutes: 0 }), 5_000);
        backstop.noteUnlockSettled();
        expect(await backstop.maybeAutoLock()).toBe('skipped');
        expect(sw.teardowns).toBe(0);
    });

    it('keeps a wallet the foreground disarmed open', async () => {
        installSessionArea();
        const { sw, backstop } = liveShell();
        await armProvisionalAutoLock(() => ({ autolockMinutes: 15 }), 5_000);
        await applyAutoLockSignal({ armed: false, issuedAt: 6_000 }, 6_000);
        expect(await backstop.maybeAutoLock()).toBe('skipped');
        expect(sw.teardowns).toBe(0);
    });
});

// Holds the first marker load until released, the shape of a cold worker wake.
function gatedMarkerLoad(pending, outcome) {
    const gate = deferred();
    pending.load.mockImplementationOnce(async () => {
        await gate.promise;
        return outcome();
    });
    return gate.resolve;
}

// Reads session.status through the pre-host dispatcher the way the extension wires it.
function coldStatusRead(outcome) {
    const pending = pendingStore();
    const release = gatedMarkerLoad(pending, outcome);
    const session = secretBackend(new Uint8Array([1]));
    const { backstop } = shell({ session, signing: secretBackend(new Uint8Array([2])), pending, unlocked: false });
    const status = dispatchPreHost('session.status', null, {
        storageBackend: { async load() { return new Uint8Array([1]); } },
        sessionBackend: session,
        metaBackend: { async load() { return null; } },
        isLockPending: () => backstop.isLockPending(),
    });
    const early = {};
    status.then((value) => { early.value = value; }, (err) => { early.error = err; });
    return { status, early, release };
}

const settleTurn = () => new Promise((done) => { setTimeout(done, 0); });

describe('session status on a cold backstop', () => {
    it('waits for the persisted marker before reporting a live session', async () => {
        const { status, early, release } = coldStatusRead(() => false);
        await settleTurn();
        expect(early.value?.state).toBeUndefined();
        release();
        await expect(status).resolves.toMatchObject({ hasSession: true, state: 'unlocked' });
    });

    it('reports locked when the persisted marker says a clear is pending', async () => {
        const { status, release } = coldStatusRead(() => true);
        release();
        await expect(status).resolves.toMatchObject({ hasSession: false, state: 'locked' });
    });

    it('reports locked when the persisted marker cannot be read', async () => {
        const { status, release } = coldStatusRead(() => { throw new Error('read refused'); });
        release();
        await expect(status).resolves.toMatchObject({ hasSession: false, state: 'locked' });
    });
});
