// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every list row that opens something further ends in the wallet's standard
// trailing chevron (the Back-sized forward chevron). Contacts is rendered;
// the other list pages are held to the same rule at their row markup.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';

const read = (name) => readFileSync(`packages/core/src/shared/routes/${name}`, 'utf8');

describe('drill-in list rows carry the trailing chevron', () => {
    it('renders the chevron after the network badge on each Contacts row', async () => {
        const messaging = {
            listContacts: () => Promise.resolve([
                { schemaVersion: 1, id: 'a', name: 'Alice', notes: '', avatarSeed: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', entries: [{ chain: 'bitcoin', address: 'bc1qjdogbtc', label: '' }] },
            ]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ContactsList walletId="w1" onBack={() => {}} />
            </MessagingProvider>,
        );
        const row = await waitFor(() => within(screen.getByRole('list', { name: 'Contacts' })).getByRole('button', { name: 'Alice' }));
        const chevron = row.querySelector('svg:last-of-type')?.closest('span');
        expect(chevron).not.toBeNull();
        expect(row.lastElementChild.getAttribute('aria-hidden')).toBe('true');
        expect(row.lastElementChild.querySelector('svg')).not.toBeNull();
    });

    it.each([
        ['ContactsList.jsx', /aria-label=\{c\.name\}[\s\S]{0,160}\bchevron/],
        ['MyLists.jsx', /aria-label=\{ariaLabel\}\s+chevron/],
        ['DispensersList.jsx', /Open \$\{row\.give_tick[^\n]*\n\s+chevron/],
        ['MarketsList.jsx', /data-market-result="true"\s+chevron/],
        ['MessagingInbox.jsx', /rowChevron\} data-row-chevron/],
        ['StakingList.jsx', /rowChevron\} data-row-chevron/],
        ['ContractsList.jsx', /onOpenContract\(chainId, String\(rowKey\(row\)\)\)\}\s+chevron/],
    ])('%s row markup includes the chevron', (file, pattern) => {
        expect(read(file)).toMatch(pattern);
    });

    it('keeps the filter panel dropdowns without a visible label', () => {
        expect(read('ContactsList.jsx')).not.toMatch(/<Select\s+label=/);
        expect(read('MyLists.jsx')).not.toMatch(/<Select\s+label=/);
    });
});
