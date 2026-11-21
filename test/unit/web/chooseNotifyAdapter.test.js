// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseNotifyAdapter } from '../../../packages/web/src/notifications/chooseNotifyAdapter.js';

function expectWebAdapter(env) {
    const nativeAdapter = { kind: 'native' };
    const webAdapter = { kind: 'web' };
    const createNative = vi.fn(() => nativeAdapter);
    const createWeb = vi.fn(() => webAdapter);

    const adapter = chooseNotifyAdapter({ env, createNative, createWeb });

    expect(adapter).toBe(webAdapter);
    expect(createWeb).toHaveBeenCalledOnce();
    expect(createNative).not.toHaveBeenCalled();
}

describe('chooseNotifyAdapter', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('uses the web factory without a Capacitor global', () => {
        vi.stubGlobal('Capacitor', undefined);
        const createNative = vi.fn();
        const webAdapter = { kind: 'web' };
        const createWeb = vi.fn(() => webAdapter);

        expect(chooseNotifyAdapter({ createNative, createWeb })).toBe(webAdapter);
        expect(createWeb).toHaveBeenCalledOnce();
        expect(createNative).not.toHaveBeenCalled();
    });

    it('uses the web factory when Capacitor reports a web platform', () => {
        expectWebAdapter({
            Capacitor: {
                isNativePlatform: () => false,
                Plugins: { XChainNotify: { post: vi.fn() } },
            },
        });
    });

    it('uses the web factory when the native shell has no notify plugin', () => {
        expectWebAdapter({
            Capacitor: { isNativePlatform: () => true, Plugins: {} },
        });
    });

    it('uses the web factory when the native notify plugin has no post method', () => {
        expectWebAdapter({
            Capacitor: {
                isNativePlatform: () => true,
                Plugins: { XChainNotify: { schedule: vi.fn() } },
            },
        });
    });

    it('uses only the native factory when the notify plugin can post', () => {
        const nativeAdapter = { kind: 'native' };
        const createNative = vi.fn(() => nativeAdapter);
        const createWeb = vi.fn();
        const env = {
            Capacitor: {
                isNativePlatform: () => true,
                Plugins: { XChainNotify: { post: vi.fn() } },
            },
        };

        expect(chooseNotifyAdapter({ env, createNative, createWeb })).toBe(nativeAdapter);
        expect(createNative).toHaveBeenCalledOnce();
        expect(createWeb).not.toHaveBeenCalled();
    });

    it('throws when createWeb is missing', () => {
        const createNative = vi.fn();

        expect(() => chooseNotifyAdapter({ createNative })).toThrow(TypeError);
        expect(createNative).not.toHaveBeenCalled();
    });
});
