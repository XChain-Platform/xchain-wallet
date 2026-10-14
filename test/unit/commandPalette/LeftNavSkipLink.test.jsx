// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Persistent navigation and header chrome surround the page at every width,
// so the layout offers a first-stop skip link that lands on the main region.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { userEvent } from '../../helpers/userEvent.js';

vi.mock('../../../packages/core/src/shared/styles/useLayoutTier.js', () => ({
    useLayoutTier: () => [() => {}, globalThis.__tier ?? 'full'],
}));

const { FullLayoutWithNav } = await import('../../../packages/core/src/shared/components/LeftNav.jsx');

afterEach(() => { cleanup(); delete globalThis.__tier; });

describe('FullLayoutWithNav skip link', () => {
    it.each(['full', 'compact'])('is the first %s-tier Tab stop and focuses the main region', async (tier) => {
        globalThis.__tier = tier;
        const user = userEvent.setup();
        render(
            <FullLayoutWithNav
                nav={<nav aria-label="nav"><button type="button">Sidebar home</button></nav>}
                header={<button type="button">Header action</button>}
                bottomBar={<nav aria-label="bar"><button type="button">Popup home</button></nav>}
            >
                <main id="xc-main" tabIndex={-1}><button type="button">Route action</button></main>
            </FullLayoutWithNav>,
        );
        const skip = screen.getByRole('link', { name: 'Skip to main content' });
        expect(skip.parentElement.firstElementChild).toBe(skip);
        await user.tab();
        expect(skip).toHaveFocus();
        fireEvent.keyDown(skip, { key: 'Enter' });
        fireEvent.click(skip, { detail: 0 });
        fireEvent.keyUp(skip, { key: 'Enter' });
        expect(document.activeElement).toBe(document.getElementById('xc-main'));

        if (tier === 'compact') {
            expect(screen.queryByRole('button', { name: 'Sidebar home' })).toBeNull();
            expect(screen.getByRole('button', { name: 'Popup home' })).toBeInTheDocument();
        } else {
            expect(screen.getByRole('button', { name: 'Sidebar home' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Popup home' })).toBeNull();
        }
    });
});
