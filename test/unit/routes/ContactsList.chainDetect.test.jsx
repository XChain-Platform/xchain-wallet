// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A Dogecoin testnet contact (version byte 0x71, printed with the same
// leading 'n' as Bitcoin testnet) showed a question-mark badge and vanished
// under the Dogecoin network filter, because the entry's chain was detected
// from the first character and saved as 'unknown'. The list must draw the
// Dogecoin icon for such an entry, including one ALREADY stored as
// 'unknown' by the old detector, with no migration.

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';

const HASH160 = new Uint8Array(20).fill(9);
const DOGE_TESTNET = base58check(sha256).encode(new Uint8Array([0x71, ...HASH160]));
const BTC_OR_LTC_TESTNET = base58check(sha256).encode(new Uint8Array([0x6f, ...HASH160]));

function messagingWith(contacts) {
    return {
        listContacts: () => Promise.resolve(contacts),
        saveContact: () => Promise.resolve(),
        deleteContact: () => Promise.resolve(),
    };
}

function renderList(contacts) {
    return render(
        <MessagingProvider shell="web" messaging={messagingWith(contacts)}>
            <ContactsList walletId="w1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('ContactsList network badges', () => {
    it('draws the Dogecoin icon for a Dogecoin testnet entry stored as unknown', async () => {
        expect(DOGE_TESTNET[0]).toBe('n');
        renderList([{
            id: 'c1', name: 'Shibe', notes: '',
            entries: [{ chain: 'unknown', address: DOGE_TESTNET, label: '' }],
        }]);
        await waitFor(() => expect(screen.getByText('Shibe')).toBeTruthy());
        expect(screen.getByAltText('Dogecoin')).toBeTruthy();
        expect(screen.queryByLabelText('Unknown network')).toBeNull();
    });

    it('keeps the question mark only for an address whose bytes really are shared', async () => {
        renderList([{
            id: 'c2', name: 'Ambiguous', notes: '',
            entries: [{ chain: 'unknown', address: BTC_OR_LTC_TESTNET, label: '' }],
        }]);
        await waitFor(() => expect(screen.getByText('Ambiguous')).toBeTruthy());
        expect(screen.getByLabelText('Unknown network')).toBeTruthy();
    });

    it('trusts a stored chain over re-detection', async () => {
        renderList([{
            id: 'c3', name: 'Chosen', notes: '',
            entries: [{ chain: 'litecoin', address: BTC_OR_LTC_TESTNET, label: '' }],
        }]);
        await waitFor(() => expect(screen.getByText('Chosen')).toBeTruthy());
        expect(screen.getByAltText('Litecoin')).toBeTruthy();
    });
});
