// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A native shell whose vault plugin never registered.
//
// The bug this locks out was silent by construction. `hasNativeVault()` is a
// duck-type probe, and ANY miss - Capacitor global absent, `isNativePlatform`
// false, no `loadVault` method - fell through to IndexedDB. In a browser that
// is exactly right. On a native shell it is the disaster case: the wallet
// works perfectly, storing the only copy of the vault in WebView storage,
// until the OS reclaims it or the user taps "Clear data", on a build whose
// backup posture guarantees there is no second copy anywhere.
//
// So the test that matters is not "does it pick the native backend" but "does
// it REFUSE to pick a backend at all" in the one state that used to look like
// a browser. The registration is easy to lose on both shells and the iOS twin
// actually lost it once, so this is a regression guard for something that has
// already happened, not a hypothetical.

import { describe, it, expect, afterEach } from 'vitest';
import { storage as coreStorage } from '@xchain-wallet/core';
import {
    BROKEN_SHELL_MESSAGE,
    isNativeShell,
    nativeShellIsBroken,
    __setNativeShellForTests,
    __setNativeVaultForTests,
} from '../../../packages/web/src/storage/nativeVault.js';
import {
    createMetaBackend,
    createStorageBackend,
    installNativeScreenGuard,
    installNativeWipeHook,
    storageBackendName,
    usingNativeVault,
    __resetBackendCacheForTests,
} from '../../../packages/web/src/storage/backends.js';

const { VaultUnavailableError } = coreStorage;

/** Enough of the plugin surface for the duck-type probe to accept it. */
const fakePlugin = () => ({ loadVault: async () => ({ status: 'ABSENT' }) });

afterEach(() => {
    __setNativeShellForTests(undefined);
    __setNativeVaultForTests(undefined);
    __resetBackendCacheForTests();
    delete globalThis.Capacitor;
});

describe('isNativeShell', () => {
    it('is false in an ordinary browser', () => {
        expect(isNativeShell({})).toBe(false);
    });

    it('is false for a page that merely defines window.Capacitor', () => {
        // Some dApp libraries do exactly this. Treating it as a native shell
        // would block the WEB wallet from opening at all.
        expect(isNativeShell({ Capacitor: {} })).toBe(false);
        expect(isNativeShell({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    });

    it('is true inside the shell, plugin or no plugin', () => {
        // The whole point: this question must be answerable WITHOUT the
        // plugin, because the broken case is the one where it is missing.
        expect(isNativeShell({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    });
});

describe('nativeShellIsBroken', () => {
    it('is false in a browser', () => {
        __setNativeShellForTests(false);
        __setNativeVaultForTests(null);
        expect(nativeShellIsBroken()).toBe(false);
    });

    it('is false in a healthy shell', () => {
        __setNativeShellForTests(true);
        __setNativeVaultForTests(fakePlugin());
        expect(nativeShellIsBroken()).toBe(false);
    });

    it('is true in a shell whose plugin never registered', () => {
        __setNativeShellForTests(true);
        __setNativeVaultForTests(null);
        expect(nativeShellIsBroken()).toBe(true);
    });
});

describe('the backend factory on a broken shell', () => {
    const asBrokenShell = () => {
        __setNativeShellForTests(true);
        __setNativeVaultForTests(null);
        __resetBackendCacheForTests();
    };

    it('refuses instead of downgrading to WebView storage', () => {
        asBrokenShell();
        expect(() => usingNativeVault()).toThrow(VaultUnavailableError);
        expect(() => createStorageBackend()).toThrow(VaultUnavailableError);
        expect(() => createMetaBackend()).toThrow(VaultUnavailableError);
    });

    it('says what is wrong in words a wallet user can act on', () => {
        asBrokenShell();
        expect(() => usingNativeVault()).toThrow(/did not load/);
        // Not jargon, and not a shrug: it names the cause, the refusal, and
        // the fact that the recovery phrase still works elsewhere.
        expect(BROKEN_SHELL_MESSAGE).toMatch(/recovery phrase/i);
        expect(BROKEN_SHELL_MESSAGE).toMatch(/reinstall/i);
    });

    it('refuses from the diagnostic and install paths too', () => {
        // Any of these returning "indexeddb" or false would be the same
        // silent downgrade wearing a different name.
        asBrokenShell();
        expect(() => storageBackendName()).toThrow(VaultUnavailableError);
        expect(() => installNativeScreenGuard()).toThrow(VaultUnavailableError);
        expect(() => installNativeWipeHook()).toThrow(VaultUnavailableError);
    });

    it('does not poison the cache, so a shell that recovers still works', () => {
        asBrokenShell();
        expect(() => usingNativeVault()).toThrow(VaultUnavailableError);
        __setNativeVaultForTests(fakePlugin());
        expect(usingNativeVault()).toBe(true);
        expect(storageBackendName()).toBe('native-vault');
    });
});

describe('the states that must keep working', () => {
    it('a browser still gets IndexedDB', () => {
        __setNativeShellForTests(false);
        __setNativeVaultForTests(null);
        __resetBackendCacheForTests();
        expect(usingNativeVault()).toBe(false);
        expect(storageBackendName()).toBe('indexeddb');
    });

    it('a healthy shell still gets the native vault', () => {
        __setNativeShellForTests(true);
        __setNativeVaultForTests(fakePlugin());
        __resetBackendCacheForTests();
        expect(usingNativeVault()).toBe(true);
        expect(storageBackendName()).toBe('native-vault');
    });
});
