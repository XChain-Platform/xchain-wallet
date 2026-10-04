// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.


// A tester's address book grew three rows for one person, one per chain,
// and listed them in storage order. The model already holds many addresses
// per contact; these pin that the screens now use it: name order by
// default, a save under a known name joins that contact, and a one-tap
// merge folds the duplicates an older wallet already saved.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import {
    duplicateNameGroups,
    findContactByName,
    mergeContactGroup,
    withEntriesAdded,
} from '../../../packages/core/src/shared/utils/contactMerge.js';

const contact = (id, name, createdAt, entries, notes = '') => ({
    schemaVersion: 1, id, name, notes, entries, avatarSeed: '', createdAt, updatedAt: createdAt,
});
const BTC = { chain: 'bitcoin', address: 'bc1qjdogbtc', label: '' };
const LTC = { chain: 'litecoin', address: 'ltc1qjdogltc', label: '' };
const DOGE = { chain: 'dogecoin', address: 'DJdogDoge', label: '' };

describe('contact merge helpers', () => {
    it('finds a contact by name ignoring case and spaces', () => {
        const c = contact('a', 'JDog', '2026-01-01T00:00:00.000Z', [BTC]);
        expect(findContactByName([c], '  jdog ')).toBe(c);
        expect(findContactByName([c], 'someone')).toBeNull();
    });

    it('adds only addresses the contact does not already hold', () => {
        const c = contact('a', 'JDog', '2026-01-01T00:00:00.000Z', [BTC]);
        const out = withEntriesAdded(c, [{ ...BTC, address: 'BC1QJDOGBTC' }, LTC]);
        expect(out.entries).toEqual([BTC, LTC]);
    });

    it('folds a group into its oldest contact with every address and note', () => {
        const group = [
            contact('new', 'jdog', '2026-03-01T00:00:00.000Z', [DOGE], 'doge one'),
            contact('old', 'JDog', '2026-01-01T00:00:00.000Z', [BTC], 'friend'),
            contact('mid', 'JDog', '2026-02-01T00:00:00.000Z', [LTC, BTC]),
        ];
        const { keep, dropIds } = mergeContactGroup(group);
        expect(keep.id).toBe('old');
        expect(keep.entries).toEqual([BTC, LTC, DOGE]);
        expect(keep.notes).toBe('friend\ndoge one');
        expect(dropIds.sort()).toEqual(['mid', 'new']);
    });

    it('reports only names used more than once', () => {
        const groups = duplicateNameGroups([
            contact('a', 'JDog', '2026-01-01T00:00:00.000Z', [BTC]),
            contact('b', 'jdog', '2026-01-02T00:00:00.000Z', [LTC]),
            contact('c', 'Alice', '2026-01-03T00:00:00.000Z', [DOGE]),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].map((c) => c.id)).toEqual(['a', 'b']);
    });
});

function makeMessaging(contacts) {
    const store = new Map(contacts.map((c) => [c.id, c]));
    return {
        store,
        listContacts: () => Promise.resolve([...store.values()]),
        saveContact: vi.fn(({ record, input }) => {
            const rec = record || { ...input, id: `new-${store.size}`, createdAt: '2026-09-01T00:00:00.000Z' };
            store.set(rec.id, rec);
            return Promise.resolve(rec);
        }),
        deleteContact: vi.fn(({ id }) => { store.delete(id); return Promise.resolve(); }),
    };
}

function mount(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ContactsList walletId="w1" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

const rowNames = () => within(screen.getByRole('list', { name: 'Contacts' }))
    .getAllByRole('listitem').map((r) => r.textContent.trim());

describe('ContactsList for one person with many addresses', () => {
    it('lists contacts A to Z whatever order the vault returns', async () => {
        mount(makeMessaging([
            contact('1', 'zed', '2026-01-03T00:00:00.000Z', [BTC]),
            contact('2', 'Alice', '2026-01-01T00:00:00.000Z', [LTC]),
            contact('3', 'bob', '2026-01-02T00:00:00.000Z', [DOGE]),
        ]));
        await waitFor(() => expect(rowNames()).toEqual(['Alice', 'bob', 'zed']));
        fireEvent.change(screen.getByLabelText('Sort contacts'), { target: { value: 'newest' } });
        expect(rowNames()).toEqual(['zed', 'bob', 'Alice']);
    });

    it('saves a new address under a known name into that contact', async () => {
        const messaging = makeMessaging([contact('j', 'JDog', '2026-01-01T00:00:00.000Z', [LTC])]);
        mount(messaging, {
            scanPrefill: { address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', chainId: 'bitcoin-mainnet' },
            onScanPrefillConsumed: () => {},
        });
        await waitFor(() => expect(screen.getByText('New contact')).toBeTruthy());
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'jdog' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(screen.getByText('Added to JDog.')).toBeTruthy());
        const call = messaging.saveContact.mock.calls[0][0];
        expect(call.input).toBeUndefined();
        expect(call.record.id).toBe('j');
        expect(call.record.entries.map((e) => e.address))
            .toEqual(['ltc1qjdogltc', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq']);
        expect(messaging.store.size).toBe(1);
    });

    it('offers to merge same-name contacts and leaves one with every address', async () => {
        const messaging = makeMessaging([
            contact('a', 'JDog', '2026-01-01T00:00:00.000Z', [BTC]),
            contact('b', 'JDog', '2026-01-02T00:00:00.000Z', [LTC]),
            contact('c', 'JDog', '2026-01-03T00:00:00.000Z', [DOGE]),
            contact('d', 'Alice', '2026-01-04T00:00:00.000Z', [{ ...BTC, address: 'bc1qalice' }]),
        ]);
        mount(messaging);
        await waitFor(() => expect(screen.getByText(/3 contacts are named JDog\./)).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
        await waitFor(() => expect(rowNames()).toEqual(['Alice', 'JDog']));
        expect(messaging.store.get('a').entries).toEqual([BTC, LTC, DOGE]);
        expect(screen.queryByText(/contacts are named/)).toBeNull();
    });
});
