/**
 * @vitest-environment node
 */

// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import Module, { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    attachSiteRequestHandler,
    handleSiteRequestCommand,
    postSiteCallback,
    sendSiteCallback,
    sendSiteReturn,
    SITE_REQUEST_CHANNEL,
} from '../../../packages/desktop/main/siteRequest.js';

const here = dirname(fileURLToPath(import.meta.url));
const preloadPath = resolve(here, '../../../packages/desktop/preload.cjs');

afterEach(() => {
    vi.unstubAllGlobals();
});

function loadPreload() {
    const worlds = new Map();
    const ipcRenderer = { invoke: vi.fn(async () => ({ sent: true })) };
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
    return { worlds, ipcRenderer };
}

describe('desktop site request return', () => {
    it('opens an allowlisted HTTPS return with its fragment intact', async () => {
        const openExternal = vi.fn(async () => {});
        const url = 'https://app.example/return#xchain=Abc_123-xyz';

        await expect(sendSiteReturn({ url, openExternal })).resolves.toEqual({ sent: true });
        expect(openExternal).toHaveBeenCalledOnce();
        expect(openExternal).toHaveBeenCalledWith(url);
    });

    it('refuses a bad return before openExternal and maps an open failure', async () => {
        const openExternal = vi.fn(async () => {});
        await expect(sendSiteReturn({
            url: 'javascript:alert(1)',
            openExternal,
        })).resolves.toEqual({ sent: false, reason: 'BAD_TARGET' });
        expect(openExternal).not.toHaveBeenCalled();

        openExternal.mockRejectedValueOnce(new Error('browser unavailable'));
        await expect(sendSiteReturn({
            url: 'https://app.example/return#xchain=A',
            openExternal,
        })).resolves.toEqual({ sent: false, reason: 'OPEN_FAILED' });
    });
});

describe('desktop site request callback', () => {
    it('posts through the global fetch path used by torRouting.js', async () => {
        const cancel = vi.fn(async () => {});
        const fetchImpl = vi.fn(async () => ({ status: 204, body: { cancel } }));
        const body = { v: 1, id: 'request-id', method: 'login', ok: true, result: {} };
        vi.stubGlobal('fetch', fetchImpl);

        await expect(sendSiteCallback({
            url: 'https://callback.example/result',
            body,
            tor: true,
        })).resolves.toEqual({ sent: true, status: 204 });

        expect(fetchImpl).toHaveBeenCalledOnce();
        const [href, init] = fetchImpl.mock.calls[0];
        expect(href).toBe('https://callback.example/result');
        expect(init).toMatchObject({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            redirect: 'manual',
            credentials: 'omit',
        });
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init).not.toHaveProperty('dispatcher');
        expect(cancel).toHaveBeenCalledOnce();
    });

    it('pins a checked direct address and closes its dispatcher', async () => {
        const dispatcher = { close: vi.fn(async () => {}) };
        const dispatcherFactory = vi.fn(() => dispatcher);
        const fetchImpl = vi.fn(async () => ({ status: 200 }));

        await expect(postSiteCallback({
            href: 'https://callback.example/result',
            address: '8.8.8.8',
            body: '{}',
            timeoutMs: 10_000,
            redirect: 'manual',
            credentials: 'omit',
        }, { fetchImpl, dispatcherFactory })).resolves.toEqual({ status: 200 });

        expect(dispatcherFactory).toHaveBeenCalledWith(
            'https://callback.example/result',
            '8.8.8.8',
        );
        expect(fetchImpl).toHaveBeenCalledWith(
            'https://callback.example/result',
            expect.objectContaining({ dispatcher }),
        );
        expect(dispatcher.close).toHaveBeenCalledOnce();
    });

    it('keeps redirects manual, reports non-2xx, and maps fetch failure', async () => {
        const body = { v: 1, id: 'request-id', method: 'login', ok: false, error: 'USER_REJECTED' };
        const redirectedFetch = vi.fn(async () => ({ status: 302 }));
        await expect(sendSiteCallback({
            url: 'https://callback.example/result',
            body,
            tor: true,
            fetchImpl: redirectedFetch,
        })).resolves.toEqual({ sent: false, reason: 'HTTP_STATUS', status: 302 });
        expect(redirectedFetch.mock.calls[0][1].redirect).toBe('manual');

        const failedFetch = vi.fn(async () => { throw new Error('offline'); });
        await expect(sendSiteCallback({
            url: 'https://callback.example/result',
            body,
            tor: true,
            fetchImpl: failedFetch,
        })).resolves.toEqual({ sent: false, reason: 'NETWORK' });
    });
});

describe('desktop site request preload channel', () => {
    it('forwards validated return and callback commands on one fixed channel', async () => {
        const { worlds, ipcRenderer } = loadPreload();
        const bridge = worlds.get('xchainWalletBridge');
        const body = { v: 1, id: 'request-id', method: 'login', ok: true, result: {} };

        await bridge.sendMessage({
            type: 'siteRequest.return',
            request: { url: 'https://app.example/#xchain=A' },
        });
        await bridge.sendMessage({
            type: 'siteRequest.callback',
            request: { url: 'https://callback.example/result', body },
        });

        expect(ipcRenderer.invoke.mock.calls).toEqual([
            [SITE_REQUEST_CHANNEL, { type: 'return', url: 'https://app.example/#xchain=A' }],
            [SITE_REQUEST_CHANNEL, {
                type: 'callback',
                url: 'https://callback.example/result',
                body,
            }],
        ]);
    });

    it('registers the fixed main channel and dispatches trusted commands', async () => {
        const handlers = new Map();
        const ipcMain = {
            handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
        };
        const openExternal = vi.fn(async () => {});
        const fetchImpl = vi.fn(async () => ({ status: 204 }));
        vi.stubGlobal('fetch', fetchImpl);
        attachSiteRequestHandler({
            ipcMain,
            isTrustedSender: (event) => event.trusted === true,
            dependencies: async () => ({ openExternal, tor: true }),
        });

        expect(ipcMain.handle).toHaveBeenCalledOnce();
        expect(ipcMain.handle).toHaveBeenCalledWith(SITE_REQUEST_CHANNEL, expect.any(Function));
        const handler = handlers.get(SITE_REQUEST_CHANNEL);
        await expect(handler(
            { trusted: true },
            { type: 'return', url: 'https://app.example/#xchain=A' },
        )).resolves.toEqual({ sent: true });
        await expect(handler(
            { trusted: true },
            {
                type: 'callback',
                url: 'https://callback.example/result',
                body: { v: 1, id: 'request-id', method: 'login', ok: true, result: {} },
            },
        )).resolves.toEqual({ sent: true, status: 204 });
        await expect(handler(
            { trusted: false },
            { type: 'return', url: 'https://app.example/#xchain=A' },
        )).resolves.toEqual({ sent: false, reason: 'FORBIDDEN_SENDER' });

        expect(openExternal).toHaveBeenCalledOnce();
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('rejects malformed commands in preload and main before transport', async () => {
        const { worlds, ipcRenderer } = loadPreload();
        const bridge = worlds.get('xchainWalletBridge');
        expect(() => bridge.sendMessage({
            type: 'siteRequest.return', request: { url: '' },
        })).toThrow(TypeError);
        expect(() => bridge.sendMessage({
            type: 'siteRequest.callback',
            request: { url: 'https://callback.example', body: [] },
        })).toThrow(TypeError);
        expect(() => bridge.sendMessage({
            type: 'siteRequest.callback',
            request: { url: 'https://callback.example', body: {}, extra: true },
        })).toThrow(TypeError);
        expect(ipcRenderer.invoke).not.toHaveBeenCalled();

        const openExternal = vi.fn();
        const fetchImpl = vi.fn();
        await expect(handleSiteRequestCommand(
            { type: 'return', url: 'https://app.example/#xchain=A', extra: true },
            { openExternal, fetchImpl },
        )).resolves.toEqual({ sent: false, reason: 'BAD_REQUEST' });
        await expect(handleSiteRequestCommand(
            { type: 'callback', url: 'https://callback.example', body: [] },
            { openExternal, fetchImpl },
        )).resolves.toEqual({ sent: false, reason: 'BAD_REQUEST' });
        expect(openExternal).not.toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
