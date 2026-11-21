// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    NATIVE_FOLD_EVENT,
    useFoldDivision,
} from '../../../packages/core/src/shared/hooks/useFoldDivision.js';

function publishFold(division) {
    globalThis.__xchainNativeFold = {
        posture: 'open',
        division,
        display: 'inner',
    };
    globalThis.dispatchEvent(new Event(NATIVE_FOLD_EVENT));
}

afterEach(() => {
    cleanup();
    delete globalThis.__xchainNativeFold;
    vi.restoreAllMocks();
});

describe('useFoldDivision', () => {
    it('reads the initial vertical division', () => {
        globalThis.__xchainNativeFold = {
            division: { orientation: 'vertical', x: 612, y: 0 },
        };

        const { result } = renderHook(() => useFoldDivision());

        expect(result.current).toEqual({
            vertical: true,
            dividerX: 612,
            horizontal: false,
            divisionY: null,
        });
    });

    it('follows native fold changes and reports none off the Duo', () => {
        const { result } = renderHook(() => useFoldDivision());

        expect(result.current).toEqual({
            vertical: false,
            dividerX: null,
            horizontal: false,
            divisionY: null,
        });

        act(() => publishFold({ orientation: 'horizontal', x: 0, y: 391 }));
        expect(result.current).toEqual({
            vertical: false,
            dividerX: null,
            horizontal: true,
            divisionY: 391,
        });

        act(() => publishFold({ orientation: 'none', x: 0, y: 0 }));
        expect(result.current).toEqual({
            vertical: false,
            dividerX: null,
            horizontal: false,
            divisionY: null,
        });
    });

    it('removes its native fold listener on unmount', () => {
        const remove = vi.spyOn(globalThis, 'removeEventListener');
        const { unmount } = renderHook(() => useFoldDivision());

        unmount();

        expect(remove).toHaveBeenCalledWith(
            NATIVE_FOLD_EVENT,
            expect.any(Function),
        );
    });
});
