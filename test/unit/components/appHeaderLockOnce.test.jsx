// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Lock shows once per layout: the sidebar or rail keeps its Lock row and the
// app header drops its Lock button; with the bottom tab bar the header keeps it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { FullLayoutWithNav, LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const originalWidth = window.innerWidth;

afterEach(() => {
    window.innerWidth = originalWidth;
    cleanup();
});

function renderLayout(width, onLock) {
    window.innerWidth = width;
    return render(
        <MessagingProvider
            shell="web"
            messaging={{ getSettings: async () => ({ schemaVersion: 1, activeNetwork: 'mainnet' }) }}
        >
            <FullLayoutWithNav
                nav={<LeftNav currentView="home" onSelect={() => {}} onLock={onLock} />}
                bottomBar={<BottomTabBar currentView="home" onSelect={() => {}} onLock={onLock} />}
                header={<AppHeader onLock={onLock} onMenuOpen={() => {}} />}
            >
                <main />
            </FullLayoutWithNav>
        </MessagingProvider>,
    );
}

describe('Lock control appears once per layout', () => {
    it.each([700, 1290])('wide layout (%dpx): the side navigation keeps Lock and the header drops it', (width) => {
        const onLock = vi.fn();
        const { container } = renderLayout(width, onLock);
        expect(container.querySelector('[data-xc-rail="shown"]')).not.toBeNull();

        const header = screen.getByRole('region', { name: 'App header' });
        expect(within(header).queryByRole('button', { name: 'Lock wallet' })).toBeNull();
        expect(within(header).getByRole('button', { name: 'Open menu' })).toBeTruthy();

        const lock = within(screen.getByRole('navigation', { name: 'Primary navigation' }))
            .getByRole('button', { name: 'Lock' });
        fireEvent.click(lock);
        expect(onLock).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole('button', { name: /^Lock/ })).toHaveLength(1);
    });

    it.each([360, 480])('phone layout (%dpx): the header keeps Lock beside the tab bar', (width) => {
        const onLock = vi.fn();
        const { container } = renderLayout(width, onLock);
        expect(container.querySelector('[data-xc-rail="shown"]')).toBeNull();

        const header = screen.getByRole('region', { name: 'App header' });
        fireEvent.click(within(header).getByRole('button', { name: 'Lock wallet' }));
        expect(onLock).toHaveBeenCalledTimes(1);
        expect(header.lastElementChild).toContainElement(within(header).getByRole('button', { name: 'Open menu' }));
    });

    it('a header outside any layout keeps Lock', () => {
        render(<AppHeader onLock={() => {}} onMenuOpen={() => {}} />);
        expect(screen.getByRole('button', { name: 'Lock wallet' })).toBeTruthy();
    });
});
