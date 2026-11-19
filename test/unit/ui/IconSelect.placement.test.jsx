// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G122 (operator 2026-11-15): an open dropdown is never cut off at the top or
// bottom of the screen. It opens on whichever side of its field has more
// room and, when that side is still too short, becomes a scrolling list
// capped to the room. jsdom has no layout, so the rule is driven with
// measured rectangles.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IconSelect, listPlacement } from '../../../packages/core/src/ui/IconSelect.jsx';

function rect({ left, top, width, height }) {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} };
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('dropdown placement in a short viewport', () => {
    it('opens upward and caps its height when neither side holds the whole list', () => {
        vi.stubGlobal('innerWidth', 360);
        vi.stubGlobal('innerHeight', 300);
        const popover = document.createElement('div');
        const trigger = document.createElement('button');
        // A 320px list under a field near the bottom of a 300px tall screen.
        popover.getBoundingClientRect = () => rect({ left: 20, top: 244, width: 180, height: 320 });
        trigger.getBoundingClientRect = () => rect({ left: 20, top: 200, width: 180, height: 40 });
        const placement = listPlacement(popover, trigger);
        // Above: 200 - 4 - 8 = 188px; below: 300 - 240 - 4 - 8 = 48px.
        expect(placement).toEqual({ end: false, up: true, maxHeight: 188 });
    });

    it('stays below and caps its height when the room below is the larger side', () => {
        vi.stubGlobal('innerWidth', 360);
        vi.stubGlobal('innerHeight', 300);
        const popover = document.createElement('div');
        const trigger = document.createElement('button');
        popover.getBoundingClientRect = () => rect({ left: 20, top: 104, width: 180, height: 320 });
        trigger.getBoundingClientRect = () => rect({ left: 20, top: 60, width: 180, height: 40 });
        // Below: 300 - 100 - 4 - 8 = 188px; above: 60 - 4 - 8 = 48px.
        expect(listPlacement(popover, trigger)).toEqual({ end: false, up: false, maxHeight: 188 });
    });

    it('measures against a clipping scroller, not only the window', () => {
        vi.stubGlobal('innerWidth', 360);
        vi.stubGlobal('innerHeight', 800);
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        scroller.getBoundingClientRect = () => rect({ left: 0, top: 100, width: 360, height: 300 });
        const wrap = document.createElement('div');
        const trigger = document.createElement('button');
        const popover = document.createElement('div');
        wrap.append(trigger, popover);
        scroller.append(wrap);
        document.body.append(scroller);
        popover.getBoundingClientRect = () => rect({ left: 20, top: 344, width: 180, height: 150 });
        trigger.getBoundingClientRect = () => rect({ left: 20, top: 300, width: 180, height: 40 });
        // The scroller ends at 400: below is 400 - 340 - 12 = 48px, above is
        // 300 - 100 - 12 = 188px, so the list flips up and fits whole.
        expect(listPlacement(popover, trigger)).toEqual({ end: false, up: true, maxHeight: null });
        scroller.remove();
    });

    it('keeps a capped list at least about two options tall', () => {
        vi.stubGlobal('innerWidth', 360);
        vi.stubGlobal('innerHeight', 100);
        const popover = document.createElement('div');
        const trigger = document.createElement('button');
        popover.getBoundingClientRect = () => rect({ left: 20, top: 74, width: 180, height: 320 });
        trigger.getBoundingClientRect = () => rect({ left: 20, top: 30, width: 180, height: 40 });
        expect(listPlacement(popover, trigger).maxHeight).toBe(72);
    });

    it('leaves a list laid out in its container flow uncapped (the filter panel)', () => {
        vi.stubGlobal('innerWidth', 360);
        vi.stubGlobal('innerHeight', 300);
        const popover = document.createElement('div');
        popover.style.position = 'static';
        document.body.append(popover);
        const trigger = document.createElement('button');
        popover.getBoundingClientRect = () => rect({ left: 20, top: 244, width: 180, height: 320 });
        trigger.getBoundingClientRect = () => rect({ left: 20, top: 200, width: 180, height: 40 });
        expect(listPlacement(popover, trigger)).toEqual({ end: false, up: false, maxHeight: null });
        popover.remove();
    });

    it('applies the cap to the open list as its max height', () => {
        vi.stubGlobal('innerWidth', 360);
        vi.stubGlobal('innerHeight', 300);
        // Every element measures as the trigger near the bottom, except the
        // listbox, which measures as a 320px list.
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function measure() {
            if (this.getAttribute?.('role') === 'listbox') return rect({ left: 20, top: 244, width: 180, height: 320 });
            return rect({ left: 20, top: 200, width: 180, height: 40 });
        });
        const options = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `Choice ${i}` }));
        render(<IconSelect label="Pick" value="0" onChange={() => {}} options={options} />);
        fireEvent.click(screen.getByRole('button', { name: /^Pick:/ }));
        const list = screen.getByRole('listbox');
        expect(list.getAttribute('data-placement')).toBe('top-start');
        expect(list.style.maxHeight).toBe('188px');
        // Every option is still in the list; it scrolls inside the cap.
        expect(screen.getAllByRole('option')).toHaveLength(12);
    });
});
