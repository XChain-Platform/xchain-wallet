// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The header gear's popover is 320px wide and follows the gear's right
// edge. These guards cover direct trigger placement and the shared fallback
// clamp used by the scan menu.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import {
    anchoredPopoverPlacement,
    clampShift,
    VIEWPORT_CLAMP_MARGIN,
} from '../../../packages/core/src/shared/hooks/useViewportClamp.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('clampShift', () => {
    const M = VIEWPORT_CLAMP_MARGIN;

    it('leaves a box that already fits where it is', () => {
        expect(clampShift(40, 320, 1280)).toBe(0);
        expect(clampShift(M, 320, 411)).toBe(0);
    });

    it('slides a box hanging off the left edge to the leading margin', () => {
        // The K51 case: natural left edge at -149.
        expect(clampShift(-149, 320, 411)).toBe(149 + M);
    });

    it('slides a box hanging off the right edge back to the trailing margin', () => {
        expect(clampShift(200, 320, 411)).toBe(411 - M - 520);
    });

    it('pins a box wider than the viewport to the leading margin', () => {
        expect(clampShift(-30, 400, 360)).toBe(30 + M);
        expect(clampShift(50, 400, 360)).toBe(M - 50);
    });

    it.each([360, 411, 600, 900, 1280])(
        'keeps settings and scan surfaces inside a %ipx viewport',
        (viewport) => {
            for (const box of [
                { left: -80, width: Math.min(320, viewport - (2 * M)) },
                { left: viewport - 80, width: 184 },
            ]) {
                const shiftedLeft = box.left + clampShift(box.left, box.width, viewport);
                expect(shiftedLeft).toBeGreaterThanOrEqual(M);
                expect(shiftedLeft + box.width).toBeLessThanOrEqual(viewport - M);
            }
        },
    );
});

describe('anchoredPopoverPlacement', () => {
    it('computes alignment, flipping, and viewport clamping', () => {
        expect(anchoredPopoverPlacement({ left: 361, right: 399, bottom: 52 }, 320, 411)).toEqual({
            left: 79,
            top: 58,
        });
        expect(anchoredPopoverPlacement({ left: 12, right: 50, bottom: 52 }, 280, 360)).toEqual({
            left: VIEWPORT_CLAMP_MARGIN,
            top: 58,
        });
        expect(anchoredPopoverPlacement({ left: 120, right: 158, bottom: 52 }, 320, 360)).toEqual({
            left: VIEWPORT_CLAMP_MARGIN,
            top: 58,
        });
    });
});
