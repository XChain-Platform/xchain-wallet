// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { clearWatchNativeStores } from '../../../packages/web/src/storage/backends.js';

describe('clearWatchNativeStores', () => {
    it('skips every native watch store when its plugin is absent', async () => {
        const getPlugin = vi.fn(() => null);

        await expect(clearWatchNativeStores({ getPlugin })).resolves.toEqual({
            cleared: [],
            skipped: ['XChainActivity', 'XChainNotify', 'XChainWatch'],
            failed: [],
        });
        expect(getPlugin.mock.calls).toEqual([
            ['XChainActivity', { method: 'clear' }],
            ['XChainNotify', { method: 'cancelAll' }],
            ['XChainWatch', { method: 'removeWatchData' }],
        ]);
    });

    it('clears all present stores in order', async () => {
        const calls = [];
        const plugins = {
            XChainActivity: { clear: vi.fn(async () => { calls.push('XChainActivity'); }) },
            XChainNotify: { cancelAll: vi.fn(async () => { calls.push('XChainNotify'); }) },
            XChainWatch: { removeWatchData: vi.fn(async () => { calls.push('XChainWatch'); }) },
        };
        const getPlugin = vi.fn((name) => plugins[name]);

        await expect(clearWatchNativeStores({ getPlugin })).resolves.toEqual({
            cleared: ['XChainActivity', 'XChainNotify', 'XChainWatch'],
            skipped: [],
            failed: [],
        });
        expect(calls).toEqual(['XChainActivity', 'XChainNotify', 'XChainWatch']);
        expect(getPlugin.mock.calls).toEqual([
            ['XChainActivity', { method: 'clear' }],
            ['XChainNotify', { method: 'cancelAll' }],
            ['XChainWatch', { method: 'removeWatchData' }],
        ]);
    });

    it('continues clearing later stores when the first rejects', async () => {
        const failure = new Error('activity clear failed');
        const calls = [];
        const plugins = {
            XChainActivity: {
                clear: vi.fn(async () => {
                    calls.push('XChainActivity');
                    throw failure;
                }),
            },
            XChainNotify: { cancelAll: vi.fn(async () => { calls.push('XChainNotify'); }) },
            XChainWatch: { removeWatchData: vi.fn(async () => { calls.push('XChainWatch'); }) },
        };

        await expect(clearWatchNativeStores({
            getPlugin: (name) => plugins[name],
        })).resolves.toEqual({
            cleared: ['XChainNotify', 'XChainWatch'],
            skipped: [],
            failed: [{ name: 'XChainActivity', error: failure }],
        });
        expect(calls).toEqual(['XChainActivity', 'XChainNotify', 'XChainWatch']);
    });
});
