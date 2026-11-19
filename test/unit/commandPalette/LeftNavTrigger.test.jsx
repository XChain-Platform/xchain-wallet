// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The side menu holds destinations only (U99, operator 2026-11-18). Its Search
// row looked like a text field but opened the wallet menu, which belongs to
// the app bar's menu button and Cmd/Ctrl+K, so it was removed. A shell that
// still passes the old onCommandPalette prop gets no search control either.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';

afterEach(() => cleanup());

const baseProps = { currentView: 'home', onSelect: () => {}, onOpenSettings: () => {}, onLock: () => {} };

function expectNoSearchControl(container) {
    const nav = screen.getByRole('navigation');
    expect(screen.queryByRole('button', { name: /wallet menu|search/i })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(nav.querySelector('[aria-keyshortcuts]')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
}

describe('LeftNav has no search control', () => {
    it('renders destinations with no search row', () => {
        const { container } = render(<LeftNav {...baseProps} />);
        expectNoSearchControl(container);
        expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    });

    it('ignores a leftover onCommandPalette prop', () => {
        const { container } = render(<LeftNav {...baseProps} onCommandPalette={() => {}} />);
        expectNoSearchControl(container);
    });
});
