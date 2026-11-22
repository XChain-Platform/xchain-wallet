// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A screen still takes focus on its heading for screen readers, but the
// focus box shows only when the user has been using the keyboard: on first
// load or after a click the title is not framed (operator 2026-11-22, the
// license page's boxed title in the extension popup).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';

const pageHeaderCss = readFileSync('packages/core/src/ui/PageHeader.module.css', 'utf8');

afterEach(cleanup);

describe('page heading focus box', () => {
    it('focuses the heading without a box when no key has been pressed', () => {
        fireEvent.pointerDown(document.body);
        render(<PageHeader title="License Agreement" />);
        const heading = screen.getByRole('heading', { level: 1, name: 'License Agreement' });
        expect(heading).toHaveFocus();
        expect(heading).toHaveAttribute('data-quiet-focus');
    });

    it('keeps the box for a keyboard user', () => {
        fireEvent.keyDown(document.body, { key: 'Tab' });
        render(<PageHeader title="Receive" />);
        const heading = screen.getByRole('heading', { level: 1, name: 'Receive' });
        expect(heading).toHaveFocus();
        expect(heading).not.toHaveAttribute('data-quiet-focus');
    });

    it('treats a shortcut chord as no keyboard navigation', () => {
        fireEvent.pointerDown(document.body);
        fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
        render(<PageHeader title="Send" />);
        expect(screen.getByRole('heading', { level: 1, name: 'Send' })).toHaveAttribute('data-quiet-focus');
    });

    it('makes the quiet outline transparent, so forced-colors mode still paints it', () => {
        const rule = pageHeaderCss.match(/\.title\[data-quiet-focus\]:focus\s*\{([^}]*)\}/)?.[1] || '';
        expect(rule.replace(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('outline: 2px solid transparent;');
    });
});
