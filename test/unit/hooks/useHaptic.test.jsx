// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const state = vi.hoisted(() => ({
    reducedMotion: false,
    settings: { privacy: { hapticsEnabled: true } },
}));

vi.mock('../../../packages/core/src/ui/reducedMotion.js', () => ({
    useReducedMotion: () => state.reducedMotion,
}));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: state.settings }),
}));

import {
    HapticProvider,
    HAPTIC_PATTERNS,
    useHaptic,
    useHapticFeedback,
} from '../../../packages/core/src/shared/hooks/useHaptic.js';

describe('useHaptic', () => {
    let vibrate;

    beforeEach(() => {
        state.reducedMotion = false;
        state.settings = { privacy: { hapticsEnabled: true } };
        vibrate = vi.fn(() => true);
        Object.defineProperty(globalThis.navigator, 'vibrate', {
            value: vibrate,
            configurable: true,
        });
    });

    it('maps explicit event intents to their named patterns without firing on render', () => {
        const { result, rerender } = renderHook(() => useHaptic());

        expect(vibrate).not.toHaveBeenCalled();
        const firstApi = result.current;
        rerender();
        expect(result.current).toBe(firstApi);
        expect(vibrate).not.toHaveBeenCalled();

        act(() => result.current.tap());
        act(() => result.current.success());
        act(() => result.current.error());

        expect(vibrate.mock.calls).toEqual([
            [HAPTIC_PATTERNS.tap],
            [HAPTIC_PATTERNS.success],
            [HAPTIC_PATTERNS.error],
        ]);
    });

    it('suppresses every pulse when reduced motion is enabled', () => {
        state.reducedMotion = true;
        const { result } = renderHook(() => useHaptic());

        act(() => result.current.tap());
        act(() => result.current.success());
        act(() => result.current.error());

        expect(vibrate).not.toHaveBeenCalled();
    });

    it('suppresses every pulse when Privacy haptics are disabled', () => {
        state.settings = { privacy: { hapticsEnabled: false } };
        const { result } = renderHook(() => useHaptic());

        act(() => result.current.tap());
        act(() => result.current.success());
        act(() => result.current.error());

        expect(vibrate).not.toHaveBeenCalled();
    });

    it('shares the guarded instance with controls under the app provider', () => {
        const feedback = { tap: vi.fn(), error: vi.fn() };
        const wrapper = ({ children }) => (
            <HapticProvider value={feedback}>{children}</HapticProvider>
        );
        const { result } = renderHook(() => useHapticFeedback(), { wrapper });

        act(() => result.current.tap());

        expect(feedback.tap).toHaveBeenCalledOnce();
    });

    it('reports support and passes a custom pattern through', () => {
        const { result } = renderHook(() => useHaptic());

        expect(result.current.supported).toBe(true);
        act(() => result.current.vibrate([1, 2, 3]));

        expect(vibrate).toHaveBeenCalledWith([1, 2, 3]);
    });
});
