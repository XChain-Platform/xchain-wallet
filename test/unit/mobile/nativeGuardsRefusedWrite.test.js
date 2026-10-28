// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: a panic write the native guard slot refuses reaches the panic flow, so
// the freeze stays on and the Safety screen can say it is not saved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaultStatus, __setNativeVaultForTests } from '../../../packages/web/src/storage/nativeVault.js';
import { __resetBackendCacheForTests } from '../../../packages/web/src/storage/backends.js';
import {
    installNativeGuardPersistence,
    __resetNativeGuardsForTests,
} from '../../../packages/web/src/storage/nativeGuards.js';
import {
    clearLockoutState,
    configureLockoutPersistence,
    clearDuressPassphrase,
    configureDuressPersistence,
    configurePanicModePersistence,
    activatePanicMode,
    isSigningFrozen,
    clearPanicModeState,
    deactivatePanicMode,
    getPanicModeSaveStatus,
    PANIC_SAVE_OK,
    PANIC_SAVE_UNSAVED,
    PANIC_SAVE_CLEAR_FAILED,
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


describe('panic writes the native slot refuses', () => {
    it('keeps the freeze and reports it unsaved, without blocking the next write', async () => {
        const plugin = fakePlugin();
        onNativeShell(plugin);
        await installNativeGuardPersistence();
        plugin.saveGuards.mockImplementationOnce(async () => { throw new Error('disk full'); });

        activatePanicMode();
        await drainWrites();

        expect(isSigningFrozen()).toBe(true);
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_UNSAVED);

        activatePanicMode();
        await drainWrites();
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_OK);
        expect(readBlob(plugin.state.guards).panic.expiresAt).toBeGreaterThan(0);
    });

    it('keeps the freeze on when turning it off is refused', async () => {
        const plugin = fakePlugin();
        onNativeShell(plugin);
        await installNativeGuardPersistence();
        activatePanicMode();
        await drainWrites();
        plugin.saveGuards.mockImplementationOnce(async () => { throw new Error('disk full'); });

        expect(await deactivatePanicMode()).toBe(false);
        expect(isSigningFrozen()).toBe(true);
        expect(getPanicModeSaveStatus()).toBe(PANIC_SAVE_CLEAR_FAILED);
    });
});
