// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyNativeFontScale,
    clampNativeFontScale,
    installNativeFontScale,
} from '../../../packages/web/src/platform/nativeFontScale.js';

describe('native font scale', () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty('--xc-native-font-scale');
        document.documentElement.style.removeProperty('font-size');
    });

    it.each([
        [undefined, 1],
        [0.8, 1],
        [1, 1],
        [1.25, 1.25],
        [2, 1.5],
        ['invalid', 1],
    ])('clamps %s to %s', (input, expected) => {
        expect(clampNativeFontScale(input)).toBe(expected);
    });

    it('maps the scale to the root rem basis and diagnostic custom property', () => {
        expect(applyNativeFontScale(1.25)).toBe(1.25);
        expect(document.documentElement.style.fontSize).toBe('125%');
        expect(document.documentElement.style.getPropertyValue('--xc-native-font-scale'))
            .toBe('1.25');
    });

    it('applies the cold-start value and later native events', async () => {
        let pluginListener;
        const target = new EventTarget();
        target.document = document;
        target.__xchainNativeFontScale = 1.1;
        target.Capacitor = {
            isNativePlatform: () => true,
            Plugins: {
                App: {
                    addListener: vi.fn((_name, listener) => { pluginListener = listener; }),
                    getFontScale: vi.fn(async () => ({ fontScale: 1.2 })),
                },
            },
        };

        installNativeFontScale(target);
        expect(document.documentElement.style.fontSize).toBe('110%');
        await vi.waitFor(() => expect(document.documentElement.style.fontSize).toBe('120%'));

        pluginListener({ fontScale: 3 });
        expect(document.documentElement.style.fontSize).toBe('150%');
        target.dispatchEvent(new CustomEvent('xchain:native-font-scale', {
            detail: { fontScale: 1.3 },
        }));
        expect(document.documentElement.style.fontSize).toBe('130%');
    });
});
