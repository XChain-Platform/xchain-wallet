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
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
    LeftNav,
    LEFT_NAV_VIEW_GROUPS,
    activeLeftNavItem,
} from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import navStyles from '../../../packages/core/src/shared/components/LeftNav.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

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
    hasBtcAddress: true,
    hasGovernanceAddress: true,
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
        const routedViews = new Set(routeMatches
            .map((match) => match[1])
            .filter((view) => ROUTE_REGISTRY[view]));
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
        ['markets-picker', 'Exchange (DEX)'],
        ['contract-stake', 'Contracts'],
        ['manage-token', 'My Tokens'],
        ['governance-poll-detail', 'Governance'],
        ['stake-detail', 'Staking'],
        ['bet-market-detail', 'Prediction markets'],
        ['cosigner-detail', 'My Agents'],
        ['connected-sites', 'Settings'],
    ])('highlights %s under %s', (currentView, label) => {
        const { container } = render(<LeftNav {...baseProps} currentView={currentView} />);
        const current = container.querySelectorAll('[aria-current="page"]');

        expect(current).toHaveLength(1);
        expect(current[0]).toHaveTextContent(label);
    });

    it.each(['scan', 'list-transfer', 'coinpay'])(
        'leaves %s unselected because it stays in the main menu',
        (currentView) => {
            const { container } = render(<LeftNav {...baseProps} currentView={currentView} />);
            expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
        },
    );

    it('matches an unknown shell fallback to Home', () => {
        expect(activeLeftNavItem('unknown-route')).toBe('home');
    });
});

describe('LeftNav rail interaction', () => {
    it('does not repeat the wallet name already shown in the app header', () => {
        render(
            <LeftNav
                {...baseProps}
                walletName="Demo Wallet"
                onOpenWalletPicker={vi.fn()}
            />,
        );

        expect(screen.queryByText('Demo Wallet')).toBeNull();
    });

    it('gives icon-only destinations, Settings, and Lock native tooltips', () => {
        render(<LeftNav {...baseProps} />);

        expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('title', 'Home');
        expect(screen.getByRole('button', { name: 'Exchange (DEX)' }))
            .toHaveAttribute('title', 'Exchange (DEX)');
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('title', 'Settings');
        const lock = screen.getByRole('button', { name: 'Lock wallet' });
        expect(lock).toHaveAttribute('title', 'Lock wallet');
        // A plain row like Settings at every width (operator 2026-11-13).
        expect(lock).not.toHaveClass(buttonStyles.secondary);
        expect(lock).toHaveClass(buttonStyles.ghost);
        expect(lock).toHaveClass(navStyles.item);
    });

    it('renders the layout 5 groups and exact destination order', () => {
        render(<LeftNav {...baseProps} />);
        const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
        const labels = (group) => within(nav).getByRole('list', { name: group })
            .querySelectorAll('button');
        const names = (group) => [...labels(group)].map((button) => button.textContent.trim());

        expect(names('Wallet')).toEqual([
            'Home', 'Send', 'Receive', 'My Tokens', 'History',
        ]);
        expect(names('Trade')).toEqual(['Exchange (DEX)', 'Marketplace', 'Dispensers', 'Prediction markets']);
        expect(names('Network')).toEqual(['Governance', 'Staking']);
        expect(names('Build')).toEqual(['Contracts', 'My Agents']);
        expect(names('Social')).toEqual(['Messaging', 'Contacts']);
        for (const removed of ['Scan', 'Lists', 'Payments due']) {
            expect(within(nav).queryByRole('button', { name: removed })).toBeNull();
        }
    });

    it('moves focus with arrows and Home or End without activating a route', () => {
        render(<LeftNav {...baseProps} />);
        const home = screen.getByRole('button', { name: 'Home' });
        const send = screen.getByRole('button', { name: 'Send' });
        const lock = screen.getByRole('button', { name: 'Lock wallet' });

        home.focus();
        fireEvent.keyDown(home, { key: 'ArrowDown' });
        expect(send).toHaveFocus();
        fireEvent.keyDown(send, { key: 'ArrowUp' });
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
        fireEvent.click(screen.getByRole('button', { name: 'Lock wallet' }));
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
        expect(css).toMatch(/\.groupLabel\s*\{[\s\S]*?text-transform:\s*uppercase/);
        expect(css).toMatch(/data-xc-side-menu='icons'[\s\S]*?\.groupDivider\s*\{[\s\S]*?display:\s*block/);
    });
});
