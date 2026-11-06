// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The header menu holds only wallet items. The sibling platform sites
// (main site, explorer, docs and the rest) never appear as menu rows or
// links, even on the web shell, which passes its platform key.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { HeaderActionMenu } from '../../../packages/core/src/shared/components/HeaderActionMenu.jsx';
import { platformLinkLabel } from '../../../packages/core/src/shared/platformLinkLabel.js';
import PLATFORM_LINKS from '../../../packages/core/src/shared/platform-links.json';
import { preloadOnDemandOverlays } from '../../../packages/core/src/shared/components/onDemandOverlays.js';

beforeAll(() => preloadOnDemandOverlays());

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: 'normal', perChain: [] }),
}));

afterEach(() => cleanup());

const allActions = {
    onOpenWalletPicker: () => {},
    onOpenSettings: () => {},
    onCommandPalette: () => {},
    onScan: () => {},
    onManageAddresses: () => {},
    onViewAddress: () => {},
    onLock: () => {},
    activeNetwork: 'mainnet',
    onPopOut: () => {},
    onMenuOpen: () => {},
};

const SITE_LABELS = PLATFORM_LINKS.links.map((site) => site.label);
const SITE_HREFS = PLATFORM_LINKS.links.map((site) => site.href);

function expectNoSiteLinks() {
    const menu = screen.getByRole('menu', { name: 'Header actions' });
    for (const item of screen.getAllByRole('menuitem')) {
        const text = item.textContent.trim();
        for (const label of SITE_LABELS) {
            if (label === 'Wallet') continue;
            expect(text, label).not.toContain(label);
        }
        expect(SITE_HREFS).not.toContain(item.getAttribute('href'));
    }
    for (const link of menu.querySelectorAll('a[href]')) {
        expect(SITE_HREFS).not.toContain(link.getAttribute('href'));
    }
    expect(menu.querySelectorAll('a[href*="xchain.io"]').length).toBe(0);
}

describe('the wallet header menu holds only wallet items', () => {
    it('lists no platform site on the web shell header', () => {
        render(<AppHeader {...allActions} platformCurrent="wallet" />);
        fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

        expectNoSiteLinks();
        for (const label of ['Settings', 'Search', 'Scan', 'Manage addresses', 'View address', 'More wallet actions']) {
            expect(screen.getByRole('menuitem', { name: label }), label).toBeTruthy();
        }
    });

    it('lists no platform site when the menu renders on its own', () => {
        render(<HeaderActionMenu onCommandPalette={() => {}} onScan={() => {}} platformCurrent="wallet" />);
        fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

        expectNoSiteLinks();
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            expect.stringContaining('Search'),
            'Scan',
            'Open in new window',
        ]);
    });

    it('marks a Search-only menu as search-only on the web shell too', () => {
        // A pop-out window offers no pop-out row, which leaves Search alone.
        globalThis.xchainWalletWindow = true;
        onTestFinished(() => { delete globalThis.xchainWalletWindow; });
        const { container } = render(<HeaderActionMenu onCommandPalette={() => {}} platformCurrent="wallet" />);
        expect(container.querySelector('[data-header-menu="search-only"]')).not.toBeNull();
    });
});

// The phone More sheet is the wallet's own menu too: it lists wallet places
// and ends on the destructive Lock wallet row, with no sibling site links.
const SHEET_SITE_LABELS = PLATFORM_LINKS.links
    .filter((site) => site.key !== 'wallet')
    .flatMap((site) => [site.label, platformLinkLabel(site)]);

function openMoreSheet(extraProps = {}) {
    render(
        <BottomTabBar
            currentView="home"
            onSelect={() => {}}
            onLock={() => {}}
            onOpenSettings={() => {}}
            onOpenWalletPicker={() => {}}
            {...extraProps}
        />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    return screen.getByRole('button', { name: 'Lock wallet' });
}

describe('the phone More sheet holds only wallet items', () => {
    // A stray platform key from a shell leaves the sheet unchanged.
    for (const extraProps of [{}, { platformCurrent: 'wallet' }]) {
        const name = Object.keys(extraProps).join(',') || 'no platform key';
        it(`ends on Lock wallet with no site links (${name})`, () => {
            const lock = openMoreSheet(extraProps);
            const rows = Array.from(lock.closest('ul').querySelectorAll(':scope > li'));

            expect(rows[rows.length - 1].contains(lock)).toBe(true);
            expect(lock).toHaveAttribute('data-destructive', 'true');
            expect(lock.closest('li').nextElementSibling).toBeNull();
            expect(document.querySelectorAll('a[target="_blank"]')).toHaveLength(0);

            const rowTexts = Array.from(document.querySelectorAll('[data-xc-menu-item]'))
                .map((node) => node.textContent.trim());
            for (const label of SHEET_SITE_LABELS) {
                expect(rowTexts, label).not.toContain(label);
            }
        });
    }

    it('gives the web shell bottom bar no platform key', () => {
        const app = readFileSync(
            join(import.meta.dirname, '..', '..', '..', 'packages', 'web', 'src', 'App.jsx'),
            'utf8',
        );
        // Any platform key the web shell still passes sits on the header.
        let at = app.indexOf('platformCurrent=');
        while (at !== -1) {
            const opener = app.lastIndexOf('<', at);
            expect(app.slice(opener, opener + '<AppHeader'.length)).toBe('<AppHeader');
            at = app.indexOf('platformCurrent=', at + 1);
        }
        // A bar element runs from its tag to the first self-close; its arrow
        // props hold `>` but never `/>`.
        const bars = [];
        for (let start = app.indexOf('<BottomTabBar'); start !== -1; start = app.indexOf('<BottomTabBar', start + 1)) {
            bars.push(app.slice(start, app.indexOf('/>', start)));
        }
        expect(bars.length).toBeGreaterThan(0);
        for (const bar of bars) expect(bar).not.toContain('platformCurrent');
    });
});
