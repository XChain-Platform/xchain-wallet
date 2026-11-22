// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import {
    applyNativeFold,
    installNativeFold,
} from '../../../packages/web/src/platform/nativeFold.js';

const root = document.documentElement;

afterEach(() => {
    root.style.removeProperty('--xc-fold-x');
    root.style.removeProperty('--xc-fold-y');
    root.style.removeProperty('--xc-fold-width');
    root.style.removeProperty('--xc-fold-height');
    root.removeAttribute('data-fold');
});

describe('native fold size', () => {
    it('applies horizontal division dimensions in CSS pixels', () => {
        expect(applyNativeFold({
            division: {
                orientation: 'horizontal',
                x: 0,
                y: 356,
                width: 678,
                height: 24,
            },
        })).toBe('horizontal');
        expect(root.style.getPropertyValue('--xc-fold-width')).toBe('678px');
        expect(root.style.getPropertyValue('--xc-fold-height')).toBe('24px');
        expect(root.style.getPropertyValue('--xc-fold-x')).toBe('0px');
        expect(root.style.getPropertyValue('--xc-fold-y')).toBe('356px');
        expect(root).toHaveAttribute('data-fold', 'horizontal');
    });

    it('applies vertical division dimensions in CSS pixels', () => {
        expect(applyNativeFold({
            division: {
                orientation: 'vertical',
                x: 412.5,
                y: 0,
                width: 18,
                height: 900,
            },
        })).toBe('vertical');
        expect(root.style.getPropertyValue('--xc-fold-width')).toBe('18px');
        expect(root.style.getPropertyValue('--xc-fold-height')).toBe('900px');
        expect(root.style.getPropertyValue('--xc-fold-x')).toBe('412.5px');
        expect(root.style.getPropertyValue('--xc-fold-y')).toBe('0px');
        expect(root).toHaveAttribute('data-fold', 'vertical');
    });

    it('uses zero dimensions for absent or non-finite values', () => {
        applyNativeFold(undefined);
        expect(root.style.getPropertyValue('--xc-fold-width')).toBe('0px');
        expect(root.style.getPropertyValue('--xc-fold-height')).toBe('0px');

        applyNativeFold({
            division: {
                orientation: 'horizontal',
                width: 678,
                height: 'abc',
            },
        });
        expect(root.style.getPropertyValue('--xc-fold-width')).toBe('678px');
        expect(root.style.getPropertyValue('--xc-fold-height')).toBe('0px');
    });

    it('replaces both dimensions when a native fold event arrives', () => {
        const target = new EventTarget();
        target.document = document;
        target.__xchainNativeFold = {
            division: {
                orientation: 'horizontal',
                x: 0,
                y: 356,
                width: 678,
                height: 24,
            },
        };
        const uninstall = installNativeFold(target);

        expect(root.style.getPropertyValue('--xc-fold-width')).toBe('678px');
        expect(root.style.getPropertyValue('--xc-fold-height')).toBe('24px');

        target.dispatchEvent(new CustomEvent('xchain:native-fold', {
            detail: {
                division: {
                    orientation: 'vertical',
                    x: 412.5,
                    y: 0,
                    width: 18,
                    height: 900,
                },
            },
        }));
        expect(root.style.getPropertyValue('--xc-fold-width')).toBe('18px');
        expect(root.style.getPropertyValue('--xc-fold-height')).toBe('900px');

        uninstall();
    });
});
