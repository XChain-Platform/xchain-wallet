// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
    LeftNav,
    LEFT_NAV_VIEW_GROUPS,
    activeLeftNavItem,
} from '../../../packages/core/src/shared/components/LeftNav.jsx';

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const baseProps = {
    currentView: 'home',
    onSelect: vi.fn(),
    onOpenSettings: vi.fn(),
    onLock: vi.fn(),
    hasVmAddress: true,
};

function readRepoFile(relativePath) {
    return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('LeftNav route state', () => {
    it('assigns every web and desktop unlocked route to exactly one nav item', () => {
        const shellSource = [
            readRepoFile('packages/web/src/App.jsx'),
            readRepoFile('packages/desktop/renderer/App.jsx'),
        ].join('\n');
        const routeMatches = [
            ...shellSource.matchAll(/unlockedView === '([^']+)'/g),
            ...shellSource.matchAll(/setUnlockedView\('([^']+)'\)/g),
        ];
        const routedViews = new Set(routeMatches.map((match) => match[1]));
        const assignments = new Map();

        for (const [itemId, views] of Object.entries(LEFT_NAV_VIEW_GROUPS)) {
            for (const view of views) {
                const itemIds = assignments.get(view) || [];
                assignments.set(view, [...itemIds, itemId]);
            }
        }

        expect([...routedViews].filter((view) => !assignments.has(view))).toEqual([]);
        expect([...assignments].filter(([, itemIds]) => itemIds.length !== 1)).toEqual([]);
    });

    it.each([
        ['send-picker', 'Send'],
        ['receive-picker', 'Receive'],
        ['markets-picker', 'DEX'],
        ['contract-stake', 'Contracts'],
        ['list-transfer', 'Lists'],
        ['coinpay', 'Payments due'],
        ['connected-sites', 'Settings'],
    ])('highlights %s under %s', (currentView, label) => {
        const { container } = render(<LeftNav {...baseProps} currentView={currentView} />);
        const current = container.querySelectorAll('[aria-current="page"]');

        expect(current).toHaveLength(1);
        expect(current[0]).toHaveTextContent(label);
    });

    it('matches an unknown shell fallback to Home', () => {
        expect(activeLeftNavItem('unknown-route')).toBe('home');
    });
});

describe('LeftNav rail interaction', () => {
    it('gives icon-only destinations, Settings, and Lock native tooltips', () => {
        render(<LeftNav {...baseProps} />);

        expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('title', 'Home');
        expect(screen.getByRole('button', { name: 'DEX' })).toHaveAttribute('title', 'DEX');
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('title', 'Settings');
        expect(screen.getByRole('button', { name: 'Lock' })).toHaveAttribute('title', 'Lock');
    });

    it('moves focus with arrows and Home or End without activating a route', () => {
        render(<LeftNav {...baseProps} />);
        const home = screen.getByRole('button', { name: 'Home' });
        const history = screen.getByRole('button', { name: 'History' });
        const lock = screen.getByRole('button', { name: 'Lock' });

        home.focus();
        fireEvent.keyDown(home, { key: 'ArrowDown' });
        expect(history).toHaveFocus();
        fireEvent.keyDown(history, { key: 'ArrowUp' });
        expect(home).toHaveFocus();
        fireEvent.keyDown(home, { key: 'End' });
        expect(lock).toHaveFocus();
        fireEvent.keyDown(lock, { key: 'Home' });
        expect(home).toHaveFocus();
        expect(baseProps.onSelect).not.toHaveBeenCalled();
    });

    it('keeps Settings and Lock operable', () => {
        const onOpenSettings = vi.fn();
        const onLock = vi.fn();
        render(
            <LeftNav
                {...baseProps}
                onOpenSettings={onOpenSettings}
                onLock={onLock}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
        expect(onOpenSettings).toHaveBeenCalledOnce();
        expect(onLock).toHaveBeenCalledOnce();
    });

    it('keeps the short-window scroller and theme colors on shared tokens', () => {
        const css = readRepoFile('packages/core/src/shared/components/LeftNav.module.css');

        expect(css).toMatch(/\.nav\s*\{[\s\S]*?overflow-y:\s*auto/);
        expect(css).toMatch(/\.nav > \.footer\s*\{[\s\S]*?flex-shrink:\s*0/);
        expect(css).toMatch(/background:\s*var\(--xc-surface-raised\)/);
        expect(css).toMatch(/color:\s*var\(--xc-text\)/);
        expect(css).toMatch(/border-inline-end:\s*1px solid var\(--xc-border\)/);
    });
});
