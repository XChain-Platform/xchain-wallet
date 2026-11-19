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

function loadPreload(overrides = {}) {
    const worlds = new Map();
    const ipcRenderer = {
        invoke: vi.fn(),
        send: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
    };
    const contextBridge = {
        exposeInMainWorld: vi.fn((name, api) => worlds.set(name, api)),
    };
    const electron = { contextBridge, ipcRenderer, ...overrides };

    const originalLoad = Module._load;
    Module._load = function mockedElectron(request, ...rest) {
        if (request === 'electron') return electron;
        return originalLoad.call(this, request, ...rest);
    };
    try {
        const require = createRequire(import.meta.url);
        delete require.cache[require.resolve(preloadPath)];
        require(preloadPath);
    } finally {
        Module._load = originalLoad;
    }

    return { bridge: worlds.get('xchainWalletBridge'), electron, ipcRenderer };
}

function expectNoIpcCalls(ipcRenderer) {
    for (const method of Object.values(ipcRenderer)) expect(method).not.toHaveBeenCalled();
}

describe('desktop preload filePathOf', () => {
    it('returns a native file path and fails closed without using IPC', async () => {
        const file = { name: 'large.bin' };
        const getPathForFile = vi.fn()
            .mockReturnValueOnce('/picked/large.bin')
            .mockReturnValueOnce('')
            .mockImplementationOnce(() => { throw new Error('unavailable'); });
        const { bridge, ipcRenderer } = loadPreload({ webUtils: { getPathForFile } });
        ipcRenderer.invoke.mockResolvedValueOnce({ token: 'tok-1', size: 7 });

        await expect(bridge.fileTokenOf(file)).resolves.toEqual({ token: 'tok-1', size: 7 });
        await expect(bridge.fileTokenOf(file)).resolves.toBeNull();
        await expect(bridge.fileTokenOf('large.bin')).resolves.toBeNull();
        await expect(bridge.fileTokenOf(file)).resolves.toBeNull();
        expect(getPathForFile).toHaveBeenCalledTimes(3);
        expect(ipcRenderer.invoke.mock.calls).toEqual([['xchain:register-picked-file', '/picked/large.bin']]);
    });

    it('returns null when webUtils is absent without using IPC', async () => {
        const { bridge, ipcRenderer } = loadPreload();

        await expect(bridge.fileTokenOf({ name: 'large.bin' })).resolves.toBeNull();
        expectNoIpcCalls(ipcRenderer);
    });

    it('reads webUtils from the captured Electron module at call time', async () => {
        const initialLookup = vi.fn(() => '/stale/path.bin');
        const { bridge, electron, ipcRenderer } = loadPreload({
            webUtils: { getPathForFile: initialLookup },
        });
        ipcRenderer.invoke.mockResolvedValue({ token: 'tok-2', size: 3 });
        const currentLookup = vi.fn(() => '/current/path.bin');
        electron.webUtils = { getPathForFile: currentLookup };

        await bridge.fileTokenOf({ name: 'path.bin' });

        expect(initialLookup).not.toHaveBeenCalled();
        expect(currentLookup).toHaveBeenCalledOnce();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('xchain:register-picked-file', '/current/path.bin');
    });

    it('hands the page only a token and a size, never the path main answered or read', async () => {
        const getPathForFile = vi.fn(() => '/picked/secret-name.bin');
        const { bridge, ipcRenderer } = loadPreload({ webUtils: { getPathForFile } });
        ipcRenderer.invoke.mockResolvedValue({ token: 'tok-3', size: 9, path: '/picked/secret-name.bin' });

        const result = await bridge.fileTokenOf({ name: 'x' });

        expect(Object.keys(result).sort()).toEqual(['size', 'token']);
        expect(JSON.stringify(result)).not.toContain('/picked');
        expect(bridge.filePathOf).toBeUndefined();
    });

    it('answers null for a malformed registration reply, a refusal and a failed call', async () => {
        const { bridge, ipcRenderer } = loadPreload({ webUtils: { getPathForFile: () => '/picked/a.bin' } });
        ipcRenderer.invoke
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ token: '', size: 1 })
            .mockResolvedValueOnce({ token: 't', size: 1.5 })
            .mockRejectedValueOnce(new Error('ipc down'));

        for (let index = 0; index < 4; index += 1) {
            await expect(bridge.fileTokenOf({ name: 'a' })).resolves.toBeNull();
        }
    });

    it('takes exactly one argument', async () => {
        const getPathForFile = vi.fn(() => '/picked/a.bin');
        const { bridge, ipcRenderer } = loadPreload({ webUtils: { getPathForFile } });

        await expect(bridge.fileTokenOf()).resolves.toBeNull();
        await expect(bridge.fileTokenOf({ name: 'a' }, '/etc/hosts')).resolves.toBeNull();
        expect(getPathForFile).not.toHaveBeenCalled();
        expectNoIpcCalls(ipcRenderer);
    });
});
