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

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
    anchoredPopoverPlacement,
    clampShift,
    VIEWPORT_CLAMP_MARGIN,
} from '../../../packages/core/src/shared/hooks/useViewportClamp.js';
import { HeaderSettingsButton } from '../../../packages/core/src/shared/components/HeaderSettingsButton.jsx';

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

describe('HeaderSettingsButton popover follows its trigger', () => {
    function mockLayout({ viewport, trigger, width }) {
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: viewport });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
            if (this.getAttribute('aria-label') === 'Settings') {
                return {
                    left: trigger.right - 38,
                    top: trigger.bottom - 38,
                    right: trigger.right,
                    bottom: trigger.bottom,
                    width: 38,
                    height: 38,
                    x: trigger.right - 38,
                    y: trigger.bottom - 38,
                    toJSON() {},
                };
            }
            if (this.getAttribute('role') !== 'dialog') {
                return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
            }
            const x = Number.parseFloat(this.style.left) || 0;
            return { left: x, top: 60, right: x + width, bottom: 300, width, height: 240, x, y: 60, toJSON() {} };
        });
    }

    const open = () => {
        render(<HeaderSettingsButton activeWallet={{ id: 'w1', name: 'Main' }} onOpenWalletPicker={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        return screen.getByRole('dialog', { name: 'Wallet settings' });
    };

    it('right-aligns the panel under the gear in a K51-sized viewport', () => {
        mockLayout({ viewport: 411, trigger: { right: 399, bottom: 52 }, width: 320 });
        const panel = open();
        expect(panel.style.position).toBe('fixed');
        expect(panel.style.left).toBe('79px');
        expect(panel.style.top).toBe('58px');
        const rect = panel.getBoundingClientRect();
        expect(rect.right).toBe(399);
    });

    it('clamps the panel when right alignment would cross the viewport', () => {
        mockLayout({ viewport: 411, trigger: { right: 170, bottom: 52 }, width: 320 });
        const panel = open();
        expect(panel.style.left).toBe(`${VIEWPORT_CLAMP_MARGIN}px`);
        expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(411 - VIEWPORT_CLAMP_MARGIN);
    });

    it('recomputes its anchored coordinates on resize', () => {
        mockLayout({ viewport: 411, trigger: { right: 399, bottom: 52 }, width: 320 });
        const panel = open();
        fireEvent(window, new Event('resize'));
        fireEvent(window, new Event('resize'));
        expect(panel.style.left).toBe('79px');
    });
});

describe('anchoredPopoverPlacement', () => {
    it('computes right alignment and viewport clamping', () => {
        expect(anchoredPopoverPlacement({ right: 399, bottom: 52 }, 320, 411)).toEqual({
            left: 79,
            top: 58,
        });
        expect(anchoredPopoverPlacement({ right: 170, bottom: 52 }, 320, 411)).toEqual({
            left: VIEWPORT_CLAMP_MARGIN,
            top: 58,
        });
    });
});
