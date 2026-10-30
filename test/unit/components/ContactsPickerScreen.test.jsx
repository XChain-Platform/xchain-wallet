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
import { userEvent } from '../../helpers/userEvent.js';

vi.mock('@xchain-wallet/core/ui', () => ({
    Screen: ({ header, children }) => <div>{header}<main>{children}</main></div>,
    PageHeader: ({ title, onBack }) => (
        <header>
            <button type="button" onClick={onBack} aria-label="Back">Back</button>
            <h1>{title}</h1>
        </header>
    ),
    ListPage: ({ toolbar, children }) => <section data-testid="list-page">{toolbar}{children}</section>,
    EmptyState: ({ title, body, role, titleAs: Title = 'h2' }) => (
        <div data-testid="empty-state" role={role}><Title>{title}</Title>{body ? <p>{body}</p> : null}</div>
    ),
    ListRow: ({ title, subtitle, onClick, ...props }) => (
        <button type="button" onClick={onClick} {...props}>{title}{subtitle}</button>
    ),
    Input: ({ size, ...props }) => <input data-size={size} {...props} />,
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

describe('ContactsPickerScreen empty and listing states', () => {
    it.each([
        ['no contacts', []],
        ['contacts without addresses', [{ id: 'empty', name: 'Empty', entries: [{ label: 'Home' }] }]],
    ])('shows the empty state for %s', (_label, emptyContacts) => {
        mount({ contacts: emptyContacts });

        expect(screen.getByText('No contacts yet')).toBeInTheDocument();
        expect(screen.getByText('Saved contacts with addresses appear here.')).toBeInTheDocument();
        expect(screen.getByTestId('list-page')).toContainElement(screen.getByTestId('empty-state'));
        expect(screen.getByTestId('empty-state')).not.toHaveAttribute('role');
        expect(screen.queryByRole('searchbox', { name: 'Search contacts' })).toBeNull();
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

    it('uses distinct row keys when a contact repeats an address', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mount({
            contacts: [{
                id: 'alice',
                name: 'Alice',
                entries: [bitcoinEntry, { ...bitcoinEntry, label: 'Spending' }],
            }],
        });

        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key');
    });

    it('renders contact names containing markup as text in the list', () => {
        const name = '<img src=x onerror="globalThis.contactExecuted = true">';
        const { container } = mount({
            contacts: [{ id: 'markup', name, entries: [bitcoinEntry] }],
        });

        expect(screen.getByText(name)).toBeInTheDocument();
        expect(container.querySelector('img')).toBeNull();
        expect(globalThis.contactExecuted).toBeUndefined();
    });

    it('neutralizes directional and zero-width controls in contact names', () => {
        const hostileName = 'Alice\u202Etxt.exe\u200B';
        mount({
            contacts: [{ id: 'hostile', name: hostileName, entries: [bitcoinEntry] }],
        });

        expect(screen.queryByText(hostileName)).toBeNull();
        expect(screen.getByText('Alice\u2426txt.exe')).toBeInTheDocument();
        expect(screen.getByText('bc1-alice')).toBeInTheDocument();
    });

    it('ignores a malformed stored contact while keeping valid rows usable', () => {
        const { props } = mount({
            contacts: [{ id: 'broken', name: 'Broken', entries: {} }, ...contacts],
        });

        fireEvent.click(screen.getByRole('button', { name: /Alice.*bc1-alice/ }));
        expect(props.onPick).toHaveBeenCalledWith(bitcoinEntry);
    });
});

describe('ContactsPickerScreen filters', () => {
    it.each([
        ['contact name', 'ALICE', 'bc1-alice'],
        ['address', 'd-BOB', 'D-bob'],
        ['entry label', 'vAuLt', 'bc1-alice'],
    ])('filters case-insensitively by %s', (_field, query, expectedAddress) => {
        mount();

        const search = screen.getByRole('searchbox', { name: 'Search contacts' });
        expect(search).toHaveAttribute('data-size', 'md');
        fireEvent.change(search, {
            target: { value: query },
        });
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveTextContent(expectedAddress);
    });

    it('shows feedback when search matches no addresses', () => {
        mount();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search contacts' }), {
            target: { value: 'not saved' },
        });

        expect(screen.getByText('No matching addresses')).toBeInTheDocument();
        expect(screen.getByText('Try a different search or network filter.')).toBeInTheDocument();
        expect(screen.getByTestId('list-page')).toContainElement(screen.getByTestId('empty-state'));
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
});

describe('ContactsPickerScreen selection and header', () => {
    it('passes the exact selected entry to onPick through native keyboard activation', async () => {
        const { props } = mount();
        const user = userEvent.setup();
        const row = screen.getByRole('button', { name: /Alice.*bc1-alice/ });

        row.focus();
        await user.keyboard('{Enter}');
        expect(props.onPick).toHaveBeenCalledOnce();
        expect(props.onPick.mock.calls[0]).toHaveLength(1);
        expect(props.onPick.mock.calls[0][0]).toBe(bitcoinEntry);
    });

    it('cancels without selecting an entry when Back is pressed', () => {
        const { props } = mount();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(props.onBack).toHaveBeenCalledOnce();
        expect(props.onPick).not.toHaveBeenCalled();
    });

    it('shows the Contacts header title', () => {
        mount();

        expect(within(screen.getByRole('banner')).getByText('Contacts')).toBeInTheDocument();
    });
});
