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
    it('returns a native file path and fails closed without using IPC', () => {
        const file = { name: 'large.bin' };
        const getPathForFile = vi.fn()
            .mockReturnValueOnce('/picked/large.bin')
            .mockReturnValueOnce('')
            .mockImplementationOnce(() => { throw new Error('unavailable'); });
        const { bridge, ipcRenderer } = loadPreload({ webUtils: { getPathForFile } });

        expect(bridge.filePathOf(file)).toBe('/picked/large.bin');
        expect(bridge.filePathOf(file)).toBeNull();
        expect(bridge.filePathOf('large.bin')).toBeNull();
        expect(bridge.filePathOf(file)).toBeNull();
        expect(getPathForFile).toHaveBeenCalledTimes(3);
        expectNoIpcCalls(ipcRenderer);
    });

    it('returns null when webUtils is absent without using IPC', () => {
        const { bridge, ipcRenderer } = loadPreload();

        expect(bridge.filePathOf({ name: 'large.bin' })).toBeNull();
        expectNoIpcCalls(ipcRenderer);
    });

    it('reads webUtils from the captured Electron module at call time', () => {
        const initialLookup = vi.fn(() => '/stale/path.bin');
        const { bridge, electron, ipcRenderer } = loadPreload({
            webUtils: { getPathForFile: initialLookup },
        });
        const currentLookup = vi.fn(() => '/current/path.bin');
        electron.webUtils = { getPathForFile: currentLookup };

        expect(bridge.filePathOf({ name: 'path.bin' })).toBe('/current/path.bin');
        expect(initialLookup).not.toHaveBeenCalled();
        expect(currentLookup).toHaveBeenCalledOnce();
        expectNoIpcCalls(ipcRenderer);
    });
});
