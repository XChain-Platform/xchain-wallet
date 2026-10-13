// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Platform switcher: cross-site navigation to the rest of the *.xchain.io
// family. Two things are worth pinning. First, it is OPT-IN: the extension
// popup and desktop app must not sprout a menu of websites just because core
// gained a component. Second, every destination uses a native external anchor,
// so browser and packaged shells can route it without navigating the wallet.
//
// Whether the vendored list still matches what xchain.io publishes is checked
// separately, over the network: test/smoke/shells/platform-links-drift.smoke.js

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { PlatformSwitcher } from '../../../packages/core/src/shared/components/PlatformSwitcher.jsx';
import LINKS from '../../../packages/core/src/shared/platform-links.json';

afterEach(() => cleanup());

const trigger = () => screen.queryByRole('button', { name: 'XChain platform sites' });

describe('PlatformSwitcher', () => {
    it('renders nothing when the shell does not opt in', () => {
        render(<PlatformSwitcher />);
        expect(trigger()).toBeNull();
    });

    it('renders a trigger when the shell names its own surface', () => {
        render(<PlatformSwitcher current="wallet" />);
        expect(trigger()).not.toBeNull();
    });

    it('lists every sibling host once opened', () => {
        render(<PlatformSwitcher current="wallet" />);
        fireEvent.click(trigger());
        for (const p of LINKS.links.filter((l) => l.key !== 'wallet')) {
            const link = screen.getByRole('menuitem', { name: new RegExp(p.label, 'i') });
            expect(link.getAttribute('href')).toBe(p.href);
        }
    });

    it('marks the current surface and does not link to it', () => {
        render(<PlatformSwitcher current="wallet" />);
        fireEvent.click(trigger());
        const self = LINKS.links.find((p) => p.key === 'wallet');
        const here = screen.getByRole('menuitem', { name: `${self.label}, current site` });
        expect(here.getAttribute('aria-current')).toBe('page');
        expect(here.getAttribute('aria-disabled')).toBe('true');
        expect(here.tagName).toBe('DIV');
    });

    it('opens every destination in a new tab with a safe rel', () => {
        render(<PlatformSwitcher current="wallet" />);
        fireEvent.click(trigger());
        const items = screen.getAllByRole('menuitem').filter((item) => item.tagName === 'A');
        expect(items.length).toBe(LINKS.links.length - 1);
        for (const a of items) {
            expect(a.getAttribute('target')).toBe('_blank');
            expect(a.getAttribute('rel')).toContain('noopener');
        }
    });

    it('focuses destinations and supports menu arrow keys', () => {
        render(<PlatformSwitcher current="wallet" />);
        fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
        const items = screen.getAllByRole('menuitem').filter((item) => item.tagName === 'A');
        expect(document.activeElement).toBe(items[0]);

        fireEvent.keyDown(items[0], { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[1]);
        fireEvent.keyDown(items[1], { key: 'End' });
        expect(document.activeElement).toBe(items.at(-1));
        fireEvent.keyDown(items.at(-1), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[0]);
    });

    it('closes after native link selection without cancelling shell routing', () => {
        render(<PlatformSwitcher current="wallet" />);
        fireEvent.click(trigger());
        const destination = LINKS.links.find((p) => p.key === 'explorer');
        const link = screen.getByRole('menuitem', { name: destination.label });

        expect(fireEvent.click(link)).toBe(true);
        expect(link.getAttribute('href')).toBe(destination.href);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes on Escape and returns focus to the trigger', () => {
        render(<PlatformSwitcher current="wallet" />);
        fireEvent.click(trigger());
        expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryAllByRole('menuitem').length).toBe(0);
        expect(document.activeElement).toBe(trigger());
    });
});

describe('AppHeader integration', () => {
    it('shows no switcher unless the host passes platformCurrent', () => {
        render(<AppHeader onMenuOpen={() => {}} />);
        expect(trigger()).toBeNull();
    });

    it('shows the switcher for a shell that opts in', () => {
        render(<AppHeader onMenuOpen={() => {}} platformCurrent="wallet" />);
        expect(trigger()).not.toBeNull();
    });
});

describe('the vendored link list', () => {
    it('is a generated artifact, and says so', () => {
        expect(LINKS.$comment).toMatch(/GENERATED/);
        expect(LINKS.$comment).toMatch(/xchain-websites/);
    });

    it('includes this surface, so the switcher can mark it', () => {
        expect(LINKS.links.map((p) => p.key)).toContain('wallet');
    });

    it('points every entry at an https xchain.io origin', () => {
        for (const p of LINKS.links) {
            expect(p.href).toMatch(/^https:\/\/([a-z-]+\.)?xchain\.io\/$/);
        }
    });

    it('omits the internal dashboard, and includes every live host', () => {
        const keys = LINKS.links.map((p) => p.key);
        expect(keys).not.toContain('dashboard');
        // Liveness rule: a host joins only once it serves 200 over HTTPS.
        // mcp.xchain.io met that on 2026-07-29, so it is expected here.
        expect(keys).toContain('mcp');
    });
});
