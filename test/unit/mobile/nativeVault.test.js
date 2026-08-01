// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The native vault seam ( S2), tested against a fake plugin.
//
// ONE PROPERTY MATTERS MORE THAN THE REST and most of this file is about it:
// `load()` may return null ONLY when the device genuinely has no wallet.
// Every shell turns null into the create-a-new-wallet screen, so a backend
// that answers null after a failed decrypt or a locked keystore walks a user
// with a real vault to the one screen that can overwrite it. Locked, corrupt,
// malformed, unrecognized, and outright crashed must all throw instead.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    VaultStatus,
    decodeReadReply,
    callNativeVault,
    hasNativeVault,
    getNativeVault,
    encodePayload,
    __setNativeVaultForTests,
} from '../../../packages/web/src/storage/nativeVault.js';
import {
    CapacitorStorageBackend,
    CapacitorMetaBackend,
} from '../../../packages/web/src/storage/CapacitorStorageBackend.js';
import {
    createStorageBackend,
    createMetaBackend,
    usingNativeVault,
    storageBackendName,
    installNativeWipeHook,
    __resetBackendCacheForTests,
} from '../../../packages/web/src/storage/backends.js';
import {
    VaultLockedError,
    VaultCorruptError,
    VaultUnavailableError,
} from '../../../packages/core/src/storage/backend.js';
import { IndexedDBStorageBackend } from '../../../packages/web/src/storage/IndexedDBStorageBackend.js';

/** Minimal in-memory stand-in for the Java plugin. */
function fakePlugin(overrides = {}) {
    const state = { vault: null, meta: null };
    return {
        state,
        loadVault: vi.fn(async () => (state.vault === null
            ? { status: VaultStatus.ABSENT }
            : { status: VaultStatus.OK, blob: state.vault })),
        saveVault: vi.fn(async ({ blob }) => { state.vault = blob; return { status: VaultStatus.OK }; }),
        clearVault: vi.fn(async () => { state.vault = null; return { status: VaultStatus.OK }; }),
        loadMeta: vi.fn(async () => (state.meta === null
            ? { status: VaultStatus.ABSENT }
            : { status: VaultStatus.OK, blob: state.meta })),
        saveMeta: vi.fn(async ({ blob }) => { state.meta = blob; return { status: VaultStatus.OK }; }),
        clearMeta: vi.fn(async () => { state.meta = null; return { status: VaultStatus.OK }; }),
        biometricClear: vi.fn(async () => ({ status: VaultStatus.OK })),
        ...overrides,
    };
}

afterEach(() => {
    __setNativeVaultForTests(undefined);
    __resetBackendCacheForTests();
    delete globalThis.Capacitor;
    delete globalThis.xchainWalletBridge;
});

describe('platform detection', () => {
    it('finds nothing in a plain browser', () => {
        expect(hasNativeVault()).toBe(false);
        expect(getNativeVault()).toBeNull();
    });

    it('ignores a Capacitor global that says it is not native', () => {
        // Some dApp libraries define window.Capacitor in ordinary pages. A
        // web wallet that mistook one for a shell would look for its vault in
        // a plugin that is not there.
        globalThis.Capacitor = {
            isNativePlatform: () => false,
            Plugins: { XChainVault: fakePlugin() },
        };
        expect(hasNativeVault()).toBe(false);
    });

    it('ignores a plugin object that does not implement the contract', () => {
        globalThis.Capacitor = {
            isNativePlatform: () => true,
            Plugins: { XChainVault: { somethingElse() {} } },
        };
        expect(hasNativeVault()).toBe(false);
    });

    it('accepts a native platform carrying the real plugin', () => {
        globalThis.Capacitor = {
            isNativePlatform: () => true,
            Plugins: { XChainVault: fakePlugin() },
        };
        expect(hasNativeVault()).toBe(true);
    });
});

describe('decodeReadReply: absence is a fact, not a fallback', () => {
    it('maps ABSENT to null', () => {
        expect(decodeReadReply({ status: 'ABSENT' })).toBeNull();
    });

    it('maps OK to the decoded bytes', () => {
        const bytes = decodeReadReply({ status: 'OK', blob: 'AQID' });
        expect(Array.from(bytes)).toEqual([1, 2, 3]);
    });

    it('throws, never returns null, for every failure', () => {
        expect(() => decodeReadReply({ status: 'LOCKED' })).toThrow(VaultLockedError);
        expect(() => decodeReadReply({ status: 'CORRUPT' })).toThrow(VaultCorruptError);
        // OK with no payload is a broken plugin, not an empty wallet.
        expect(() => decodeReadReply({ status: 'OK' })).toThrow(VaultCorruptError);
    });

    it('refuses statuses it does not recognize', () => {
        // A future native version with a fifth status must fail loudly. The
        // dangerous version of this code treats "anything unexpected" as
        // absence.
        for (const reply of [undefined, null, {}, { status: 'MAYBE' }, { status: 42 }]) {
            expect(() => decodeReadReply(reply)).toThrow(VaultUnavailableError);
        }
    });

    it('keeps the native detail so the user sees why', () => {
        expect(() => decodeReadReply({ status: 'LOCKED', detail: 'device is locked' }))
            .toThrow(/device is locked/);
    });
});

describe('callNativeVault', () => {
    it('reports unavailable rather than absent when there is no plugin', async () => {
        __setNativeVaultForTests(null);
        await expect(callNativeVault('loadVault')).rejects.toThrow(VaultUnavailableError);
    });

    it('reports unavailable when the shell build lacks the method', async () => {
        __setNativeVaultForTests({ loadVault: async () => ({ status: 'ABSENT' }) });
        await expect(callNativeVault('biometricUnlock')).rejects.toThrow(/does not implement/);
    });

    it('wraps a native crash as unavailable', async () => {
        __setNativeVaultForTests({
            loadVault: async () => { throw new Error('binder died'); },
        });
        await expect(callNativeVault('loadVault')).rejects.toThrow(/binder died/);
        await expect(callNativeVault('loadVault')).rejects.toThrow(VaultUnavailableError);
    });
});

describe('CapacitorStorageBackend', () => {
    let plugin;
    beforeEach(() => {
        plugin = fakePlugin();
        __setNativeVaultForTests(plugin);
    });

    it('round-trips a blob through the bridge', async () => {
        const backend = new CapacitorStorageBackend();
        expect(await backend.load()).toBeNull();
        await backend.save(new Uint8Array([9, 8, 7]));
        expect(Array.from(await backend.load())).toEqual([9, 8, 7]);
        await backend.clear();
        expect(await backend.load()).toBeNull();
    });

    it('refuses to persist an empty vault', async () => {
        const backend = new CapacitorStorageBackend();
        await expect(backend.save(new Uint8Array(0))).rejects.toThrow(/empty vault/);
        expect(plugin.saveVault).not.toHaveBeenCalled();
    });

    it('rejects a non-Uint8Array payload', async () => {
        const backend = new CapacitorStorageBackend();
        await expect(backend.save('deadbeef')).rejects.toThrow(/Uint8Array/);
    });

    it('treats a refused write as a failure, not a success', async () => {
        // The native side refuses when it could not read the existing vault.
        // Silence here would let the caller believe the save landed, and the
        // next lock would discard what was only ever in memory.
        __setNativeVaultForTests(fakePlugin({
            saveVault: async () => ({ status: 'LOCKED', detail: 'device is locked' }),
        }));
        await expect(new CapacitorStorageBackend().save(new Uint8Array([1])))
            .rejects.toThrow(VaultLockedError);
    });

    it('treats a silent write reply as a failure', async () => {
        __setNativeVaultForTests(fakePlugin({ saveVault: async () => ({}) }));
        await expect(new CapacitorStorageBackend().save(new Uint8Array([1])))
            .rejects.toThrow(/did not confirm the write/);
    });

    it('surfaces a locked keystore on load instead of empty state', async () => {
        __setNativeVaultForTests(fakePlugin({
            loadVault: async () => ({ status: 'LOCKED', detail: 'screen locked' }),
        }));
        await expect(new CapacitorStorageBackend().load()).rejects.toThrow(VaultLockedError);
    });
});

describe('CapacitorMetaBackend', () => {
    beforeEach(() => __setNativeVaultForTests(fakePlugin()));

    it('round-trips the kdfParams record', async () => {
        const meta = new CapacitorMetaBackend();
        expect(await meta.load()).toBeNull();
        await meta.save({ kdfParams: { salt: 'abc', m: 65536 } });
        expect(await meta.load()).toEqual({ kdfParams: { salt: 'abc', m: 65536 } });
        await meta.clear();
        expect(await meta.load()).toBeNull();
    });

    it('calls unparseable meta corruption, not absence', async () => {
        // Absence here would mean "no wallet on this device" while the vault
        // blob sits intact right next to it.
        __setNativeVaultForTests(fakePlugin({
            loadMeta: async () => ({ status: 'OK', blob: btoa('{not json') }),
        }));
        await expect(new CapacitorMetaBackend().load()).rejects.toThrow(VaultCorruptError);
    });
});

describe('backend factory', () => {
    it('picks IndexedDB in a browser', () => {
        __setNativeVaultForTests(null);
        expect(usingNativeVault()).toBe(false);
        expect(storageBackendName()).toBe('indexeddb');
        expect(createStorageBackend()).toBeInstanceOf(IndexedDBStorageBackend);
    });

    it('picks the native vault inside the shell', () => {
        __setNativeVaultForTests(fakePlugin());
        expect(usingNativeVault()).toBe(true);
        expect(storageBackendName()).toBe('native-vault');
        expect(createStorageBackend()).toBeInstanceOf(CapacitorStorageBackend);
        expect(createMetaBackend()).toBeInstanceOf(CapacitorMetaBackend);
    });

    it('does not change its mind mid-session', () => {
        // A plugin that starts failing must surface as a vault error on the
        // operation that failed - not as a silent fallback to an empty
        // IndexedDB, which presents exactly like a wiped wallet.
        __setNativeVaultForTests(fakePlugin());
        expect(usingNativeVault()).toBe(true);
        __setNativeVaultForTests(null);
        expect(usingNativeVault()).toBe(true);
    });
});

describe('wipe hook', () => {
    it('is not installed in a browser', () => {
        __setNativeVaultForTests(null);
        expect(installNativeWipeHook()).toBe(false);
        expect(globalThis.xchainWalletBridge).toBeUndefined();
    });

    it('clears vault, meta and the biometric wrap together', async () => {
        // "Forgot password" clears IndexedDB + localStorage itself and then
        // calls this hook. Miss any of the three and the reload lands back on
        // an unlock screen for the vault the user was just told was erased.
        const plugin = fakePlugin();
        __setNativeVaultForTests(plugin);
        expect(installNativeWipeHook()).toBe(true);
        const result = await globalThis.xchainWalletBridge.wipeStorage();
        expect(result).toEqual({ ok: true });
        expect(plugin.clearVault).toHaveBeenCalled();
        expect(plugin.clearMeta).toHaveBeenCalled();
        expect(plugin.biometricClear).toHaveBeenCalled();
    });

    it('reports a failed wipe instead of claiming success', async () => {
        // Core rejects on ok:false and the UI shows the reason. Returning
        // ok:true here would leave the user believing a wipe happened.
        __setNativeVaultForTests(fakePlugin({
            clearVault: async () => { throw new Error('keystore busy'); },
        }));
        installNativeWipeHook();
        const result = await globalThis.xchainWalletBridge.wipeStorage();
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/keystore busy/);
    });

    it('never displaces a hook another shell already published', () => {
        const existing = async () => ({ ok: true, from: 'desktop' });
        globalThis.xchainWalletBridge = { wipeStorage: existing };
        __setNativeVaultForTests(fakePlugin());
        installNativeWipeHook();
        expect(globalThis.xchainWalletBridge.wipeStorage).toBe(existing);
    });
});

describe('encodePayload', () => {
    it('refuses anything that is not bytes', () => {
        expect(() => encodePayload('not bytes')).toThrow(/Uint8Array/);
        expect(() => encodePayload(null)).toThrow(/Uint8Array/);
    });
});
