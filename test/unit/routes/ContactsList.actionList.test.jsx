// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G101 and G102 on the contact detail view: Send, Message, Edit, Share and
// Delete are rows of the shared action list under an Actions | Addresses |
// Details toggle, Actions first and chosen; the addresses sit under Addresses. Each row
// still runs what its round button ran, and Delete is the red danger row.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BTC_2 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function contact(entries) {
    return {
        schemaVersion: 1,
        id: 'alice',
        name: 'Alice',
        notes: '',
        entries: entries.map((address) => ({ chain: 'bitcoin', address, label: '' })),
        avatarSeed: entries[0],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

async function openDetail(props = {}, entries = [BTC]) {
    const messaging = {
        listContacts: vi.fn(async () => [contact(entries)]),
        saveContact: vi.fn(async () => {}),
        deleteContact: vi.fn(async () => {}),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <ContactsList walletId="w1" onBack={() => {}} {...props} />
            </ToastHost>
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Alice' }));
    return messaging;
}

afterEach(() => cleanup());

describe('ContactsList contact detail action list', () => {
    it('opens on Actions, first and selected, with the actions as one action list', async () => {
        await openDetail({ onSend: vi.fn(), onSendMessage: vi.fn() });
        const tabs = within(screen.getByRole('tablist', { name: 'Contact sections' })).getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Addresses', 'Details']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        const panel = screen.getByRole('tabpanel');
        const list = within(panel).getByRole('list', { name: 'Contact actions' });
        expect(list.tagName).toBe('UL');
        const titles = within(list).getAllByRole('button').map((row) => row.textContent.match(/^(Send|Message|Edit|Share|Delete)/)?.[1]);
        expect(titles).toEqual(['Send', 'Message', 'Edit', 'Share', 'Delete']);
        // The addresses wait under their own Addresses tab.
        expect(screen.queryByRole('button', { name: /^Add address/ })).toBeNull();
        fireEvent.click(tabs[1]);
        expect(screen.getByRole('button', { name: /^Add address/ })).toBeTruthy();
    });

    it('draws Delete as the red danger row and the rest in the default tone', async () => {
        await openDetail({ onSend: vi.fn(), onSendMessage: vi.fn() });
        const remove = screen.getByRole('button', { name: /^Delete/ });
        expect(remove.getAttribute('data-tone')).toBe('danger');
        expect(screen.getByRole('button', { name: /^Edit/ }).getAttribute('data-tone')).toBe('default');
    });

    it('runs Send and Message straight to a one-address contact', async () => {
        const onSend = vi.fn();
        const onSendMessage = vi.fn();
        await openDetail({ onSend, onSendMessage });
        fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
        expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ address: BTC }));
        fireEvent.click(screen.getByRole('button', { name: /^Message/ }));
        expect(onSendMessage).toHaveBeenCalledWith(expect.objectContaining({ toAddress: BTC }));
    });

    it('opens the address picker from Send on a contact with several addresses', async () => {
        const onSend = vi.fn();
        await openDetail({ onSend, onSendMessage: vi.fn() }, [BTC, BTC_2]);
        const send = screen.getByRole('button', { name: /^Send/ });
        expect(send.getAttribute('aria-haspopup')).toBe('menu');
        fireEvent.click(send);
        expect(send.getAttribute('aria-expanded')).toBe('true');
        const menu = screen.getByRole('menu', { name: 'Choose an address' });
        fireEvent.click(within(menu).getAllByRole('menuitem')[1]);
        expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ address: BTC_2 }));
    });

    it('keeps Send and Message as dimmed rows when the shell wires neither', async () => {
        await openDetail();
        expect(screen.getByRole('button', { name: /^Send/ }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: /^Message/ }).getAttribute('aria-disabled')).toBe('true');
    });

    it('opens the edit form from Edit and the delete confirmation from Delete', async () => {
        await openDetail({ onSend: vi.fn() });
        fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
        expect(await screen.findByRole('dialog', { name: 'Delete Alice from contacts?' })).toBeTruthy();
        cleanup();
        await openDetail({ onSend: vi.fn() });
        fireEvent.click(screen.getByRole('button', { name: /^Edit/ }));
        expect(await screen.findByRole('button', { name: 'Update Contact' })).toBeTruthy();
    });
});
