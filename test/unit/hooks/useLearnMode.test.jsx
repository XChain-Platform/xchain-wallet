// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useLearnMode } from '../../../packages/core/src/shared/hooks/useLearnMode.js';
import { LEARN_MODE_ATTR } from '../../../packages/core/src/shared/hooks/useSettingsRootAttributes.js';

afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute(LEARN_MODE_ATTR);
    vi.restoreAllMocks();
});

describe('useLearnMode', () => {
    it('is false when the root attribute is absent', () => {
        const { result } = renderHook(() => useLearnMode());

        expect(result.current).toBe(false);
    });

    it.each([
        ['on', true],
        ['off', false],
        ['true', false],
        ['', false],
    ])('reads %j as %s', (value, expected) => {
        document.documentElement.setAttribute(LEARN_MODE_ATTR, value);

        const { result } = renderHook(() => useLearnMode());

        expect(result.current).toBe(expected);
    });

    it('tracks the attribute being enabled and removed', async () => {
        const { result } = renderHook(() => useLearnMode());

        act(() => document.documentElement.setAttribute(LEARN_MODE_ATTR, 'on'));
        await waitFor(() => expect(result.current).toBe(true));

        act(() => document.documentElement.removeAttribute(LEARN_MODE_ATTR));
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('disconnects its observer on unmount', () => {
        const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
        const { unmount } = renderHook(() => useLearnMode());

        unmount();

        expect(disconnect).toHaveBeenCalledTimes(1);
    });
});
