// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createWatchBridge } from '../../../packages/core/src/watch/watchBridge.js';

describe('createWatchBridge', () => {
    it('reports unavailable when the plugin is absent', async () => {
        const getPlugin = vi.fn(() => null);
        const bridge = createWatchBridge({ getPlugin });

        await expect(bridge.isAvailable()).resolves.toBe(false);
        await expect(bridge.status()).resolves.toEqual({
            paired: false,
            installed: false,
            reachable: false,
        });
        expect(getPlugin).toHaveBeenNthCalledWith(1, 'XChainWatch', { method: 'isAvailable' });
        expect(getPlugin).toHaveBeenNthCalledWith(2, 'XChainWatch', { method: 'status' });
    });

    it('reports unavailable when the required method is absent', async () => {
        const bridge = createWatchBridge({ getPlugin: () => ({}) });

        await expect(bridge.isAvailable()).resolves.toBe(false);
    });

    it.each([
        { available: false },
        { available: 'yes' },
    ])('requires an exact true availability answer from $available', async (answer) => {
        const bridge = createWatchBridge({
            getPlugin: () => ({ isAvailable: vi.fn().mockResolvedValue(answer) }),
        });

        await expect(bridge.isAvailable()).resolves.toBe(false);
    });

    it('reports available for an exact true availability answer', async () => {
        const bridge = createWatchBridge({
            getPlugin: () => ({ isAvailable: vi.fn().mockResolvedValue({ available: true }) }),
        });

        await expect(bridge.isAvailable()).resolves.toBe(true);
    });

    it('does not reject when plugin lookup or a plugin call fails', async () => {
        const lookupFailure = createWatchBridge({
            getPlugin: () => { throw new Error('lookup failed'); },
        });
        const callFailure = createWatchBridge({
            getPlugin: (_name, { method }) => ({
                [method]: vi.fn().mockRejectedValue(new Error('call failed')),
            }),
        });

        await expect(lookupFailure.isAvailable()).resolves.toBe(false);
        await expect(lookupFailure.status()).resolves.toEqual({
            paired: false,
            installed: false,
            reachable: false,
        });
        await expect(callFailure.isAvailable()).resolves.toBe(false);
        await expect(callFailure.status()).resolves.toEqual({
            paired: false,
            installed: false,
            reachable: false,
        });
    });

    it('normalizes a full status answer', async () => {
        const status = vi.fn().mockResolvedValue({
            paired: true,
            installed: 'yes',
            reachable: true,
            lastSyncAt: 1_700_000_000_000,
        });
        const bridge = createWatchBridge({ getPlugin: () => ({ status }) });

        await expect(bridge.status()).resolves.toEqual({
            paired: true,
            installed: false,
            reachable: true,
            lastSyncAt: 1_700_000_000_000,
        });
    });

    it.each([NaN, Infinity, '1700000000000'])('omits invalid lastSyncAt value %s', async (lastSyncAt) => {
        const bridge = createWatchBridge({
            getPlugin: () => ({
                status: vi.fn().mockResolvedValue({
                    paired: true,
                    installed: true,
                    reachable: true,
                    lastSyncAt,
                }),
            }),
        });

        await expect(bridge.status()).resolves.toEqual({
            paired: true,
            installed: true,
            reachable: true,
        });
    });
});
