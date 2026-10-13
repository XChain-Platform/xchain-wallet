// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import { userEvent } from '../../helpers/userEvent.js';

const confirmFailure = vi.hoisted(() => ({ message: null }));
vi.mock('../../../packages/core/src/shared/hooks/useConfirmModal.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useConfirmModal() {
            const modal = actual.useConfirmModal();
            return {
                ...modal,
                confirm(options) {
                    if (!confirmFailure.message) return modal.confirm(options);
                    const message = confirmFailure.message;
                    confirmFailure.message = null;
                    return Promise.reject(new Error(message));
                },
            };
        },
    };
});

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LTC = 'ltc1qg82rffhs37lynnvf3tfxcuvtlhm0fwwpv3l5z6';
const AMBIGUOUS_TESTNET = base58check(sha256).encode(new Uint8Array([0x6f, ...new Uint8Array(20).fill(7)]));

function contact(id, name, address, createdAt, extra = {}) {
    return {
        schemaVersion: 1,
        id,
        name,
        notes: '',
        entries: [{ chain: address.startsWith('ltc') ? 'litecoin' : 'bitcoin', address, label: '' }],
        avatarSeed: address,
        createdAt,
        updatedAt: createdAt,
        ...extra,
    };
}

function makeMessaging(initial) {
    const store = new Map(initial.map((item) => [item.id, item]));
    return {
        store,
        listContacts: vi.fn(async () => [...store.values()]),
        saveContact: vi.fn(async ({ record, input }) => {
            const saved = record || contact(`new-${store.size}`, input.name, input.entries[0].address, '2026-10-01T00:00:00.000Z', input);
            store.set(saved.id, saved);
            return saved;
        }),
        deleteContact: vi.fn(async ({ id }) => { store.delete(id); }),
    };
}

function contactsTree(messaging, walletId = 'w1') {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <ContactsList walletId={walletId} onBack={() => {}} />
            </ToastHost>
        </MessagingProvider>
    );
}

function mount(messaging, walletId = 'w1') {
    return render(
        contactsTree(messaging, walletId),
    );
}

function listedNames() {
    return within(screen.getByRole('list', { name: 'Contacts' }))
        .getAllByRole('listitem')
        .map((row) => row.getAttribute('aria-label'));
}

afterEach(() => {
    cleanup();
    confirmFailure.message = null;
    globalThis.localStorage?.clear();
});

describe('ContactsList audited behavior', () => {
    it('edits a contact in visual tab order and saves from Enter only when valid', async () => {
        const user = userEvent.setup();
        const messaging = makeMessaging([
            contact('alice', 'Alice', BTC, '2026-01-01T00:00:00.000Z'),
        ]);
        mount(messaging);

        const row = await screen.findByRole('listitem', { name: 'Alice' });
        row.focus();
        await user.keyboard('{Enter}');
        const edit = screen.getByRole('button', { name: 'Edit' });
        edit.focus();
        await user.keyboard('{Enter}');

        const name = screen.getByLabelText('Name');
        name.focus();
        await user.tab();
        const notes = screen.getByLabelText('Notes');
        expect(document.activeElement).toBe(notes);
        await user.tab();
        expect(document.activeElement).toHaveAccessibleName('Save');

        fireEvent.change(name, { target: { value: '' } });
        name.focus();
        await user.keyboard('{Enter}');
        expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.');
        expect(messaging.saveContact).not.toHaveBeenCalled();

        fireEvent.change(name, { target: { value: 'Alice Keys' } });
        await user.keyboard('{Enter}');
        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledOnce());
        expect(messaging.saveContact.mock.calls[0][0].record.name).toBe('Alice Keys');
        expect(messaging.saveContact.mock.calls[0][0].expectedUpdatedAt)
            .toBe('2026-01-01T00:00:00.000Z');
    });

    it('leaves an empty contact form directly but confirms before discarding real input', async () => {
        mount(makeMessaging([]));
        const add = await screen.findByRole('button', { name: 'Add contact' });

        fireEvent.click(add);
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('heading', { name: 'Contacts' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByRole('dialog')).toHaveTextContent('Discard changes?');

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByRole('heading', { name: 'New contact' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard and leave' }));
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Contacts' })).toBeTruthy());
    });

    it('rejects an address that another contact already owns', async () => {
        const messaging = makeMessaging([
            contact('alice', 'Alice', BTC, '2026-01-01T00:00:00.000Z'),
        ]);
        mount(messaging);

        await screen.findByText('Alice');
        fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bob' } });
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: BTC } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('This address is already saved for Alice.')).toBeTruthy();
        expect(messaging.saveContact).not.toHaveBeenCalled();
    });

    it('rejects appending an address the book already contains', async () => {
        const messaging = makeMessaging([
            contact('alice', 'Alice', BTC, '2026-01-01T00:00:00.000Z'),
            contact('bob', 'Bob', LTC, '2026-01-02T00:00:00.000Z'),
        ]);
        mount(messaging);

        fireEvent.click(await screen.findByRole('listitem', { name: 'Bob' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: BTC } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText('This address is already saved for Alice.')).toBeTruthy();
        expect(messaging.saveContact).not.toHaveBeenCalled();
    });

    it('persists the selected sort and restores it on the next mount', async () => {
        const rows = [
            contact('old', 'Alice', BTC, '2026-01-01T00:00:00.000Z'),
            contact('new', 'Zed', LTC, '2026-02-01T00:00:00.000Z'),
        ];
        const first = mount(makeMessaging(rows));
        await waitFor(() => expect(listedNames()).toEqual(['Alice', 'Zed']));
        fireEvent.change(screen.getByLabelText('Sort contacts'), { target: { value: 'newest' } });
        expect(listedNames()).toEqual(['Zed', 'Alice']);
        first.unmount();

        mount(makeMessaging(rows));
        await waitFor(() => expect(screen.getByLabelText('Sort contacts').value).toBe('newest'));
        expect(listedNames()).toEqual(['Zed', 'Alice']);
    });

    it('keeps sort preferences separate for each wallet', async () => {
        const rows = [
            contact('old', 'Alice', BTC, '2026-01-01T00:00:00.000Z'),
            contact('new', 'Zed', LTC, '2026-02-01T00:00:00.000Z'),
        ];
        const first = mount(makeMessaging(rows), 'wallet-a');
        await screen.findByText('Alice');
        fireEvent.change(screen.getByLabelText('Sort contacts'), { target: { value: 'newest' } });
        first.unmount();

        mount(makeMessaging(rows), 'wallet-b');
        await waitFor(() => expect(screen.getByLabelText('Sort contacts').value).toBe('name'));
        expect(listedNames()).toEqual(['Alice', 'Zed']);
    });

    it('does not let a late contact read from the previous wallet replace the new list', async () => {
        let resolveOld;
        const oldRead = new Promise((resolve) => { resolveOld = resolve; });
        const messaging = makeMessaging([]);
        messaging.listContacts
            .mockImplementationOnce(() => oldRead)
            .mockResolvedValueOnce([contact('new', 'New wallet contact', LTC, '2026-02-01T00:00:00.000Z')]);
        const view = render(contactsTree(messaging, 'wallet-a'));

        view.rerender(contactsTree(messaging, 'wallet-b'));
        expect(await screen.findByText('New wallet contact')).toBeTruthy();

        resolveOld([contact('old', 'Old wallet contact', BTC, '2026-01-01T00:00:00.000Z')]);
        await Promise.resolve();
        expect(screen.queryByText('Old wallet contact')).toBeNull();
        expect(screen.getByText('New wallet contact')).toBeTruthy();
    });

    it('searches notes and address labels', async () => {
        const messaging = makeMessaging([
            contact('alice', 'Alice', BTC, '2026-01-01T00:00:00.000Z', { notes: 'Met at conference' }),
            contact('bob', 'Bob', LTC, '2026-01-02T00:00:00.000Z', {
                entries: [{ chain: 'litecoin', address: LTC, label: 'Treasury' }],
            }),
        ]);
        mount(messaging);
        await screen.findByText('Alice');

        fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'conference' } });
        expect(listedNames()).toEqual(['Alice']);
        fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'treasury' } });
        expect(listedNames()).toEqual(['Bob']);
    });

    it('stores an ambiguous valid address under the chain the user selects', async () => {
        const messaging = makeMessaging([]);
        mount(messaging);
        await screen.findByText('No contacts yet');

        fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Testnet friend' } });
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: AMBIGUOUS_TESTNET } });
        fireEvent.change(screen.getByLabelText('Network for this address'), { target: { value: 'litecoin' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledOnce());
        expect(messaging.saveContact.mock.calls[0][0].input.entries[0]).toMatchObject({
            chain: 'litecoin',
            address: AMBIGUOUS_TESTNET,
        });
    });

    it('restores a deleted contact from the Undo toast', async () => {
        const alice = contact('alice', 'Alice', BTC, '2026-01-01T00:00:00.000Z');
        const messaging = makeMessaging([alice]);
        mount(messaging);

        fireEvent.click(await screen.findByRole('listitem', { name: 'Alice' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete Alice from contacts?' });
        expect(within(dialog).getByText('Alice and all saved addresses will be removed. You can restore the contact with Undo.')).toBeTruthy();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete contact' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

        await waitFor(() => expect(messaging.store.get('alice')).toEqual(alice));
        expect(messaging.deleteContact).toHaveBeenCalledWith({
            id: 'alice',
            expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
        });
        expect(messaging.saveContact).toHaveBeenCalledWith({ record: alice, expectedUpdatedAt: null });
    });

    it('surfaces a rejected confirmation without leaking the event-handler promise', async () => {
        const messaging = makeMessaging([
            contact('alice', 'Alice', BTC, '2026-01-01T00:00:00.000Z'),
        ]);
        mount(messaging);

        fireEvent.click(await screen.findByRole('listitem', { name: 'Alice' }));
        confirmFailure.message = 'Confirmation failed.';
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Confirmation failed.');
        expect(messaging.deleteContact).not.toHaveBeenCalled();
    });
});
