// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    __resetBackendCacheForTests,
    installNativeWipeHook,
} from '../../../packages/web/src/storage/backends.js';
import { __setNativeVaultForTests } from '../../../packages/web/src/storage/nativeVault.js';

const vault = () => Object.fromEntries([
    'clearVault', 'clearMeta', 'biometricClear', 'clearGuards',
].map((method) => [method, vi.fn()]));

afterEach(() => {
    __setNativeVaultForTests(undefined);
    __resetBackendCacheForTests();
    delete globalThis.Capacitor;
    delete globalThis.xchainWalletBridge;
});

describe('native wipe watch stores', () => {
    it('clears activity, notifications and watch data before afterWipe', async () => {
        const calls = [];
        globalThis.Capacitor = {
            isNativePlatform: () => true,
            Plugins: {
                XChainActivity: { clear: vi.fn(() => calls.push('activity')) },
                XChainNotify: { cancelAll: vi.fn(() => calls.push('notify')) },
                XChainWatch: { removeWatchData: vi.fn(() => calls.push('watch')) },
            },
        };
        __setNativeVaultForTests(vault());
        installNativeWipeHook({ afterWipe: () => calls.push('afterWipe') });

        await expect(globalThis.xchainWalletBridge.wipeStorage()).resolves.toEqual({ ok: true });
        expect(calls).toEqual(['activity', 'notify', 'watch', 'afterWipe']);
    });

    it('skips missing plugins and contains an unreachable watch', async () => {
        const afterWipe = vi.fn();
        globalThis.Capacitor = {
            isNativePlatform: () => true,
            Plugins: {
                XChainWatch: { removeWatchData: vi.fn(async () => { throw new Error('offline'); }) },
            },
        };
        __setNativeVaultForTests(vault());
        installNativeWipeHook({ afterWipe });

        await expect(globalThis.xchainWalletBridge.wipeStorage()).resolves.toEqual({ ok: true });
        expect(globalThis.Capacitor.Plugins.XChainWatch.removeWatchData).toHaveBeenCalledOnce();
        expect(afterWipe).toHaveBeenCalledOnce();
    });
});
