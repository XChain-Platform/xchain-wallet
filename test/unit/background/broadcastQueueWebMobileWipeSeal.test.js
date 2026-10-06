// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A web or native-shell wipe seals the page's queue store before core removes
// the stored key, so a broadcast that resolves after the removal writes nothing.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultStatus, __setNativeVaultForTests } from '../../../packages/web/src/storage/nativeVault.js';
import { installNativeWipeHook, __resetBackendCacheForTests } from '../../../packages/web/src/storage/backends.js';
import { createBroadcastQueueStore, sealBroadcastQueueStore } from '../../../packages/extension/src/background/broadcastQueueStore.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, '../../..', rel), 'utf8');

function fakePlugin(overrides = {}) {
    const ok = vi.fn(async () => ({ status: VaultStatus.OK }));
    return {
        clearVault: ok, clearMeta: ok, biometricClear: ok, clearGuards: ok,
        ...overrides,
    };
}

afterEach(() => {
    __setNativeVaultForTests(undefined);
    __resetBackendCacheForTests();
    delete globalThis.xchainWalletBridge;
});

describe('native wipe hook runs afterWipe', () => {
    it('runs the seal after every native store cleared', async () => {
        const plugin = fakePlugin();
        const afterWipe = vi.fn();
        __setNativeVaultForTests(plugin);
        installNativeWipeHook({ afterWipe });
        expect(await globalThis.xchainWalletBridge.wipeStorage()).toEqual({ ok: true });
        expect(afterWipe).toHaveBeenCalledTimes(1);
        expect(afterWipe.mock.invocationCallOrder[0])
            .toBeGreaterThan(plugin.clearGuards.mock.invocationCallOrder[0]);
    });

    it('never runs it when an earlier clear refuses, and reports a failing seal as a failed wipe', async () => {
        const afterWipe = vi.fn();
        __setNativeVaultForTests(fakePlugin({ clearVault: async () => { throw new Error('busy'); } }));
        installNativeWipeHook({ afterWipe });
        expect((await globalThis.xchainWalletBridge.wipeStorage()).ok).toBe(false);
        expect(afterWipe).not.toHaveBeenCalled();

        delete globalThis.xchainWalletBridge;
        __resetBackendCacheForTests();
        __setNativeVaultForTests(fakePlugin());
        installNativeWipeHook({ afterWipe: async () => { throw new Error('seal'); } });
        expect(await globalThis.xchainWalletBridge.wipeStorage()).toEqual({ ok: false, error: 'seal' });
    });
});

describe('a sealed store', () => {
    it('is refused by a new host instead of silently dropping its broadcasts', async () => {
        const store = createBroadcastQueueStore({ storage: null });
        await sealBroadcastQueueStore(store);
        expect(store.sealed).toBe(true);
        expect(() => createBackgroundHost({
            vault: { wallets: { list: async () => [] }, pendingTxs: {}, settings: {} },
            chainRegistry: { get: () => null, list: () => [] },
            sdkRegistry: { get: () => null, for: () => null },
            signerPool: { get: () => null, has: () => false },
            approvals: { request: async () => ({ approved: true }) },
            bridgeEvents: { emit() {} },
            getDiagnosticContext: () => ({}),
            broadcastQueueStore: store,
        })).toThrow(/sealed/);
    });
});

describe('web shell wiring', () => {
    const bridge = read('packages/web/src/hostBridge.js');

    it('seals the page store on the native hook and on a plain browser page', () => {
        expect(bridge).toMatch(/installNativeWipeHook\(\{ afterWipe: sealPageBroadcastQueue \}\)/);
        expect(bridge).toMatch(/installPageWipeSeal\(\)/);
        expect(bridge).toMatch(/wipeStorage: async \(\) => \{\s*await sealPageBroadcastQueue\(\);/);
    });

    it('drops the sealed store so the next host builds a fresh one', () => {
        expect(bridge).toMatch(/const sealed = broadcastQueueStore;\s*broadcastQueueStore = null;/);
    });
});
