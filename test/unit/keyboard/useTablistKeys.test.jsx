// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Arrow-key model for role="tablist" strips, installed once per shell.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { userEvent } from '../../helpers/userEvent.js';
import { useState } from 'react';
import { nextTabIndex, useTablistKeys } from '../../../packages/core/src/shared/keyboard/useTablistKeys.js';

afterEach(() => cleanup());

function Strip({ withDisabled = false }) {
    useTablistKeys();
    const [sel, setSel] = useState('a');
    return (
        <div role="tablist" aria-label="Demo">
            {['a', 'b', 'c'].map((id) => (
                <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={sel === id}
                    disabled={withDisabled && id === 'b'}
                    onClick={() => setSel(id)}
                >
                    {id}
                </button>
            ))}
        </div>
    );
}

describe('nextTabIndex', () => {
    it('wraps the arrows and jumps with Home/End', () => {
        expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
        expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
        expect(nextTabIndex('Home', 2, 3)).toBe(0);
        expect(nextTabIndex('End', 0, 3)).toBe(2);
        expect(nextTabIndex('x', 0, 3)).toBeNull();
        expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
    });

    it('flips the arrows in a right-to-left layout', () => {
        expect(nextTabIndex('ArrowLeft', 0, 3, true)).toBe(1);
        expect(nextTabIndex('ArrowRight', 0, 3, true)).toBe(2);
    });
});

describe('useTablistKeys', () => {
    it('keeps one tab stop as user keyboard navigation changes selection', async () => {
        const user = userEvent.setup();
        render(<Strip />);
        const tabs = screen.getAllByRole('tab');

        expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
        await user.tab();
        expect(tabs[0]).toHaveFocus();
        fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
        expect(tabs[1]).toHaveFocus();
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
        fireEvent.keyDown(tabs[1], { key: 'End' });
        expect(tabs[2]).toHaveFocus();
        fireEvent.keyDown(tabs[2], { key: 'Home' });
        expect(tabs[0]).toHaveFocus();
    });

    it('moves focus and selection with the arrow keys', () => {
        render(<Strip />);
        const a = screen.getByRole('tab', { name: 'a' });
        a.focus();
        fireEvent.keyDown(a, { key: 'ArrowRight' });
        const b = screen.getByRole('tab', { name: 'b' });
        expect(document.activeElement).toBe(b);
        expect(b).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(b, { key: 'End' });
        expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'c' }));
        fireEvent.keyDown(document.activeElement, { key: 'Home' });
        expect(document.activeElement).toBe(a);
    });

    it('skips disabled tabs', () => {
        render(<Strip withDisabled />);
        const a = screen.getByRole('tab', { name: 'a' });
        a.focus();
        fireEvent.keyDown(a, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'c' }));
    });

    it('ignores keys outside a tablist and modified arrows', () => {
        render(<div><Strip /><button data-testid="plain">x</button></div>);
        const plain = screen.getByTestId('plain');
        plain.focus();
        fireEvent.keyDown(plain, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(plain);
        const a = screen.getByRole('tab', { name: 'a' });
        a.focus();
        fireEvent.keyDown(a, { key: 'ArrowRight', altKey: true });
        expect(document.activeElement).toBe(a);
    });
});
