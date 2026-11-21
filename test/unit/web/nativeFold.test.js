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
    root.removeAttribute('data-fold');
});

describe('native fold', () => {
    it('applies the native division to root layout state', () => {
        expect(applyNativeFold({
            division: { orientation: 'vertical', x: 412.5, y: 0 },
        })).toBe('vertical');
        expect(root.style.getPropertyValue('--xc-fold-x')).toBe('412.5px');
        expect(root.style.getPropertyValue('--xc-fold-y')).toBe('0px');
        expect(root).toHaveAttribute('data-fold', 'vertical');
    });

    it('uses none and zero coordinates when no division is available', () => {
        expect(applyNativeFold(undefined)).toBe('none');
        expect(root.style.getPropertyValue('--xc-fold-x')).toBe('0px');
        expect(root.style.getPropertyValue('--xc-fold-y')).toBe('0px');
        expect(root).toHaveAttribute('data-fold', 'none');
    });

    it('reads cold-start state and follows native fold events', () => {
        const target = new EventTarget();
        target.document = document;
        target.__xchainNativeFold = {
            division: { orientation: 'horizontal', x: 0, y: 356 },
        };
        const uninstall = installNativeFold(target);

        expect(root).toHaveAttribute('data-fold', 'horizontal');
        expect(root.style.getPropertyValue('--xc-fold-y')).toBe('356px');

        target.__xchainNativeFold = {
            division: { orientation: 'vertical', x: 540, y: 0 },
        };
        target.dispatchEvent(new Event('xchain:native-fold'));
        expect(root).toHaveAttribute('data-fold', 'vertical');
        expect(root.style.getPropertyValue('--xc-fold-x')).toBe('540px');

        uninstall();
    });
});
