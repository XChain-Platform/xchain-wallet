// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §33 command-palette trigger row in LeftNav. Desktop has no AppHeader, so
// its visible palette entry is a search row in the nav; it appears only when
// the shell wires `onCommandPalette` (web leaves it unset because it already
// has a header search button, so it must NOT get a duplicate).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';

afterEach(() => cleanup());

const baseProps = { currentView: 'home', onSelect: () => {} };

describe('LeftNav command-palette trigger', () => {
    it('renders no search row when onCommandPalette is not provided', () => {
        render(<LeftNav {...baseProps} />);
        expect(screen.queryByRole('button', { name: 'Open command palette' })).toBeNull();
    });

    it('renders a search row and fires the handler when onCommandPalette is provided', () => {
        const onCommandPalette = vi.fn();
        render(<LeftNav {...baseProps} onCommandPalette={onCommandPalette} />);
        const btn = screen.getByRole('button', { name: 'Open command palette' });
        expect(btn).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
        fireEvent.click(btn);
        expect(onCommandPalette).toHaveBeenCalledOnce();
    });
});
