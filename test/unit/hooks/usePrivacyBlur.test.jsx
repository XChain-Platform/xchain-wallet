// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePrivacyBlur } from '../../../packages/core/src/shared/hooks/usePrivacyBlur.js';

afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.xcPrivacyBlur;
    vi.restoreAllMocks();
});

describe('usePrivacyBlur', () => {
    it('tracks host focus and mirrors the result onto the document root', () => {
        let focused = true;
        vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
        const { result } = renderHook(() => usePrivacyBlur(true));

        expect(result.current).toBe(false);
        expect(document.documentElement.dataset.xcPrivacyBlur).toBeUndefined();

        focused = false;
        act(() => window.dispatchEvent(new Event('blur')));
        expect(result.current).toBe(true);
        expect(document.documentElement.dataset.xcPrivacyBlur).toBe('true');

        focused = true;
        act(() => window.dispatchEvent(new Event('focus')));
        expect(result.current).toBe(false);
        expect(document.documentElement.dataset.xcPrivacyBlur).toBeUndefined();
    });

    it('removes the attribute and listeners when disabled', () => {
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        const { result, rerender } = renderHook(
            ({ enabled }) => usePrivacyBlur(enabled),
            { initialProps: { enabled: true } },
        );
        expect(result.current).toBe(true);
        expect(document.documentElement.dataset.xcPrivacyBlur).toBe('true');

        rerender({ enabled: false });
        expect(result.current).toBe(false);
        expect(document.documentElement.dataset.xcPrivacyBlur).toBeUndefined();
    });
});
