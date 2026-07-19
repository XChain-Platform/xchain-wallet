// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the scan-to-contacts flow must not open a blank new-contact form
// when the scanned address already belongs to a saved contact. It should
// route to that contact's detail view instead. Covers both the module-level
// matcher and the scanPrefill useEffect that consumes an AppHeader QR scan.

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList, findContactByAddress } from '../../../packages/core/src/shared/routes/ContactsList.jsx';

const CONTACT = {
    id: 'c1',
    name: 'Satoshi',
    notes: '',
    entries: [
        { chain: 'bitcoin', address: 'bc1qexampleaddressone', label: '' },
        { chain: 'dogecoin', address: 'DExampleDogeAddr', label: '' },
    ],
};

function makeMessaging() {
    return {
        listContacts: () => Promise.resolve([CONTACT]),
        saveContact: () => Promise.resolve(),
        deleteContact: () => Promise.resolve(),
    };
}

describe('findContactByAddress', () => {
    const contacts = [CONTACT];

    it('matches a saved address exactly', () => {
        expect(findContactByAddress(contacts, 'DExampleDogeAddr')).toBe(CONTACT);
    });

    it('matches case-insensitively and ignores surrounding whitespace', () => {
        expect(findContactByAddress(contacts, '  BC1QEXAMPLEADDRESSONE ')).toBe(CONTACT);
    });

    it('returns null for an unknown address', () => {
        expect(findContactByAddress(contacts, 'bc1qnotinanycontact')).toBeNull();
    });

    it('is null-safe for empty address or non-array contacts', () => {
        expect(findContactByAddress(contacts, '')).toBeNull();
        expect(findContactByAddress(null, 'bc1qexampleaddressone')).toBeNull();
    });
});

describe('ContactsList scan-to-contacts prefill', () => {
    it('opens the existing contact detail view when the scanned address is already saved', async () => {
        render(
            <MessagingProvider shell="web" messaging={makeMessaging()}>
                <ContactsList
                    walletId="w1"
                    onBack={() => {}}
                    scanPrefill={{ address: 'bc1qexampleaddressone', chainId: 'bitcoin-mainnet' }}
                    onScanPrefillConsumed={() => {}}
                />
            </MessagingProvider>,
        );

        // Detail view header + the contact's name confirm we did NOT open a
        // blank new-contact form.
        await waitFor(() => expect(screen.getByText('View Contact')).toBeTruthy());
        expect(screen.getByText('Satoshi')).toBeTruthy();
        expect(screen.queryByText('New contact')).toBeNull();
    });

    it('opens a new-contact edit form when the scanned address is not saved', async () => {
        render(
            <MessagingProvider shell="web" messaging={makeMessaging()}>
                <ContactsList
                    walletId="w1"
                    onBack={() => {}}
                    scanPrefill={{ address: 'bc1qbrandnewaddress', chainId: 'bitcoin-mainnet' }}
                    onScanPrefillConsumed={() => {}}
                />
            </MessagingProvider>,
        );

        await waitFor(() => expect(screen.getByText('New contact')).toBeTruthy());
        const addressInput = screen.getByLabelText('Address');
        expect(addressInput.value).toBe('bc1qbrandnewaddress');
    });
});
