// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Screenshot protection seam ( §1, S4).
//
// The behaviour that matters is the RELEASE, not the protect. Turning
// FLAG_SECURE on is easy; the bug that bites is turning it off while a
// screen that still needs it is on top - a private-key modal closing over a
// seed-phrase page, say - or leaving it on forever so the user's receive QR
// cannot be screenshotted and their support screen-share is black. Hence the
// reference count, and hence most of this file.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
    useProtectedScreen,
    installScreenGuard,
    isScreenGuardActive,
    __resetScreenGuardForTests,
} from '../../../packages/core/src/shared/utils/screenGuard.js';

afterEach(() => __resetScreenGuardForTests());

describe('screen guard', () => {
    it('is inert until a shell installs one', () => {
        expect(isScreenGuardActive()).toBe(false);
        // Mounting a protected screen with no shell handler must not throw:
        // this is the web, extension and desktop case, i.e. most of them.
        expect(() => renderHook(() => useProtectedScreen())).not.toThrow();
    });

    it('protects on mount and releases on unmount', () => {
        const calls = [];
        installScreenGuard((on) => calls.push(on));
        const { unmount } = renderHook(() => useProtectedScreen());
        expect(calls).toEqual([true]);
        unmount();
        expect(calls).toEqual([true, false]);
    });

    it('does not release while a nested protected screen is still mounted', () => {
        const calls = [];
        installScreenGuard((on) => calls.push(on));
        const outer = renderHook(() => useProtectedScreen());
        const inner = renderHook(() => useProtectedScreen());
        expect(calls).toEqual([true]);          // not asserted twice
        inner.unmount();
        expect(calls).toEqual([true]);          // still protected: outer needs it
        outer.unmount();
        expect(calls).toEqual([true, false]);
    });

    it('honours an opt-out without counting it', () => {
        const calls = [];
        installScreenGuard((on) => calls.push(on));
        const { unmount } = renderHook(() => useProtectedScreen(false));
        expect(calls).toEqual([]);
        unmount();
        expect(calls).toEqual([]);
    });

    it('re-asserts when the shell installs its handler late', () => {
        // The native boot path is async: a protected screen can already be
        // mounted when the guard arrives, and it would otherwise sit
        // unprotected until the next navigation.
        renderHook(() => useProtectedScreen());
        const calls = [];
        installScreenGuard((on) => calls.push(on));
        expect(calls).toEqual([true]);
    });

    it('survives a handler that throws', () => {
        // A failing guard must not take down the screen it protects: the
        // user is mid-backup, and losing the flow is worse than the
        // screenshot being possible on a device where the call did not work.
        installScreenGuard(() => { throw new Error('binder died'); });
        expect(() => {
            const { unmount } = renderHook(() => useProtectedScreen());
            unmount();
        }).not.toThrow();
    });

    it('reports whether protection is real', () => {
        expect(isScreenGuardActive()).toBe(false);
        installScreenGuard(vi.fn());
        expect(isScreenGuardActive()).toBe(true);
        installScreenGuard(null);
        expect(isScreenGuardActive()).toBe(false);
    });
});
