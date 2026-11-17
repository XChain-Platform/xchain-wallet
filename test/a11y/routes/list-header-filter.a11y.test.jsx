// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The list pages that moved their search, filters and sort into the title
// bar filter panel (G95) stay clean under axe with rows loaded and the
// panel open, where the route sweep only sees them closed.

import { afterEach, describe, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';
import { SharedListDirectory } from '../../../packages/core/src/shared/routes/SharedListDirectory.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

afterEach(() => cleanup());

const PAGES = [
    {
        name: 'Contacts',
        filter: 'Filter contacts',
        loaded: () => screen.findByRole('button', { name: 'Alice' }),
        element: (
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
            </MessagingProvider>
        ),
    },
    {
        name: 'My lists',
        filter: 'Filter lists',
        loaded: () => screen.findByRole('button', { name: /Road trip/ }),
        element: (
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
            </MessagingProvider>
        ),
    },
    {
        // A loaded directory: each entry is a listitem holding its facts
        // (a dl) and its action list (G101), so axe sees no dl-as-listitem.
        name: 'Shared lists',
        filter: 'Filter shared lists',
        loaded: () => screen.findByRole('list', { name: 'Token list 12 actions' }),
        element: (
            <MessagingProvider
                shell="web"
                messaging={{
                    getSharedLists: vi.fn().mockResolvedValue({
                        lists: [{
                            kind: 'home',
                            home_chain: 'BTC',
                            home_list_index: 12,
                            type: 1,
                            owner: BTC,
                            member_count: 3,
                            share_block: 100,
                            bindTarget: 1012,
                            maintainedByPlatform: false,
                        }],
                        unavailable: [],
                    }),
                }}
            >
                <SharedListDirectory walletId="w1" chainId="bitcoin-mainnet" mode="browse" onSelect={() => {}} onOpenList={() => {}} onBack={() => {}} />
            </MessagingProvider>
        ),
    },
    {
        name: 'Choose a shared list',
        filter: 'Filter shared lists',
        loaded: () => screen.findByRole('list', { name: 'Token list 12 actions' }),
        element: (
            <MessagingProvider
                shell="web"
                messaging={{
                    getSharedLists: vi.fn().mockResolvedValue({
                        lists: [{
                            kind: 'home',
                            home_chain: 'BTC',
                            home_list_index: 12,
                            type: 1,
                            owner: BTC,
                            member_count: 3,
                            share_block: 100,
                            bindTarget: 1012,
                            maintainedByPlatform: false,
                        }],
                        unavailable: [],
                    }),
                }}
            >
                <SharedListDirectory walletId="w1" chainId="bitcoin-mainnet" mode="pick" filterType="token" onSelect={() => {}} onBack={() => {}} />
            </MessagingProvider>
        ),
    },
];

describe('list page header filter accessibility', () => {
    it.each(PAGES)('$name has no serious axe violations with the filter panel open', async (page) => {
        const { container } = render(page.element);
        await page.loaded();
        await expectNoSeriousAxeViolations(container);
        fireEvent.click(screen.getByRole('button', { name: page.filter }));
        screen.getByRole('dialog', { name: page.filter });
        await expectNoSeriousAxeViolations(container);
    });
});
