/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import Module, { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const preloadPath = resolve(here, '../../../packages/desktop/preload.cjs');

function loadPreload() {
    const worlds = new Map();
    const listeners = new Map();
    const ipcRenderer = {
        invoke: vi.fn(async () => ({ ok: true })),
        send: vi.fn(),
        on: vi.fn((channel, listener) => {
            if (!listeners.has(channel)) listeners.set(channel, new Set());
            listeners.get(channel).add(listener);
        }),
        removeListener: vi.fn((channel, listener) => listeners.get(channel)?.delete(listener)),
    };
    const contextBridge = {
        exposeInMainWorld: vi.fn((name, api) => worlds.set(name, api)),
    };

    const originalLoad = Module._load;
    Module._load = function mockedElectron(request, ...rest) {
        if (request === 'electron') return { contextBridge, ipcRenderer };
        return originalLoad.call(this, request, ...rest);
    };
    try {
        const require = createRequire(import.meta.url);
        delete require.cache[require.resolve(preloadPath)];
        require(preloadPath);
    } finally {
        Module._load = originalLoad;
    }

    return { worlds, listeners, contextBridge, ipcRenderer };
}

const expectedSurface = {
    xchainWalletBridge: ['sendMessage', 'wipeStorage'],
    xchainWalletDeepLink: ['onUri', 'takePending'],
    xchainWalletRegistry: ['getRemoteDescriptors'],
    xchainWalletSignerBridge: ['onMessage', 'postMessage'],
    xchainWalletUpdater: ['getState', 'install', 'onEvent'],
    xchainWalletWindow: ['onStateChange', 'openDetached'],
};

describe('desktop preload API', () => {
    it('exposes only the documented function surface and no ipcRenderer handle', () => {
        const { worlds, ipcRenderer } = loadPreload();

        expect([...worlds.keys()].sort()).toEqual(Object.keys(expectedSurface).sort());
        for (const [name, methods] of Object.entries(expectedSurface)) {
            const api = worlds.get(name);
            expect(Object.keys(api).sort()).toEqual(methods);
            for (const value of Object.values(api)) {
                expect(value).toBeTypeOf('function');
                expect(value).not.toBe(ipcRenderer);
            }
            expect(Object.values(api)).not.toContain(ipcRenderer);
        }
    });

    it('forwards valid calls on their fixed channels', async () => {
        const { worlds, ipcRenderer } = loadPreload();
        const bridge = worlds.get('xchainWalletBridge');
        const win = worlds.get('xchainWalletWindow');
        const updater = worlds.get('xchainWalletUpdater');
        const deepLink = worlds.get('xchainWalletDeepLink');
        const registry = worlds.get('xchainWalletRegistry');
        const signer = worlds.get('xchainWalletSignerBridge');

        await bridge.sendMessage({ type: 'wallet.list', request: undefined });
        await bridge.wipeStorage();
        await win.openDetached({ initialView: 'history', initialContext: { walletId: 'w1' } });
        await updater.getState();
        await updater.install();
        await deepLink.takePending();
        await registry.getRemoteDescriptors();
        signer.postMessage({ kind: 'register', signerIds: ['signer-1'] });

        expect(ipcRenderer.invoke.mock.calls).toEqual([
            ['xchain-wallet:message', { type: 'wallet.list', request: undefined }],
            ['xchain:wipe-storage'],
            ['xchain:open-window', { initialView: 'history', initialContext: { walletId: 'w1' } }],
            ['xchain:updater-state'],
            ['xchain:updater-install', 'download'],
            ['xchain:deep-link-take'],
            ['xchain:chain-registry'],
        ]);
        expect(ipcRenderer.send).toHaveBeenCalledWith(
            'xchain-wallet:signer-bridge',
            { kind: 'register', signerIds: ['signer-1'] },
        );
    });

    it('validates every exposed method before touching ipcRenderer', () => {
        const { worlds, ipcRenderer } = loadPreload();
        const bridge = worlds.get('xchainWalletBridge');
        const win = worlds.get('xchainWalletWindow');
        const updater = worlds.get('xchainWalletUpdater');
        const deepLink = worlds.get('xchainWalletDeepLink');
        const registry = worlds.get('xchainWalletRegistry');
        const signer = worlds.get('xchainWalletSignerBridge');

        const invalidCalls = [
            () => bridge.sendMessage(null),
            () => bridge.wipeStorage('path'),
            () => win.openDetached({}),
            () => win.onStateChange(null),
            () => updater.onEvent('listener'),
            () => updater.getState('extra'),
            () => updater.install('extra'),
            () => deepLink.onUri({}),
            () => deepLink.takePending('extra'),
            () => registry.getRemoteDescriptors('extra'),
            () => signer.postMessage({ kind: 'unknown' }),
            () => signer.onMessage(),
        ];

        for (const call of invalidCalls) expect(call).toThrow(TypeError);
        expect(ipcRenderer.invoke).not.toHaveBeenCalled();
        expect(ipcRenderer.send).not.toHaveBeenCalled();
        expect(ipcRenderer.on).not.toHaveBeenCalled();
    });

    it('rejects malformed request, window and signer envelopes', () => {
        const { worlds, ipcRenderer } = loadPreload();
        const sendMessage = worlds.get('xchainWalletBridge').sendMessage;
        const openDetached = worlds.get('xchainWalletWindow').openDetached;
        const postMessage = worlds.get('xchainWalletSignerBridge').postMessage;

        expect(() => sendMessage({ type: '' })).toThrow(/non-empty string/);
        expect(() => sendMessage({ type: 'wallet.list', extra: true })).toThrow(/unexpected property/);
        expect(() => openDetached({ initialView: 3 })).toThrow(/initialView/);
        expect(() => openDetached({ initialContext: [] })).toThrow(/initialContext/);
        expect(() => openDetached({ initialView: 'history', extra: true })).toThrow(/unexpected property/);
        expect(() => postMessage({ kind: 'register', signerIds: [''] })).toThrow(/signerIds/);
        expect(() => postMessage({ kind: 'response', reqId: 0, ok: true })).toThrow(/reqId/);
        expect(() => postMessage({ kind: 'response', reqId: 1, ok: false, error: null })).toThrow(/error/);
        expect(() => postMessage({
            kind: 'response', reqId: 1, ok: false, error: { name: 'Error', message: 'no', detail: 'leak' },
        })).toThrow(/unexpected property/);

        expect(ipcRenderer.invoke).not.toHaveBeenCalled();
        expect(ipcRenderer.send).not.toHaveBeenCalled();
    });

    it('validates subscriptions and the unsubscribe functions they return', () => {
        const { worlds, ipcRenderer } = loadPreload();
        const subscriptions = [
            worlds.get('xchainWalletWindow').onStateChange,
            worlds.get('xchainWalletUpdater').onEvent,
            worlds.get('xchainWalletDeepLink').onUri,
            worlds.get('xchainWalletSignerBridge').onMessage,
        ];

        for (const subscribe of subscriptions) {
            expect(() => subscribe(() => {}, 'extra')).toThrow(TypeError);
            const unsubscribe = subscribe(() => {});
            expect(() => unsubscribe('extra')).toThrow(TypeError);
            expect(() => unsubscribe()).not.toThrow();
        }

        expect(ipcRenderer.on).toHaveBeenCalledTimes(4);
        expect(ipcRenderer.removeListener).toHaveBeenCalledTimes(4);
    });
});
