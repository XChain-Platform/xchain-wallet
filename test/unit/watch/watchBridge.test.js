// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createWatchBridge } from '../../../packages/core/src/watch/watchBridge.js';

async function settle() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('watchBridge', () => {
    it('probes and forwards every native operation through string-only payloads', async () => {
        const remove = vi.fn();
        const plugin = {
            isAvailable: vi.fn(async () => ({ available: true })),
            sendSnapshot: vi.fn(),
            sendDetail: vi.fn(),
            sendImage: vi.fn(),
            status: vi.fn(async () => ({
                paired: true,
                installed: true,
                reachable: true,
                lastSyncAt: 1_700_000_000_000,
            })),
            removeWatchData: vi.fn(),
            addListener: vi.fn(async () => ({ remove })),
        };
        const getPlugin = vi.fn(() => plugin);
        const bridge = createWatchBridge({ getPlugin });

        await expect(bridge.isAvailable()).resolves.toBe(true);
        await expect(bridge.sendSnapshot({ v: 1, builtAt: 10 })).resolves.toBe(true);
        await expect(bridge.sendDetail('{"v":1,"tokenId":"coin"}')).resolves.toBe(true);
        await expect(bridge.sendImage({
            hash: 'abc',
            name: 'abc.png',
            blob: new Blob([new Uint8Array([1, 2, 3])]),
        })).resolves.toBe(true);
        await expect(bridge.status()).resolves.toEqual({
            paired: true,
            installed: true,
            reachable: true,
            lastSyncAt: 1_700_000_000_000,
        });
        await expect(bridge.removeWatchData()).resolves.toBe(true);

        const handler = vi.fn();
        const unsubscribe = bridge.onIntent(handler);
        const listener = plugin.addListener.mock.calls[0][1];
        listener({ kind: 'refresh' });
        await settle();
        unsubscribe();

        expect(plugin.sendSnapshot).toHaveBeenCalledWith({ json: '{"v":1,"builtAt":10}' });
        expect(plugin.sendDetail).toHaveBeenCalledWith({ json: '{"v":1,"tokenId":"coin"}' });
        expect(plugin.sendImage).toHaveBeenCalledWith({
            hash: 'abc',
            name: 'abc.png',
            base64: 'AQID',
        });
        expect(plugin.removeWatchData).toHaveBeenCalledWith();
        expect(plugin.addListener).toHaveBeenCalledWith('intent', listener);
        expect(handler).toHaveBeenCalledWith({ kind: 'refresh' });
        expect(remove).toHaveBeenCalledOnce();

        expect(getPlugin.mock.calls.map(([, options]) => options.method)).toEqual([
            'isAvailable',
            'sendSnapshot',
            'sendDetail',
            'sendImage',
            'status',
            'removeWatchData',
            'addListener',
        ]);
    });

    it('is inert when methods are absent and never rejects on native failures', async () => {
        const absent = createWatchBridge({ getPlugin: () => null });
        await expect(absent.sendSnapshot({ v: 1 })).resolves.toBe(false);
        await expect(absent.sendDetail({ v: 1 })).resolves.toBe(false);
        await expect(absent.sendImage('hash', 'AQID')).resolves.toBe(false);
        await expect(absent.removeWatchData()).resolves.toBe(false);

        const failing = createWatchBridge({
            getPlugin: (_name, { method }) => ({
                [method]: vi.fn().mockRejectedValue(new Error('native failure')),
            }),
        });
        await expect(failing.sendSnapshot({ v: 1 })).resolves.toBe(false);
        await expect(failing.sendDetail({ v: 1 })).resolves.toBe(false);
        await expect(failing.sendImage('hash', 'AQID')).resolves.toBe(false);
        await expect(failing.removeWatchData()).resolves.toBe(false);
    });

    it('rejects neither invalid JSON input nor an unreadable image', async () => {
        const bridge = createWatchBridge({ getPlugin: vi.fn() });
        const circular = {};
        circular.self = circular;

        await expect(bridge.sendSnapshot(circular)).resolves.toBe(false);
        await expect(bridge.sendImage({ hash: 'abc' })).resolves.toBe(false);
    });
});
