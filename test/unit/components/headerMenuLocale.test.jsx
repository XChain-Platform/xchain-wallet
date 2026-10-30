// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The header menu's site links and the network filter's summary are
// copy like any other: under the pseudo-rtl locale every one of them must
// arrive wrapped, so a string that skipped the dictionary shows as plain English.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HeaderActionMenu } from '../../../packages/core/src/shared/components/HeaderActionMenu.jsx';
import { NetworkFilter } from '../../../packages/core/src/shared/components/NetworkFilter.jsx';
import { NetworkFilterDropdown } from '../../../packages/core/src/shared/components/NetworkFilterDropdown.jsx';
import { platformLinkLabel } from '../../../packages/core/src/shared/platformLinkLabel.js';
import PLATFORM_LINKS from '../../../packages/core/src/shared/platform-links.json';
import { registerLocale, setLocale } from '../../../packages/core/src/i18n/index.js';
import pseudoRtl from '../../../packages/core/src/i18n/locales/pseudo-rtl/index.js';

const WRAPPED = /^‏⟦.+⟧$/u;

const chainRegistry = {
    byCoin: (coin) => [{ id: `${coin}-mainnet`, displayName: coin }],
};

beforeEach(async () => {
    registerLocale('pseudo-rtl', pseudoRtl);
    await setLocale('pseudo-rtl');
});

afterEach(async () => {
    cleanup();
    await setLocale('en');
    vi.restoreAllMocks();
});

describe('header menu copy follows the active locale', () => {
    it('renders Search and every other platform site name wrapped in pseudo-rtl', () => {
        render(<HeaderActionMenu onCommandPalette={() => {}} platformCurrent="wallet" />);
        fireEvent.click(screen.getByRole('button', { name: WRAPPED }));

        const search = screen.getAllByRole('menuitem').find((item) => item.textContent.includes('Search'));
        expect(search.querySelector('span:nth-child(2)').textContent).toMatch(WRAPPED);

        const others = PLATFORM_LINKS.links.filter((site) => site.key !== 'wallet');
        expect(others.length).toBeGreaterThan(0);
        for (const site of others) {
            const link = screen.getAllByRole('menuitem').find((item) => item.getAttribute('href') === site.href);
            expect(link, site.key).toBeTruthy();
            expect(link.textContent, site.key).toMatch(WRAPPED);
        }
    });

    it('resolves every generated site key through the dictionary', () => {
        for (const site of PLATFORM_LINKS.links) {
            expect(platformLinkLabel(site), site.key).toMatch(WRAPPED);
        }
    });

    it('keeps the generated label for a site key it does not know', () => {
        expect(platformLinkLabel({ key: 'newsite', label: 'New site' })).toBe('New site');
    });
});

describe('network filter copy follows the active locale', () => {
    it('wraps the All networks trigger label', () => {
        render(
            <NetworkFilter chainRegistry={chainRegistry} coinFamilies={['bitcoin']} value="all" onChange={() => {}} />,
        );
        const trigger = screen.getByRole('button', { expanded: false });
        expect(trigger.textContent).toMatch(/⟦All networks⟧/u);
        expect(trigger.getAttribute('aria-label')).toMatch(/⟦1 network⟧/u);
    });

    it('wraps the dropdown announcement that names the network count', () => {
        render(
            <NetworkFilterDropdown chainRegistry={chainRegistry} value="all" onChange={() => {}} announceNetworkCount />,
        );
        const trigger = screen.getByRole('button', { expanded: false });
        expect(trigger.getAttribute('aria-label')).toMatch(WRAPPED);
    });
});
