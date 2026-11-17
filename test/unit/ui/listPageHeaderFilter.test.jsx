// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// List page template (G95, operator 2026-11-13): a list page's search and
// every filter or sort live in one filter icon in the page header, whose
// panel shows the search first; the add action is a plain plus at the far
// right; nothing sits between the header and the list. Each page is rendered
// with rows loaded, since a loading skeleton has no search to leak.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';
import { SharedListDirectory } from '../../../packages/core/src/shared/routes/SharedListDirectory.jsx';

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

afterEach(() => cleanup());

const PAGES = [
    {
        name: 'Contacts',
        title: 'Contacts',
        filter: 'Filter contacts',
        search: 'Search contacts',
        plus: 'Add contact',
        loaded: () => screen.findByRole('button', { name: 'Alice' }),
        render: () => render(
            <MessagingProvider
                shell="web"
                messaging={{
                    listContacts: vi.fn(async () => [{
                        schemaVersion: 1,
                        id: 'c1',
                        name: 'Alice',
                        notes: '',
                        entries: [{ chain: 'bitcoin', address: BTC, label: '' }],
                        avatarSeed: BTC,
                        createdAt: '2026-01-01T00:00:00.000Z',
                        updatedAt: '2026-01-01T00:00:00.000Z',
                    }]),
                    saveContact: vi.fn(),
                    deleteContact: vi.fn(),
                }}
            >
                <ContactsList walletId="w1" onBack={() => {}} />
            </MessagingProvider>,
        ),
    },
    {
        name: 'My lists',
        title: 'My Lists',
        filter: 'Filter lists',
        search: 'Search lists',
        plus: 'Create list',
        loaded: () => screen.findByRole('button', { name: /Road trip/ }),
        render: () => render(
            <MessagingProvider
                shell="web"
                messaging={{
                    getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ address: 'bc1qowner' }] }),
                    getListsForSource: vi.fn().mockResolvedValue({
                        data: [{ action_index: '700001', name: 'Road trip', type: '2', status: 'valid', source: 'bc1qowner', block_index: 2 }],
                    }),
                }}
            >
                <MyLists walletId="w1" onOpenList={() => {}} onCreateList={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        ),
    },
    {
        name: 'Shared lists',
        title: 'Shared Lists',
        filter: 'Filter shared lists',
        search: 'Search shared lists',
        plus: null,
        loaded: () => screen.findByRole('listitem', { name: 'Token list 1' }),
        render: () => render(
            <MessagingProvider
                shell="web"
                messaging={{
                    getSharedLists: vi.fn().mockResolvedValue({
                        lists: [{ home_chain: 'BTC', home_list_index: 1, type: 1, owner: 'owner-1', member_count: 1, share_block: 100, bindTarget: 1000 }],
                        unavailable: [],
                    }),
                }}
            >
                <SharedListDirectory walletId="w1" chainId="bitcoin-mainnet" mode="browse" onSelect={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        ),
    },
];

/** Buttons in the page header row other than Back. */
function headerActions(title) {
    const row = screen.getByRole('heading', { level: 1, name: title }).parentElement.parentElement;
    return within(row).queryAllByRole('button')
        .filter((button) => !/^Back/.test(button.getAttribute('aria-label') || ''));
}

describe('list page template: the header filter holds the search', () => {
    it.each(PAGES)('$name renders no search input outside the filter panel', async (page) => {
        const view = page.render();
        await page.loaded();

        // Closed: no search box anywhere on the page, and no actions or toolbar row.
        expect(view.container.querySelectorAll('input[type="search"]')).toHaveLength(0);
        expect(view.container.querySelector('[data-xc-page-actions]')).toBeNull();

        // The filter comes first in the title bar and the plus sits at the far right.
        const filter = screen.getByRole('button', { name: page.filter });
        const actions = headerActions(page.title);
        expect(actions[0]).toBe(filter);
        if (page.plus) {
            const plus = screen.getByRole('button', { name: page.plus });
            expect(actions.at(-1)).toBe(plus);
            expect(plus.textContent.trim()).toBe('');
        }

        // Open: the one search box sits inside the filter panel, first.
        fireEvent.click(filter);
        const panel = screen.getByRole('dialog', { name: page.filter });
        const searches = view.container.querySelectorAll('input[type="search"]');
        expect(searches).toHaveLength(1);
        expect(panel).toContainElement(searches[0]);
        expect(searches[0]).toHaveAccessibleName(page.search);
        const firstControl = panel.querySelector('input, select, button');
        expect(firstControl).toBe(searches[0]);
    });

    it.each(PAGES)('$name lights the filter while a search is typed', async (page) => {
        page.render();
        await page.loaded();
        const filter = screen.getByRole('button', { name: page.filter });
        expect(filter.className).not.toMatch(/triggerActive/);
        fireEvent.click(filter);
        fireEvent.change(screen.getByRole('searchbox', { name: page.search }), { target: { value: 'zzz' } });
        expect(screen.getByRole('button', { name: page.filter }).className).toMatch(/triggerActive/);
    });
});
