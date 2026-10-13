// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The sidebar precedes the page in tab order, so the layout offers a skip
// link that lands on the main region.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/styles/useLayoutTier.js', () => ({
    useLayoutTier: () => [() => {}, globalThis.__tier ?? 'full'],
}));

const { FullLayoutWithNav } = await import('../../../packages/core/src/shared/components/LeftNav.jsx');

afterEach(() => { cleanup(); delete globalThis.__tier; });

describe('FullLayoutWithNav skip link', () => {
    it('is the first thing in the layout and focuses the main region', () => {
        render(
            <FullLayoutWithNav nav={<nav aria-label="nav"><button type="button">Home</button></nav>}>
                <main id="xc-main" tabIndex={-1}>content</main>
            </FullLayoutWithNav>,
        );
        const skip = screen.getByRole('link', { name: 'Skip to main content' });
        expect(skip.parentElement.firstElementChild).toBe(skip);
        fireEvent.click(skip);
        expect(document.activeElement).toBe(document.getElementById('xc-main'));
    });

    it('is absent when the sidebar is withheld', () => {
        globalThis.__tier = 'compact';
        render(
            <FullLayoutWithNav nav={<nav aria-label="nav" />} bottomBar={<nav aria-label="bar" />}>
                <main id="xc-main" tabIndex={-1}>content</main>
            </FullLayoutWithNav>,
        );
        expect(screen.queryByRole('link', { name: 'Skip to main content' })).toBeNull();
    });
});
