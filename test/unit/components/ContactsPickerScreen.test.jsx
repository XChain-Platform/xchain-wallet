// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@xchain-wallet/core/ui', () => ({
    Screen: ({ header, children }) => <div>{header}<main>{children}</main></div>,
    PageHeader: ({ title }) => <header><h1>{title}</h1></header>,
    Icon: { UsersIcon: () => <span /> },
}));

vi.mock('../../../packages/core/src/shared/components/NetworkFilterDropdown.jsx', () => ({
    NetworkFilterDropdown: ({ value, onChange }) => (
        <select aria-label="network" value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="all">All networks</option>
            <option value="bitcoin">Bitcoin</option>
            <option value="dogecoin">Dogecoin</option>
        </select>
    ),
}));

vi.mock('../../../packages/core/src/shared/utils/contactChain.js', () => ({
    contactEntryChain: (entry) => entry?.chain,
}));

import { ContactsPickerScreen } from '../../../packages/core/src/shared/components/ContactsPickerScreen.jsx';

const bitcoinEntry = { address: 'bc1-alice', chain: 'bitcoin', label: 'Vault' };
const dogecoinEntry = { address: 'D-bob', chain: 'dogecoin', label: 'Tips' };
const contacts = [
    { id: 'bob', name: 'bob', entries: [dogecoinEntry] },
    { id: 'alice', name: 'Alice', entries: [bitcoinEntry] },
];

function mount(overrides = {}) {
    const props = {
        contacts,
        variant: 'full',
        onPick: vi.fn(),
        onBack: vi.fn(),
        ...overrides,
    };
    return { ...render(<ContactsPickerScreen {...props} />), props };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

afterAll(() => {
    vi.doUnmock('@xchain-wallet/core/ui');
    vi.doUnmock('../../../packages/core/src/shared/components/NetworkFilterDropdown.jsx');
    vi.doUnmock('../../../packages/core/src/shared/utils/contactChain.js');
});

describe('ContactsPickerScreen', () => {
    it.each([
        ['no contacts', []],
        ['contacts without addresses', [{ id: 'empty', name: 'Empty', entries: [{ label: 'Home' }] }]],
    ])('shows the empty state for %s', (_label, emptyContacts) => {
        mount({ contacts: emptyContacts });

        expect(screen.getByText('You have no contacts yet')).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Search contacts' })).toBeNull();
    });

    it('lists every saved address in case-insensitive contact-name order', () => {
        const secondAliceEntry = { address: 'bc1-alice-two', chain: 'bitcoin' };
        mount({
            contacts: [
                contacts[0],
                { ...contacts[1], entries: [bitcoinEntry, secondAliceEntry, { label: 'Missing' }] },
            ],
        });

        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(3);
        expect(rows.map((row) => row.textContent)).toEqual([
            'Alicebc1-alice',
            'Alicebc1-alice-two',
            'bobD-bob',
        ]);
    });

    it.each([
        ['contact name', 'ALICE', 'bc1-alice'],
        ['address', 'd-BOB', 'D-bob'],
        ['entry label', 'vAuLt', 'bc1-alice'],
    ])('filters case-insensitively by %s', (_field, query, expectedAddress) => {
        mount();

        fireEvent.change(screen.getByRole('textbox', { name: 'Search contacts' }), {
            target: { value: query },
        });
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveTextContent(expectedAddress);
    });

    it('shows feedback when search matches no addresses', () => {
        mount();
        fireEvent.change(screen.getByRole('textbox', { name: 'Search contacts' }), {
            target: { value: 'not saved' },
        });

        expect(screen.getByText('No addresses match your filters.')).toBeInTheDocument();
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });

    it('filters entries by the selected network', () => {
        mount();
        fireEvent.change(screen.getByRole('combobox', { name: 'network' }), {
            target: { value: 'dogecoin' },
        });

        expect(screen.getByText('D-bob')).toBeInTheDocument();
        expect(screen.queryByText('bc1-alice')).toBeNull();
    });

    it('passes the exact selected entry to onPick once', () => {
        const { props } = mount();
        const row = screen.getByText('bc1-alice').closest('button');

        fireEvent.click(row);
        expect(props.onPick).toHaveBeenCalledOnce();
        expect(props.onPick).toHaveBeenCalledWith(bitcoinEntry);
    });

    it('shows the Contacts header title', () => {
        mount();

        expect(within(screen.getByRole('banner')).getByText('Contacts')).toBeInTheDocument();
    });
});
