// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The header gear's popover is 320px wide and aligned to the gear's trailing
// edge. On a 411px-wide phone the gear sits about 170px from the left, so the
// panel's natural position starts roughly 150px OFF the left of the screen:
// half of it could be neither read nor tapped (found on an LG K51,
// 2026-10-12). These guards pin the clamp that slides it back inside.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { clampShift, VIEWPORT_CLAMP_MARGIN } from '../../../packages/core/src/shared/hooks/useViewportClamp.js';
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
});

describe('HeaderSettingsButton popover stays on screen', () => {
    function mockLayout({ viewport, left, width }) {
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: viewport });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
            if (this.getAttribute('role') !== 'dialog') {
                return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
            }
            // Report the natural position plus whatever transform is applied,
            // as a real layout engine would.
            const m = /translateX\((-?\d+)px\)/.exec(this.style.transform || '');
            const x = left + (m ? Number(m[1]) : 0);
            return { left: x, top: 60, right: x + width, bottom: 300, width, height: 240, x, y: 60, toJSON() {} };
        });
    }

    const open = () => {
        render(<HeaderSettingsButton activeWallet={{ id: 'w1', name: 'Main' }} onOpenWalletPicker={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        return screen.getByRole('dialog', { name: 'Wallet settings' });
    };

    it('slides the panel inside a phone-width viewport', () => {
        mockLayout({ viewport: 411, left: -149, width: 320 });
        const panel = open();
        expect(panel.style.transform).toBe(`translateX(${149 + VIEWPORT_CLAMP_MARGIN}px)`);
        const rect = panel.getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(VIEWPORT_CLAMP_MARGIN);
        expect(rect.right).toBeLessThanOrEqual(411 - VIEWPORT_CLAMP_MARGIN);
    });

    it('applies no transform when the panel already fits', () => {
        mockLayout({ viewport: 1280, left: 900, width: 320 });
        const panel = open();
        expect(panel.style.transform).toBe('');
    });

    it('re-measures on resize without compounding the shift', () => {
        mockLayout({ viewport: 411, left: -149, width: 320 });
        const panel = open();
        fireEvent(window, new Event('resize'));
        fireEvent(window, new Event('resize'));
        expect(panel.style.transform).toBe(`translateX(${149 + VIEWPORT_CLAMP_MARGIN}px)`);
    });
});
