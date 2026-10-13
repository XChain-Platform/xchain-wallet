// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The palette covers the content but not the navigation: any change of the
// shown view closes it, so it never lingers over the screen the user moved to.

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCommandPalette } from '../../../packages/core/src/shared/commandPalette/useCommandPalette.js';

describe('useCommandPalette closes on navigation', () => {
    it('closes when the shown view changes', () => {
        const { result, rerender } = renderHook(({ view }) => useCommandPalette({ currentView: view }), {
            initialProps: { view: 'settings' },
        });
        act(() => result.current.openPalette());
        expect(result.current.open).toBe(true);
        rerender({ view: 'home' });
        expect(result.current.open).toBe(false);
    });

    it('stays open while the view is unchanged', () => {
        const { result, rerender } = renderHook(({ view }) => useCommandPalette({ currentView: view }), {
            initialProps: { view: 'home' },
        });
        act(() => result.current.openPalette());
        rerender({ view: 'home' });
        expect(result.current.open).toBe(true);
    });
});
