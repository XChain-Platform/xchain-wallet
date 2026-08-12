// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SSC-7: the pre-unlock guards live in native storage on the native shells
// (§3).
//
// The property under test is not "the records round-trip". It is that each of
// the three fails SILENTLY and PERMISSIVELY when its store disappears, so a
// wallet whose WebView storage was evicted has: no failed-attempt ladder, no
// duress passphrase, and no signing freeze - while telling the user nothing.
// Every test here is a variation on "the WebView store went away".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaultStatus, __setNativeVaultForTests, encodePayload } from '../../../packages/web/src/storage/nativeVault.js';
import { __resetBackendCacheForTests } from '../../../packages/web/src/storage/backends.js';
import {
    installNativeGuardPersistence,
    __resetNativeGuardsForTests,
} from '../../../packages/web/src/storage/nativeGuards.js';
import {
    getLockoutState,
    recordLockoutFailure,
    clearLockoutState,
    configureLockoutPersistence,
    LOCKOUT_STORAGE_KEY,
    isDuressConfigured,
    setDuressPassphrase,
    isDuressMatch,
    clearDuressPassphrase,
    configureDuressPersistence,
    DURESS_STORAGE_KEY,
    configurePanicModePersistence,
    activatePanicMode,
    isSigningFrozen,
    getPanicModeState,
    clearPanicModeState,
    PANIC_STORAGE_KEY,
} from '../../../packages/core/src/flows/index.js';

/** In-memory stand-in for localStorage, so a test can evict it wholesale. */
function fakeLocalStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
        map,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
    };
}

/** Stand-in for the native plugin's guard slot. */
function fakePlugin(seed = null) {
    const state = { guards: seed };
    return {
        state,
        loadVault: vi.fn(async () => ({ status: VaultStatus.ABSENT })),
        saveVault: vi.fn(async () => ({ status: VaultStatus.OK })),
        clearVault: vi.fn(async () => ({ status: VaultStatus.OK })),
        loadMeta: vi.fn(async () => ({ status: VaultStatus.ABSENT })),
        saveMeta: vi.fn(async () => ({ status: VaultStatus.OK })),
        clearMeta: vi.fn(async () => ({ status: VaultStatus.OK })),
        loadGuards: vi.fn(async () => (state.guards === null
            ? { status: VaultStatus.ABSENT }
            : { status: VaultStatus.OK, blob: state.guards })),
        saveGuards: vi.fn(async ({ blob }) => { state.guards = blob; return { status: VaultStatus.OK }; }),
        clearGuards: vi.fn(async () => { state.guards = null; return { status: VaultStatus.OK }; }),
        biometricClear: vi.fn(async () => ({ status: VaultStatus.OK })),
        biometricStatus: vi.fn(async () => ({ status: VaultStatus.OK, available: false, enrolled: false })),
    };
}

/** The mirror to native is fire-and-forget; let its chain settle. */
async function drainWrites() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function asBlob(obj) {
    return encodePayload(new TextEncoder().encode(JSON.stringify(obj)));
}

function readBlob(blob) {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(blob), (c) => c.charCodeAt(0))));
}

/** Put the process on a "native shell" with the given plugin. */
function onNativeShell(plugin, storage = fakeLocalStorage()) {
    globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { XChainVault: plugin } };
    __setNativeVaultForTests(plugin);
    globalThis.localStorage = storage;
    return storage;
}

beforeEach(() => {
    __resetBackendCacheForTests();
    __resetNativeGuardsForTests();
});

afterEach(async () => {
    // Detach the injected stores before the next test, or a leftover view
    // writes into a plugin that is already gone.
    await configureLockoutPersistence(null);
    await configureDuressPersistence(null);
    await configurePanicModePersistence(null);
    clearLockoutState();
    clearDuressPassphrase();
    clearPanicModeState();
    __setNativeVaultForTests(undefined);
    __resetBackendCacheForTests();
    __resetNativeGuardsForTests();
    delete globalThis.Capacitor;
    delete globalThis.localStorage;
});

describe('installation', () => {
    it('does nothing in a browser, where localStorage stays the store', async () => {
        globalThis.localStorage = fakeLocalStorage();
        expect(await installNativeGuardPersistence()).toBe(false);

        setDuressPassphrase('under duress');
        expect(globalThis.localStorage.map.has(DURESS_STORAGE_KEY)).toBe(true);
    });

    it('installs on a native shell', async () => {
        const plugin = fakePlugin();
        onNativeShell(plugin);
        expect(await installNativeGuardPersistence()).toBe(true);
        expect(plugin.loadGuards).toHaveBeenCalled();
    });

    it('leaves the flows on localStorage when the slot is unreadable', async () => {
        // An inert duress passphrase is worse than an evictable one, so a
        // guard store that cannot answer must not be adopted.
        const plugin = fakePlugin();
        plugin.loadGuards = vi.fn(async () => { throw new Error('keystore is locked'); });
        const storage = onNativeShell(plugin);

        expect(await installNativeGuardPersistence()).toBe(false);
        setDuressPassphrase('under duress');
        expect(storage.map.has(DURESS_STORAGE_KEY)).toBe(true);
        expect(isDuressMatch('under duress')).toBe(true);
    });
});

describe('the WebView store going away', () => {
    it('keeps a duress passphrase that an eviction would have disarmed', async () => {
        const plugin = fakePlugin();
        const storage = onNativeShell(plugin);
        await installNativeGuardPersistence();

        setDuressPassphrase('under duress');
        expect(isDuressConfigured()).toBe(true);
        // It never touched the evictable store in the first place.
        expect(storage.map.has(DURESS_STORAGE_KEY)).toBe(false);

        // Evict every scrap of WebView storage and boot again. The flows are
        // synchronous and mirror to native fire-and-forget, so drain the write
        // chain first: a reboot in the same tick races the mirror, not the fix.
        await drainWrites();
        expect(plugin.saveGuards).toHaveBeenCalled();
        __resetNativeGuardsForTests();
        onNativeShell(plugin, fakeLocalStorage());
        await installNativeGuardPersistence();

        expect(isDuressConfigured()).toBe(true);
        expect(isDuressMatch('under duress')).toBe(true);
        expect(isDuressMatch('not it')).toBe(false);
    });

    it('keeps the failed-attempt ladder an eviction would have reset to zero', async () => {
        const plugin = fakePlugin();
        onNativeShell(plugin);
        await installNativeGuardPersistence();

        recordLockoutFailure(1_000);
        recordLockoutFailure(1_000);
        const armed = recordLockoutFailure(1_000);
        expect(armed.failedAttempts).toBe(3);
        expect(armed.lockedUntilMs).toBeGreaterThan(1_000);

        await drainWrites();
        __resetNativeGuardsForTests();
        onNativeShell(plugin, fakeLocalStorage());
        await installNativeGuardPersistence();

        expect(getLockoutState().failedAttempts).toBe(3);
    });

    it('keeps a panic freeze an eviction would have lifted', async () => {
        const plugin = fakePlugin();
        onNativeShell(plugin);
        await installNativeGuardPersistence();

        activatePanicMode({ durationMs: 60 * 60 * 1000, nowMs: 5_000 });
        expect(isSigningFrozen(getPanicModeState(), 6_000)).toBe(true);

        await drainWrites();
        __resetNativeGuardsForTests();
        onNativeShell(plugin, fakeLocalStorage());
        await installNativeGuardPersistence();

        expect(isSigningFrozen(getPanicModeState(), 6_000)).toBe(true);
    });
});

describe('migration off localStorage', () => {
    it('adopts records an existing install already had, and only then drops them', async () => {
        // The fix causing the failure it prevents: an installed wallet has its
        // duress passphrase in localStorage, the native slot starts empty, and
        // a first boot that read only the slot would report "not configured".
        const legacy = fakeLocalStorage();
        const plugin = fakePlugin();
        onNativeShell(plugin, legacy);

        // Arm it the old way, with no native store installed.
        setDuressPassphrase('under duress');
        recordLockoutFailure(1_000);
        expect(legacy.map.has(DURESS_STORAGE_KEY)).toBe(true);
        expect(legacy.map.has(LOCKOUT_STORAGE_KEY)).toBe(true);

        await installNativeGuardPersistence();

        expect(isDuressMatch('under duress')).toBe(true);
        expect(getLockoutState().failedAttempts).toBe(1);
        // Written natively BEFORE the legacy copy is removed.
        expect(plugin.state.guards).not.toBeNull();
        const persisted = readBlob(plugin.state.guards);
        expect(persisted.duress.hash).toEqual(expect.any(String));
        expect(persisted.lockout.failedAttempts).toBe(1);
        expect(legacy.map.has(DURESS_STORAGE_KEY)).toBe(false);
        expect(legacy.map.has(LOCKOUT_STORAGE_KEY)).toBe(false);
    });

    it('keeps the legacy copy when the migration write fails', async () => {
        // An interrupted migration must leave the record readable by the OLD
        // path rather than by neither.
        const legacy = fakeLocalStorage();
        const plugin = fakePlugin();
        onNativeShell(plugin, legacy);
        setDuressPassphrase('under duress');

        plugin.saveGuards = vi.fn(async () => ({ status: VaultStatus.LOCKED, detail: 'keystore is locked' }));
        await installNativeGuardPersistence();

        expect(legacy.map.has(DURESS_STORAGE_KEY)).toBe(true);
        // And it still works this session, off the hydrated cache.
        expect(isDuressMatch('under duress')).toBe(true);
    });

    it('lets the native record win over a stale legacy one', async () => {
        const plugin = fakePlugin(asBlob({ lockout: { failedAttempts: 4, lockedUntilMs: 0 } }));
        const legacy = fakeLocalStorage({
            [LOCKOUT_STORAGE_KEY]: JSON.stringify({ failedAttempts: 1, lockedUntilMs: 0 }),
        });
        onNativeShell(plugin, legacy);

        await installNativeGuardPersistence();
        expect(getLockoutState().failedAttempts).toBe(4);
    });

    it('survives an unparseable legacy record rather than throwing at boot', async () => {
        const plugin = fakePlugin();
        onNativeShell(plugin, fakeLocalStorage({ [DURESS_STORAGE_KEY]: 'not json' }));

        expect(await installNativeGuardPersistence()).toBe(true);
        expect(isDuressConfigured()).toBe(false);
    });

    it('survives an unparseable NATIVE record rather than trapping the user out', async () => {
        // Asymmetric with the meta slot on purpose: corrupt kdfParams mean the
        // wallet cannot open and must say so; a corrupt lockout counter must
        // not be a reason to refuse a password.
        const plugin = fakePlugin();
        plugin.loadGuards = vi.fn(async () => ({ status: VaultStatus.OK, blob: encodePayload(new TextEncoder().encode('{{{')) }));
        onNativeShell(plugin);

        expect(await installNativeGuardPersistence()).toBe(true);
        expect(isDuressConfigured()).toBe(false);
    });
});

describe('the shared blob', () => {
    it('does not lose one guard when another is written in the same tick', async () => {
        const plugin = fakePlugin();
        onNativeShell(plugin);
        await installNativeGuardPersistence();

        setDuressPassphrase('under duress');
        recordLockoutFailure(1_000);
        activatePanicMode({ durationMs: 60 * 60 * 1000, nowMs: 5_000 });
        await drainWrites();

        const persisted = readBlob(plugin.state.guards);
        expect(Object.keys(persisted).sort()).toEqual(['duress', 'lockout', 'panic']);
    });

    it('clears one guard without taking the others with it', async () => {
        const plugin = fakePlugin();
        onNativeShell(plugin);
        await installNativeGuardPersistence();

        setDuressPassphrase('under duress');
        recordLockoutFailure(1_000);
        await drainWrites();

        clearDuressPassphrase();
        await drainWrites();

        expect(isDuressConfigured()).toBe(false);
        expect(getLockoutState().failedAttempts).toBe(1);
        const persisted = readBlob(plugin.state.guards);
        expect(persisted.duress).toBeUndefined();
        expect(persisted.lockout.failedAttempts).toBe(1);
    });
});
