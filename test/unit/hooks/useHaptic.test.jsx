// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { hookState } = vi.hoisted(() => ({
    hookState: { reducedMotion: false, settings: null },
}));

vi.mock('../../../packages/core/src/ui/reducedMotion.js', () => ({
    useReducedMotion: () => hookState.reducedMotion,
}));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: hookState.settings }),
}));

const { HAPTIC_PATTERNS, useHaptic } = await import(
    '../../../packages/core/src/shared/hooks/useHaptic.js'
);

beforeEach(() => {
    hookState.reducedMotion = false;
    hookState.settings = null;
    Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: vi.fn(() => true),
    });
});

describe('useHaptic', () => {
    it('maps intent methods to vibration patterns', () => {
        const { result } = renderHook(() => useHaptic());

        expect(result.current.supported).toBe(true);
        act(() => {
            result.current.tap();
            result.current.success();
            result.current.vibrate([1, 2, 3]);
        });

        expect(navigator.vibrate).toHaveBeenNthCalledWith(1, HAPTIC_PATTERNS.tap);
        expect(navigator.vibrate).toHaveBeenNthCalledWith(2, HAPTIC_PATTERNS.success);
        expect(navigator.vibrate).toHaveBeenNthCalledWith(3, [1, 2, 3]);
    });

    it.each([
        ['reduced motion', true, null],
        ['the wallet opt-out', false, { privacy: { hapticsEnabled: false } }],
    ])('suppresses vibration for %s', (_label, reducedMotion, settings) => {
        hookState.reducedMotion = reducedMotion;
        hookState.settings = settings;
        const { result } = renderHook(() => useHaptic());

        act(() => result.current.error());

        expect(navigator.vibrate).not.toHaveBeenCalled();
    });
});
