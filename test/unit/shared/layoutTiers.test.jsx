// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// responsive-first program, slice 1.
//
// The bug this locks down: the shell carried two width thresholds that
// disagreed (JS flipped the web variant at 640px, CSS collapsed the
// sidebar at 900px), so between 640px and 899px the wallet rendered no
// persistent navigation at all. The invariant below is the fix stated
// positively: at EVERY width, exactly one nav surface is mounted.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
    TIER_RAIL_MIN_PX,
    TIER_FULL_MIN_PX,
    tierForWidth,
    showsSidebar,
    showsBottomBar,
} from '../../../packages/core/src/shared/styles/breakpoints.js';
import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';

describe('layout tiers', () => {
    describe('tierForWidth()', () => {
        it('maps representative device widths to the intended tier', () => {
            // 360 is the Chrome extension popup / small-phone width called
            // out in the item's verify line.
            expect(tierForWidth(320)).toBe('compact');
            expect(tierForWidth(360)).toBe('compact');
            expect(tierForWidth(390)).toBe('compact');   // iPhone portrait
            expect(tierForWidth(768)).toBe('rail');      // tablet portrait
            expect(tierForWidth(1024)).toBe('full');     // tablet landscape
            expect(tierForWidth(1440)).toBe('full');     // desktop
        });

        it('switches exactly at the shared boundaries', () => {
            expect(tierForWidth(TIER_RAIL_MIN_PX - 1)).toBe('compact');
            expect(tierForWidth(TIER_RAIL_MIN_PX)).toBe('rail');
            expect(tierForWidth(TIER_FULL_MIN_PX - 1)).toBe('rail');
            expect(tierForWidth(TIER_FULL_MIN_PX)).toBe('full');
        });

        it('falls back to compact on a width it cannot trust', () => {
            for (const bad of [0, -1, NaN, undefined, null, 'wide']) {
                expect(tierForWidth(bad)).toBe('compact');
            }
        });
    });

    describe('nav-surface invariant', () => {
        it('mounts exactly one persistent nav surface at every width', () => {
            // Walk the whole plausible range one pixel at a time; the old
            // 640-899 dead zone would fail this on its first width.
            for (let px = 240; px <= 2000; px += 1) {
                const tier = tierForWidth(px);
                const surfaces = [showsSidebar(tier), showsBottomBar(tier)]
                    .filter(Boolean).length;
                expect(surfaces, `width ${px}px (tier ${tier})`).toBe(1);
            }
        });
    });

    describe('<FullLayoutWithNav>', () => {
        const originalWidth = window.innerWidth;

        afterEach(() => {
            cleanup();
            window.innerWidth = originalWidth;
        });

        // jsdom performs no layout, so the container measures 0 and
        // useLayoutTier falls back to the viewport. That is the same code
        // path a real browser takes before first layout.
        function renderAt(width) {
            window.innerWidth = width;
            return render(
                <FullLayoutWithNav
                    nav={<nav data-testid="sidebar-nav" />}
                    bottomBar={<div data-testid="bottom-bar" />}
                >
                    <main data-testid="route" />
                </FullLayoutWithNav>,
            );
        }

        it('gives a 360px popup the bottom bar and no sidebar', () => {
            const { container } = renderAt(360);
            expect(container.firstChild.getAttribute('data-xc-tier')).toBe('compact');
            expect(screen.queryByTestId('sidebar-nav')).toBeNull();
            expect(screen.getByTestId('bottom-bar')).toBeInTheDocument();
        });

        it('gives a 768px tablet the sidebar and no bottom bar', () => {
            const { container } = renderAt(768);
            expect(container.firstChild.getAttribute('data-xc-tier')).toBe('rail');
            expect(screen.getByTestId('sidebar-nav')).toBeInTheDocument();
            expect(screen.queryByTestId('bottom-bar')).toBeNull();
        });

        it('gives a desktop window the sidebar and no bottom bar', () => {
            const { container } = renderAt(1440);
            expect(container.firstChild.getAttribute('data-xc-tier')).toBe('full');
            expect(screen.getByTestId('sidebar-nav')).toBeInTheDocument();
            expect(screen.queryByTestId('bottom-bar')).toBeNull();
        });

        it('reserves the bottom-bar gutter only when the bar is mounted', () => {
            const compact = renderAt(360);
            expect(compact.container.firstChild.className).toMatch(/layoutWithBottomBar/);
            cleanup();
            const wide = renderAt(1200);
            expect(wide.container.firstChild.className).not.toMatch(/layoutWithBottomBar/);
        });

        it('renders the route body on every tier', () => {
            for (const width of [360, 768, 1440]) {
                renderAt(width);
                expect(screen.getByTestId('route')).toBeInTheDocument();
                cleanup();
            }
        });
    });
});
