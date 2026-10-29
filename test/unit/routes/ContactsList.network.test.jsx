// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Contact network replies stay ordered, duplicate submissions stay single,
// and conflict retries carry the version the screen reloads.

import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';

const CONFLICT = 'Contact changed since this screen loaded. Reopen it and try again.';
const OLD_VERSION = '2026-10-01T00:00:00.000Z';
const NEW_VERSION = '2026-10-02T00:00:00.000Z';
const ADDRESS_A = base58check(sha256).encode(new Uint8Array([0x00, ...new Uint8Array(20).fill(3)]));
const ADDRESS_B = base58check(sha256).encode(new Uint8Array([0x00, ...new Uint8Array(20).fill(5)]));

function contactAt(updatedAt) {
    return {
        id: 'c1',
        name: 'Alice',
        notes: '',
        updatedAt,
        entries: [{ chain: 'bitcoin', address: ADDRESS_A, label: '' }],
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

function contactsTree(messaging) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <ContactsList walletId="w1" onBack={() => {}} />
        </MessagingProvider>
    );
}

function conflictMessaging() {
    let current = contactAt(OLD_VERSION);
    const saveContact = vi.fn(async ({ expectedUpdatedAt }) => {
        if (saveContact.mock.calls.length === 1) {
            // Another device saves the contact between load and submit.
            current = contactAt(NEW_VERSION);
            throw new Error(CONFLICT);
        }
        if (expectedUpdatedAt !== current.updatedAt) throw new Error(CONFLICT);
    });
    return {
        listContacts: vi.fn(async () => [current]),
        saveContact,
        deleteContact: vi.fn(async () => {}),
    };
}

async function openDetail(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ContactsList walletId="w1" onBack={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Alice' }));
    await screen.findByRole('group', { name: 'Contact actions' });
}

describe('ContactsList version conflict retry', () => {
    it('lets the user save an edit again after a version conflict, as the message says', async () => {
        const messaging = conflictMessaging();
        await openDetail(messaging);
        fireEvent.click(within(screen.getByRole('group', { name: 'Contact actions' })).getByRole('button', { name: 'Edit' }));
        fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Alice B' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText(CONFLICT)).toBeTruthy();
        expect(messaging.saveContact.mock.calls[0][0].expectedUpdatedAt).toBe(OLD_VERSION);

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledTimes(2));
        expect(messaging.saveContact.mock.calls[1][0].expectedUpdatedAt).toBe(NEW_VERSION);
        expect(messaging.saveContact.mock.calls[1][0].record.name).toBe('Alice B');
        await screen.findByRole('group', { name: 'Contact actions' });
        expect(screen.queryByText(CONFLICT)).toBeNull();
    });

    it('lets the user add an address again after a version conflict', async () => {
        const messaging = conflictMessaging();
        await openDetail(messaging);
        fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText('Address'), { target: { value: ADDRESS_B } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
        expect(await within(dialog).findByText(CONFLICT)).toBeTruthy();
        expect(messaging.saveContact.mock.calls[0][0].expectedUpdatedAt).toBe(OLD_VERSION);

        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));
        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledTimes(2));
        expect(messaging.saveContact.mock.calls[1][0].expectedUpdatedAt).toBe(NEW_VERSION);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
});

describe('ContactsList response ordering', () => {
    it('keeps the newer same-wallet list when an older request answers late', async () => {
        const oldRead = deferred();
        const first = {
            listContacts: vi.fn(() => oldRead.promise),
            saveContact: vi.fn(),
            deleteContact: vi.fn(),
        };
        const second = {
            listContacts: vi.fn(async () => [{ ...contactAt(NEW_VERSION), name: 'New head' }]),
            saveContact: vi.fn(),
            deleteContact: vi.fn(),
        };
        const view = render(contactsTree(first));

        view.rerender(contactsTree(second));
        expect(await screen.findByRole('button', { name: 'New head' })).toBeTruthy();
        await act(async () => {
            oldRead.resolve([{ ...contactAt(OLD_VERSION), name: 'Old head' }]);
            await oldRead.promise;
        });

        expect(screen.queryByRole('button', { name: 'Old head' })).toBeNull();
        expect(screen.getByRole('button', { name: 'New head' })).toBeTruthy();
    });

    it('keeps the newer publish count when an older request answers late', async () => {
        const oldStatus = deferred();
        const messaging = {
            listContacts: vi.fn()
                .mockResolvedValueOnce([contactAt(OLD_VERSION)])
                .mockResolvedValueOnce([contactAt(NEW_VERSION)]),
            saveContact: vi.fn(async () => {}),
            deleteContact: vi.fn(async () => {}),
            labelSyncStatusRequest: vi.fn()
                .mockImplementationOnce(() => oldStatus.promise)
                .mockResolvedValueOnce({ pending: true, changeCount: 2 }),
        };
        render(contactsTree(messaging));
        fireEvent.click(await screen.findByRole('button', { name: 'Alice' }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice current' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await screen.findByRole('heading', { name: 'View Contact' });
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        const nudge = await waitFor(() => {
            const element = document.getElementById('contacts-publish-nudge');
            expect(element).toHaveTextContent('2 contact changes are only on this device.');
            return element;
        });
        await act(async () => {
            oldStatus.resolve({ pending: true, changeCount: 9 });
            await oldStatus.promise;
        });

        expect(nudge).not.toHaveTextContent('9 contact changes are only on this device.');
        expect(nudge).toHaveTextContent('2 contact changes are only on this device.');
    });
});

describe('ContactsList duplicate submission', () => {
    it('sends one save when two submit events land in the same task', async () => {
        const saveDone = deferred();
        const messaging = {
            listContacts: vi.fn(async () => []),
            saveContact: vi.fn(() => saveDone.promise),
            deleteContact: vi.fn(async () => {}),
        };
        render(contactsTree(messaging));
        fireEvent.click(await screen.findByRole('button', { name: 'Create first contact' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } });
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: ADDRESS_A } });
        const form = screen.getByRole('button', { name: 'Save' }).closest('form');

        act(() => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });

        expect(messaging.saveContact).toHaveBeenCalledTimes(1);
        await act(async () => {
            saveDone.resolve();
            await saveDone.promise;
        });
        await screen.findByText('No contacts yet');
    });
});
