// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The open conversation's header: a keyword filter over its messages and a
// four-item overflow menu (contact, copy, explorer, encryption details).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';
import { explorerPageUrl } from '../../../packages/core/src/shared/utils/explorerLinks.js';

const CHAIN = 'bitcoin-testnet';
const OWN = 'tb1qownaownaownaownaownaownaownaownaowna';
const PEER = 'tb1qstrangerstrangerstrangerstrangerstra';
const KEY = '02a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f901';

const MESSAGES = [
    { format: 2, method: 1, chainId: CHAIN, from: PEER, to: OWN, timestamp: 1788300100, text: 'Hello there', txid: 't1' },
    { format: 2, method: 1, chainId: CHAIN, from: OWN, to: PEER, timestamp: 1788300200, text: 'Lunch tomorrow?', txid: 't2' },
    { format: 2, method: 3, chainId: CHAIN, from: PEER, to: OWN, timestamp: 1788300300, text: null, txid: 't3' },
];

async function mount({ contacts = [], pubkey = KEY, onContact = vi.fn() } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'a1', address: OWN, source: 'hd', role: 'receive' }],
        }),
        listContacts: vi.fn().mockResolvedValue(contacts),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getMessagingInboxSweep: vi.fn().mockResolvedValue({ messages: MESSAGES, addresses: [], errors: [] }),
        getRecipientPubkey: vi.fn().mockResolvedValue(pubkey),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MessagingInbox, { walletId: 'w', onCompose() {}, onBack() {}, onContact }),
        ),
    );
    // The list previews the newest message, which is the locked one.
    fireEvent.click(await screen.findByText('🔒 Encrypted message'));
    await screen.findByText('Lunch tomorrow?');
    await screen.findByLabelText('Conversation menu');
    return { messaging, onContact };
}

function openMenu() {
    fireEvent.click(screen.getByLabelText('Conversation menu'));
    return screen.getByRole('menu', { name: 'Conversation actions' });
}

afterEach(() => cleanup());

describe('thread filter', () => {
    async function search(text) {
        fireEvent.click(screen.getByRole('button', { name: 'Filter messages' }));
        fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: text } });
    }

    it('narrows the thread and highlights the match', async () => {
        await mount();
        await search('LUNCH');
        const mark = document.querySelector('mark');
        expect(mark).not.toBeNull();
        expect(mark.textContent.toLowerCase()).toBe('lunch');
        expect(screen.queryByText('Hello there')).not.toBeInTheDocument();
    });

    it('shows the empty line when nothing matches, locked messages included', async () => {
        await mount();
        await search('zzz-no-hit');
        expect(screen.getByText('No messages match')).toBeInTheDocument();
        expect(document.querySelector('mark')).toBeNull();
    });
});

describe('thread menu', () => {
    it('has exactly the four items in order', async () => {
        await mount();
        const items = within(openMenu()).getAllByRole('menuitem').map((el) => el.textContent);
        // Menu rows are buttons, so their labels are Title Case (G50).
        expect(items).toEqual(['Add to Contacts', 'Copy Address', 'View in Explorer', 'Encryption Details']);
    });

    it('adds a contact when the address is unknown', async () => {
        const { onContact } = await mount();
        fireEvent.click(within(openMenu()).getByText('Add to Contacts'));
        expect(onContact).toHaveBeenCalledWith({ address: PEER, chainId: CHAIN, edit: false });
    });

    it('edits the contact when the address is already one', async () => {
        const { onContact } = await mount({
            contacts: [{ id: 'c1', name: 'Pat', entries: [{ chain: 'bitcoin', address: PEER }] }],
        });
        await waitFor(() => expect(screen.getByText('Pat')).toBeInTheDocument());
        fireEvent.click(within(openMenu()).getByText('Edit Contact'));
        expect(onContact).toHaveBeenCalledWith({ address: PEER, chainId: CHAIN, edit: true });
    });

    it('links to the explorer through the explorer-URL helper', async () => {
        await mount();
        // The label sits beside the external-link cue inside the link.
        const link = within(openMenu()).getByRole('menuitem', { name: 'View in Explorer' });
        expect(link.tagName).toBe('A');
        expect(link.getAttribute('href')).toBe(
            explorerPageUrl({ chainId: CHAIN, kind: 'address', value: PEER }),
        );
        expect(link.getAttribute('href')).toBeTruthy();
    });
});

describe('encryption sheet', () => {
    it('shows the encrypted state with the cut public key and a Copy button', async () => {
        const { messaging } = await mount();
        fireEvent.click(within(openMenu()).getByText('Encryption Details'));
        expect(await screen.findByText('End-to-end encrypted (ECIES)')).toBeInTheDocument();
        expect(messaging.getRecipientPubkey).toHaveBeenCalledWith({ chainId: CHAIN, address: PEER });
        expect(screen.getByText(`${KEY.slice(0, 12)}…${KEY.slice(-10)}`)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    });

    it('shows Not encrypted when no key is known', async () => {
        await mount({ pubkey: null });
        fireEvent.click(within(openMenu()).getByText('Encryption Details'));
        expect(await screen.findByText('Not encrypted')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    });
});
