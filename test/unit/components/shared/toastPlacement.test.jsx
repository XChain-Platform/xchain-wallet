// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, cleanup, render } from '@testing-library/react';
import {
    TOAST_CLEARANCE_PX,
    toastLift,
} from '../../../../packages/core/src/shared/components/toastPlacement.js';
vi.mock('../../../../packages/core/src/shared/hooks/useHaptic.js', () => {
    const haptic = { error: () => {}, warn: () => {}, success: () => {}, tap: () => {} };
    return { useHaptic: () => haptic, HapticProvider: ({ children }) => children };
});

import { ToastHost, useToast } from '../../../../packages/core/src/shared/components/ToastHost.jsx';

const rect = (top, bottom, left = 16, right = 344) => ({
    top, bottom, left, right, width: right - left, height: bottom - top,
});

// A 360x800 phone: content area 106..744 above a 56px tab bar, the stack
// resting at 670..728.
const PHONE = { content: rect(106, 744, 0, 360), stack: rect(670, 728), windowHeight: 800 };

describe('toastLift', () => {
    it('leaves the stack at rest when nothing it must clear is under it', () => {
        expect(toastLift({ ...PHONE, focused: rect(300, 336) })).toBe(0);
        expect(toastLift({ ...PHONE, focused: null })).toBe(0);
    });

    it('lifts the stack above the control that has focus', () => {
        // Receive at 360 wide: Copy QR (638..674) keeps focus after the tap.
        const lift = toastLift({ ...PHONE, focused: rect(638, 674, 12, 171) });
        expect(lift).toBe(728 - (638 - TOAST_CLEARANCE_PX));
    });

    it('lifts the stack above a screen footer below the content area', () => {
        const content = rect(106, 680, 0, 360);
        expect(toastLift({ ...PHONE, content, focused: null })).toBe(728 - (680 - TOAST_CLEARANCE_PX));
    });

    it('never climbs onto the header or below the bar to clear a control', () => {
        // A three-toast stack over a tall field: neither side has room, so
        // the stack stays at rest.
        const focused = rect(300, 600, 12, 348);
        expect(toastLift({ ...PHONE, stack: rect(428, 728), focused })).toBe(0);
    });

    it('moves just below a focused control the resting stack only touches, when it fits', () => {
        // The stack top meets the control bottom with no gap; there is room
        // for it between the control and the content area's bottom edge.
        expect(toastLift({ ...PHONE, focused: rect(634, 670, 12, 171) }))
            .toBe(728 - (670 + TOAST_CLEARANCE_PX + 58));
    });

    it('ignores a focused container such as the content area or a list', () => {
        expect(toastLift({ ...PHONE, focused: rect(106, 744, 0, 360) })).toBe(0);
    });

    it('ignores a focused control beside the stack on a wide screen', () => {
        const wide = { content: rect(106, 850, 220, 1290), stack: rect(772, 834, 826, 1274), windowHeight: 850 };
        expect(toastLift({ ...wide, focused: rect(790, 826, 240, 400) })).toBe(0);
        expect(toastLift({ ...wide, focused: rect(790, 826, 1120, 1260) })).toBe(834 - (790 - TOAST_CLEARANCE_PX));
    });
});

describe('ToastHost placement', () => {
    afterEach(() => {
        cleanup();
        document.documentElement.style.removeProperty('--xc-bottom-bar-h');
        vi.restoreAllMocks();
    });

    let api;
    function Capture() {
        api = useToast();
        return (
            <main id="xc-main">
                <button type="button">Copy QR</button>
            </main>
        );
    }

    function mockRects(map) {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function measure() {
            for (const [match, value] of map) if (match(this)) return value;
            return rect(0, 0, 0, 0);
        });
    }

    it('places the stack bottom-centre with the bar and bottom-end without it', () => {
        render(<ToastHost><Capture /></ToastHost>);
        const viewport = document.querySelector('[aria-label="Notifications"]');
        act(() => { api.showToast({ message: 'Copied', durationMs: 0 }); });
        expect(viewport.dataset.placement).toBe('end');

        document.documentElement.style.setProperty('--xc-bottom-bar-h', '3.5rem');
        act(() => { api.showToast({ message: 'Copied again', durationMs: 0 }); });
        expect(viewport.dataset.placement).toBe('center');
    });

    it('lifts a new toast above the focused control and reserves scroll room', () => {
        render(<ToastHost><Capture /></ToastHost>);
        const viewport = document.querySelector('[aria-label="Notifications"]');
        const button = document.querySelector('button');
        mockRects([
            [(el) => el === viewport, rect(670, 728)],
            [(el) => el.id === 'xc-main', rect(106, 744, 0, 360)],
            [(el) => el === button, rect(638, 674, 12, 171)],
        ]);
        button.focus();
        act(() => { api.showToast({ message: 'QR code copied to clipboard.', durationMs: 0 }); });

        expect(viewport.style.getPropertyValue('--xc-toast-lift')).toBe(`${728 - (638 - TOAST_CLEARANCE_PX)}px`);
        expect(document.documentElement.style.getPropertyValue('--xc-toast-room'))
            .toBe(`${58 + TOAST_CLEARANCE_PX}px`);
    });

    it('drops the scroll room once the stack empties', () => {
        render(<ToastHost><Capture /></ToastHost>);
        const viewport = document.querySelector('[aria-label="Notifications"]');
        let height = 58;
        mockRects([[(el) => el === viewport, { ...rect(670, 670 + height), height }]]);
        let id;
        act(() => { id = api.showToast({ message: 'Saved', durationMs: 0 }); });
        expect(document.documentElement.style.getPropertyValue('--xc-toast-room')).not.toBe('');
        height = 0;
        mockRects([[(el) => el === viewport, rect(728, 728)]]);
        act(() => { api.dismissToast(id); });
        expect(document.documentElement.style.getPropertyValue('--xc-toast-room')).toBe('');
    });

    it('applies the lift in both resting rules and gives the scroll room to the content area', () => {
        const css = readFileSync('packages/core/src/shared/components/ToastHost.module.css', 'utf8');
        const lifts = css.match(/\+\s*var\(--xc-toast-lift,\s*0px\)/g) || [];
        expect(lifts).toHaveLength(2);
        expect(css).toMatch(/\.viewport\[data-placement='end'\]\s*\{[^}]*inset-inline-end:[^}]*transform:\s*none/s);
        const screenCss = readFileSync('packages/core/src/ui/Screen.module.css', 'utf8');
        expect(screenCss).toMatch(/\.body::after\s*\{[^}]*height:\s*var\(--xc-toast-room,\s*0px\)/s);
    });
});
