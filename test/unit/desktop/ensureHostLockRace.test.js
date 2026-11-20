/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import {
    closeHostAndClearSession,
    createRuntime,
    ensureHost,
    tearDownHost,
    wipeRuntimeStores,
} from '../../../packages/desktop/main/runtime.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function memoryBackend(initial = null) {
    let value = initial instanceof Uint8Array ? initial.slice() : initial;
    return {
        async load() { return value instanceof Uint8Array ? value.slice() : value; },
        async save(next) { value = next instanceof Uint8Array ? next.slice() : next; },
        async clear() { value = null; },
    };
}

function pausableBackend(initial = null) {
    const backend = memoryBackend(initial);
    let gate = null;
    let entered = null;
    let loads = 0;
    return {
        ...backend,
        async load() {
            loads += 1;
            if (gate) {
                entered.resolve();
                await gate.promise;
                gate = null;
            }
            return backend.load();
        },
        pauseNextLoad() {
            gate = deferred();
            entered = deferred();
            return { entered: entered.promise, release: gate.resolve };
        },
        get loads() { return loads; },
    };
}

// A store whose next clear waits, the shape of a wipe paused before it
// reaches the session key.
function pausableClearBackend(initial = null) {
    const backend = memoryBackend(initial);
    let gate = null;
    let entered = null;
    return {
        ...backend,
        async clear() {
            if (gate) {
                entered.resolve();
                await gate.promise;
                gate = null;
            }
            return backend.clear();
        },
        pauseNextClear() {
            gate = deferred();
            entered = deferred();
            return { entered: entered.promise, release: gate.resolve };
        },
    };
}

// A session store whose paused load answers what it held when the load
// began, the shape of a build that read the key before an unlock saved it.
function snapshotPausableBackend() {
    const backend = memoryBackend();
    let gate = null;
    let entered = null;
    return {
        ...backend,
        async load() {
            const snapshot = await backend.load();
            if (gate) {
                entered.resolve();
                await gate.promise;
                gate = null;
            }
            return snapshot;
        },
        pauseNextLoad() {
            gate = deferred();
            entered = deferred();
            return { entered: entered.promise, release: gate.resolve };
        },
    };
}

function runtimeWith(over = {}) {
    return createRuntime({
        storageBackend: memoryBackend(),
        sessionBackend: memoryBackend(new Uint8Array(32).fill(7)),
        metaBackend: memoryBackend(),
        chainRegistry: new ChainRegistry(),
        sdkRegistry: {},
        ...over,
    });
}

describe('desktop ensureHost lock races', () => {
    it('abandons a vault build overtaken while the vault opens', async () => {
        const storageBackend = pausableBackend();
        const pause = storageBackend.pauseNextLoad();
        const runtime = runtimeWith({ storageBackend });

        const building = ensureHost(runtime);
        await pause.entered;
        await runtime.sessionBackend.clear();
        tearDownHost(runtime);
        pause.release();

        await expect(building).resolves.toBeNull();
        expect(runtime.host).toBeNull();
        expect(runtime.vault).toBeNull();
        expect(runtime.signerPool.size()).toBe(0);
    });

    it('abandons a build overtaken during metadata restoration', async () => {
        const metaBackend = pausableBackend();
        const pause = metaBackend.pauseNextLoad();
        const runtime = runtimeWith({ metaBackend });

        const building = ensureHost(runtime);
        await pause.entered;
        await runtime.sessionBackend.clear();
        tearDownHost(runtime);
        pause.release();

        await expect(building).resolves.toBeNull();
        expect(runtime.host).toBeNull();
        expect(runtime.vault).toBeNull();
    });

    it('shares one vault build between overlapping callers', async () => {
        const storageBackend = pausableBackend();
        const pause = storageBackend.pauseNextLoad();
        const runtime = runtimeWith({ storageBackend });

        const first = ensureHost(runtime);
        await pause.entered;
        const second = ensureHost(runtime);
        pause.release();
        const [a, b] = await Promise.all([first, second]);

        expect(a).not.toBeNull();
        expect(b).toBe(a);
        expect(storageBackend.loads).toBe(1);
        tearDownHost(runtime);
    });
});

describe('desktop ensureHost joined callers after a teardown that keeps the key', () => {
    it('keeps a caller that joined before a wipe from rebuilding on the surviving key', async () => {
        const storageBackend = pausableBackend();
        const metaBackend = pausableClearBackend();
        const openPause = storageBackend.pauseNextLoad();
        const runtime = runtimeWith({ storageBackend, metaBackend });

        const first = ensureHost(runtime);
        await openPause.entered;
        const joined = ensureHost(runtime);
        const clearPause = metaBackend.pauseNextClear();
        const wiping = wipeRuntimeStores(runtime);
        await clearPause.entered;
        expect(await runtime.sessionBackend.load()).not.toBeNull();
        openPause.release();

        await expect(first).resolves.toBeNull();
        await expect(joined).resolves.toBeNull();
        expect(runtime.host).toBeNull();
        expect(runtime.vault).toBeNull();
        clearPause.release();
        await expect(wiping).resolves.toMatchObject({ ok: true });
        expect(runtime.host).toBeNull();
        expect(await runtime.sessionBackend.load()).toBeNull();
    });

    it('keeps a joined caller locked when a teardown runs before its session clear', async () => {
        const storageBackend = pausableBackend();
        const pause = storageBackend.pauseNextLoad();
        const runtime = runtimeWith({ storageBackend });

        const first = ensureHost(runtime);
        await pause.entered;
        const joined = ensureHost(runtime);
        tearDownHost(runtime);
        pause.release();

        await expect(first).resolves.toBeNull();
        await expect(joined).resolves.toBeNull();
        expect(runtime.host).toBeNull();
        expect(runtime.vault).toBeNull();
        expect(runtime.signerPool.size()).toBe(0);
    });
});

describe('desktop host stays closed while a session clear is pending', () => {
    it('builds nothing from the session key while a wipe is still clearing stores', async () => {
        const metaBackend = pausableClearBackend();
        const runtime = runtimeWith({ metaBackend });
        const clearPause = metaBackend.pauseNextClear();

        const wiping = wipeRuntimeStores(runtime);
        await clearPause.entered;
        expect(await runtime.sessionBackend.load()).not.toBeNull();
        await expect(ensureHost(runtime)).resolves.toBeNull();
        expect(runtime.host).toBeNull();
        expect(runtime.vault).toBeNull();

        clearPause.release();
        await expect(wiping).resolves.toMatchObject({ ok: true });
        await expect(ensureHost(runtime)).resolves.toBeNull();
    });

    it('builds nothing while a teardown waits on its session clear', async () => {
        const storageBackend = pausableBackend();
        const sessionBackend = pausableClearBackend(new Uint8Array(32).fill(7));
        const openPause = storageBackend.pauseNextLoad();
        const runtime = runtimeWith({ storageBackend, sessionBackend });

        const building = ensureHost(runtime);
        await openPause.entered;
        const clearPause = sessionBackend.pauseNextClear();
        const closing = closeHostAndClearSession(runtime);
        await clearPause.entered;
        const late = ensureHost(runtime);
        openPause.release();

        await expect(building).resolves.toBeNull();
        await expect(late).resolves.toBeNull();
        expect(runtime.host).toBeNull();
        clearPause.release();
        await closing;
        expect(await sessionBackend.load()).toBeNull();
        expect(runtime.hostClosedHolds).toBe(0);
    });
});

describe('desktop ensureHost joined caller after an unlock', () => {
    it('lets a caller that joined a keyless build open the session an unlock just saved', async () => {
        const sessionBackend = snapshotPausableBackend();
        const pause = sessionBackend.pauseNextLoad();
        const runtime = runtimeWith({ sessionBackend });

        const first = ensureHost(runtime);
        await pause.entered;
        await sessionBackend.save(new Uint8Array(32).fill(7));
        const joined = ensureHost(runtime);
        pause.release();

        await expect(first).resolves.toBeNull();
        const host = await joined;
        expect(host).not.toBeNull();
        expect(runtime.host).toBe(host);
        tearDownHost(runtime);
    });
});
