// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The shared dropdown (operator ruling 2026-11-14): the open list is at least
// as wide as its longest option and never cut off (it turns to the trigger's
// end edge, or upward, when it would run past the viewport), and the closed
// trigger keeps the width of its longest option label so a pick never
// resizes it and never pushes a Settings row title onto a second line.
// jsdom has no layout, so the width rules are pinned in the stylesheet and
// the placement rule is driven with measured rectangles.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Select } from '../../../packages/core/src/ui/Select.jsx';
import { listPlacement } from '../../../packages/core/src/ui/IconSelect.jsx';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');
const OPTIONS = [
    { value: 'off', label: 'Off' },
    { value: '5', label: '5 s' },
    { value: '30', label: 'A much longer choice label' },
];

afterEach(() => cleanup());

function rect({ left, top, width, height }) {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} };
}

describe('Select keeps one closed width per control', () => {
    it('lays every option label into the trigger invisibly, outside its text and name', () => {
        render(<Select aria-label="Hold" value="off" options={OPTIONS} onChange={() => {}} />);
        const trigger = screen.getByRole('combobox', { name: 'Hold' });
        const sizer = trigger.querySelector('[aria-hidden="true"] [data-label]')?.parentElement;
        expect(sizer).toBeTruthy();
        expect([...sizer.querySelectorAll('[data-label]')].map((n) => n.getAttribute('data-label')))
            .toEqual(['Off', '5 s', 'A much longer choice label']);
        // The labels come from the attribute, so the trigger still reads as its pick.
        expect(trigger.textContent).toBe('Off');
    });

    it('keeps the same sizer whichever option is picked', () => {
        const { rerender } = render(<Select aria-label="Hold" value="off" options={OPTIONS} onChange={() => {}} />);
        const before = screen.getByRole('combobox').querySelector('[data-label]').parentElement.outerHTML;
        rerender(<Select aria-label="Hold" value="30" options={OPTIONS} onChange={() => {}} />);
        const after = screen.getByRole('combobox').querySelector('[data-label]').parentElement.outerHTML;
        expect(after).toBe(before);
        expect(screen.getByRole('combobox').textContent).toBe('A much longer choice label');
    });

    it('styles the sizer zero-height and hidden, its text from the label attribute', () => {
        const css = read('packages/core/src/ui/IconSelect.module.css');
        expect(css).toMatch(/\.sizer\s*\{[^}]*height:\s*0;[^}]*overflow:\s*hidden;[^}]*visibility:\s*hidden;/);
        expect(css).toMatch(/\.sizerItem\s*\{[^}]*white-space:\s*nowrap;/);
        expect(css).toMatch(/\.sizerItem::before\s*\{\s*content:\s*attr\(data-label\);/);
    });
});

describe('Select open list', () => {
    it('is at least the trigger width and as wide as its longest option, inside the viewport', () => {
        const css = read('packages/core/src/ui/IconSelect.module.css');
        const popover = css.match(/\.popover\s*\{([^}]*)\}/)[1];
        expect(popover).toMatch(/min-width:\s*100%;/);
        expect(popover).toMatch(/width:\s*max-content;/);
        expect(popover).toMatch(/max-width:\s*calc\(100vw - 32px\);/);
        // No longer pinned to both trigger edges, which clipped long labels.
        expect(popover).toMatch(/inset-inline-end:\s*auto;/);
        // Labels in the open list wrap rather than trail off.
        expect(css).toMatch(/\.popover \.labelText,\s*\.popover \.sub\s*\{[^}]*white-space:\s*normal;[^}]*\}/);
        expect(css).toMatch(/\.popoverEnd\s*\{[^}]*inset-inline-end:\s*0;/);
        expect(css).toMatch(/\.popoverUp\s*\{[^}]*bottom:\s*calc\(100% \+ 4px\);/);
    });

    it('turns to the end edge when it would run past the viewport', () => {
        vi.stubGlobal('innerWidth', 360);
        vi.stubGlobal('innerHeight', 640);
        const popover = document.createElement('div');
        const trigger = document.createElement('button');
        popover.getBoundingClientRect = () => rect({ left: 250, top: 140, width: 180, height: 200 });
        trigger.getBoundingClientRect = () => rect({ left: 250, top: 100, width: 96, height: 36 });
        expect(listPlacement(popover, trigger)).toEqual({ end: true, up: false, maxHeight: null });
        vi.unstubAllGlobals();
    });

    it('opens upward when the space below is short and more is above', () => {
        vi.stubGlobal('innerWidth', 360);
        vi.stubGlobal('innerHeight', 640);
        const popover = document.createElement('div');
        const trigger = document.createElement('button');
        popover.getBoundingClientRect = () => rect({ left: 20, top: 600, width: 180, height: 200 });
        trigger.getBoundingClientRect = () => rect({ left: 20, top: 560, width: 180, height: 36 });
        expect(listPlacement(popover, trigger)).toEqual({ end: false, up: true, maxHeight: null });
        vi.unstubAllGlobals();
    });

    it('stays under the trigger from its start edge when it fits, and makes no guess without layout', () => {
        vi.stubGlobal('innerWidth', 360);
        vi.stubGlobal('innerHeight', 640);
        const popover = document.createElement('div');
        const trigger = document.createElement('button');
        popover.getBoundingClientRect = () => rect({ left: 20, top: 140, width: 180, height: 200 });
        trigger.getBoundingClientRect = () => rect({ left: 20, top: 100, width: 180, height: 36 });
        expect(listPlacement(popover, trigger)).toEqual({ end: false, up: false, maxHeight: null });
        popover.getBoundingClientRect = () => rect({ left: 0, top: 0, width: 0, height: 0 });
        expect(listPlacement(popover, trigger)).toBeNull();
        vi.unstubAllGlobals();
    });

    it('shows every option in full and marks where it opened', () => {
        render(<Select aria-label="Hold" value="off" options={OPTIONS} onChange={() => {}} />);
        fireEvent.click(screen.getByRole('combobox', { name: 'Hold' }));
        const list = screen.getByRole('listbox');
        expect(list.getAttribute('data-placement')).toBe('bottom-start');
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Off', '5 s', 'A much longer choice label']);
    });
});

describe('Settings dropdown rows', () => {
    it('keep the title on one line beside a dropdown', () => {
        const css = read('packages/core/src/shared/components/settings/SettingsInlineRow.module.css');
        expect(css).toMatch(/\.row\[data-settings-inline='select'\] \.title\s*\{[^}]*white-space:\s*nowrap;/);
    });
});
