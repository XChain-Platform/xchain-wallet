// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ShortcutHelp } from '../../../packages/core/src/shared/keyboard/ShortcutHelp.jsx';

afterEach(() => cleanup());

describe('ShortcutHelp', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<ShortcutHelp open={false} onClose={() => {}} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders a modal listing the shortcut catalogue by group', () => {
        render(<ShortcutHelp open onClose={() => {}} />);
        expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-modal', 'true');
        // A representative row from each group.
        expect(screen.getByText('Lock wallet')).toBeTruthy();
        expect(screen.getByText('Go to History')).toBeTruthy();
        // Section headings.
        expect(screen.getByText('General')).toBeTruthy();
        expect(screen.getByText('Go to')).toBeTruthy();
    });

    it('closes on Escape and on the close button', () => {
        const onClose = vi.fn();
        render(<ShortcutHelp open onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
