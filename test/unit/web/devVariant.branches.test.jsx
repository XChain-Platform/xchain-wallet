// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    STORAGE_KEY,
    THRESHOLD_PX,
    clearVariantOverride,
    purgeStoredVariantOverride,
    resolveVariant,
    setActiveVariant,
    shellForVariant,
    useActiveVariant,
} from '../../../packages/web/src/devVariant.js';

function setUrl(search = '') {
    window.history.replaceState({}, '', `/${search}`);
}

function setViewport(px) {
    Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    setUrl();
    setViewport(1024);
});

describe('web variant edge branches', () => {
    it('uses safe server-side defaults and no-op setters without a window', () => {
        vi.stubGlobal('window', undefined);

        expect(purgeStoredVariantOverride()).toBe(false);
        expect(resolveVariant()).toEqual({ variant: 'full', source: 'auto', viewportPx: THRESHOLD_PX });
        expect(setActiveVariant('sidebar')).toBeUndefined();
        expect(clearVariantOverride()).toBeUndefined();
    });

    it('falls back through document width and the threshold', () => {
        setViewport(0);
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 500, configurable: true });
        expect(resolveVariant()).toEqual({ variant: 'small', source: 'auto', viewportPx: 500 });

        Object.defineProperty(document.documentElement, 'clientWidth', { value: 0, configurable: true });
        expect(resolveVariant()).toEqual({ variant: 'full', source: 'auto', viewportPx: THRESHOLD_PX });
    });

    it('survives unavailable storage and rejects invalid setters', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(purgeStoredVariantOverride()).toBe(false);
        expect(resolveVariant()).toMatchObject({ variant: 'full', source: 'auto' });
        expect(setActiveVariant('invalid')).toBeUndefined();
    });

    it('writes and clears visible URL overrides', () => {
        const replace = vi.fn();
        const removeItem = vi.fn();
        vi.stubGlobal('window', {
            location: { href: 'https://wallet.example.test/?keep=1&variant=small', replace },
            localStorage: { getItem: () => 'sidebar', removeItem },
        });

        setActiveVariant('popup');
        expect(replace).toHaveBeenNthCalledWith(1, 'https://wallet.example.test/?keep=1&variant=extension');
        clearVariantOverride();
        expect(removeItem).toHaveBeenCalledWith(STORAGE_KEY);
        expect(replace).toHaveBeenNthCalledWith(2, 'https://wallet.example.test/?keep=1');
    });

    it('updates the live auto variant on resize and removes its listener', () => {
        setViewport(900);
        const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            callback(0);
            return 7;
        });
        const remove = vi.spyOn(window, 'removeEventListener');
        const { result, unmount } = renderHook(() => useActiveVariant());

        expect(result.current.variant).toBe('full');
        setViewport(390);
        act(() => window.dispatchEvent(new Event('resize')));
        expect(result.current.variant).toBe('small');

        unmount();
        expect(cancel).toHaveBeenCalledWith(7);
        expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(shellForVariant('full')).toBe('web');
        expect(shellForVariant('sidebar')).toBe('popup');
    });
});
