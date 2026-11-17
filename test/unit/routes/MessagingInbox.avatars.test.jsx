// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Each conversation row starts with the counterparty's tile, the same one View
// Contact shows: the contact's initials in its seed-picked colour, or the look
// Edit Contact saved (colour, shape, image). An address with no contact shows
// the unknown-person mark. The open thread's header carries the same tile.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';
import { WALLET_TONES, walletIdentityTone } from '../../../packages/core/src/shared/components/WalletIdentity.jsx';

const CHAIN = 'bitcoin-testnet';
const OWN = 'tb1qownaownaownaownaownaownaownaownaowna';
const AARON = 'tb1qaaronaaronaaronaaronaaronaaronaaron';
const MARCUS = 'tb1qmarcusmarcusmarcusmarcusmarcusmarcus';
const ERIN = 'tb1qerinerinerinerinerinerinerinerinerin';
const STRANGER = 'tb1qstrangerstrangerstrangerstrangerstra';
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function contact(id, name, address, extra = {}) {
    return {
        schemaVersion: 1,
        id,
        name,
        notes: '',
        entries: [{ chain: 'bitcoin', address, label: '' }],
        avatarSeed: address,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        ...extra,
    };
}

const CONTACTS = [
    // Saved before looks existed: no look field at all.
    contact('c-aaron', 'Aaron Calloway', AARON),
    contact('c-marcus', 'Marcus Webb', MARCUS, { look: { colour: '#D93838', shape: 'rounded', image: null } }),
    contact('c-erin', 'Erin Shaw', ERIN, { look: { colour: '#1E90C7', shape: 'circle', image: IMAGE } }),
];

function message(from, txid, text, timestamp) {
    return { format: 2, method: 0, chainId: CHAIN, from, to: OWN, txid, text, timestamp };
}

function mount() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'a1', address: OWN, source: 'hd', role: 'receive' }],
        }),
        listContacts: vi.fn().mockResolvedValue(CONTACTS),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getMessagingInboxSweep: vi.fn().mockResolvedValue({
            messages: [
                message(AARON, 'tx-a', 'from aaron', 1788300400),
                message(MARCUS, 'tx-m', 'from marcus', 1788300300),
                message(ERIN, 'tx-e', 'from erin', 1788300200),
                message(STRANGER, 'tx-s', 'from a stranger', 1788300100),
            ],
            addresses: [],
            errors: [],
        }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MessagingInbox, { walletId: 'w', onCompose() {}, onBack() {} }),
        ),
    );
    return messaging;
}

/** The conversation row (its button) that shows `preview`. */
async function rowFor(preview) {
    const text = await screen.findByText(preview);
    return text.closest('button');
}

afterEach(() => cleanup());

describe('Messaging list avatars', () => {
    it('shows a contact with no saved look as its initials in the seed-picked colour', async () => {
        mount();
        const row = await rowFor('from aaron');
        const avatar = row.querySelector('[data-xc-avatar]');
        expect(avatar).not.toBeNull();
        expect(avatar.textContent).toBe('AC');
        expect(avatar.getAttribute('data-xc-avatar-context')).toBe('list');
        expect(avatar.style.getPropertyValue('--xc-avatar-tone')).toBe(WALLET_TONES[walletIdentityTone(AARON)]);
        // No shape wrapper: the default circle, exactly as before looks existed.
        expect(row.querySelector('[data-contact-shape]')).toBeNull();
        expect(avatar.querySelector('img')).toBeNull();
    });

    it('draws the saved custom colour and shape', async () => {
        mount();
        const row = await rowFor('from marcus');
        const avatar = row.querySelector('[data-xc-avatar]');
        expect(avatar.textContent).toBe('MW');
        expect(avatar.style.getPropertyValue('--xc-avatar-tone')).toBe('#D93838');
        const shape = row.querySelector('[data-contact-shape]');
        expect(shape.getAttribute('data-contact-shape')).toBe('rounded');
        expect(shape.style.getPropertyValue('--xc-avatar-shape')).toBe('24%');
    });

    it('draws the uploaded image in place of the initials', async () => {
        mount();
        const row = await rowFor('from erin');
        const avatar = row.querySelector('[data-xc-avatar]');
        const img = avatar.querySelector('img');
        expect(img).not.toBeNull();
        expect(img.getAttribute('src')).toBe(IMAGE);
        expect(avatar.textContent).toBe('');
    });

    it('shows the unknown-person mark for an address with no contact', async () => {
        mount();
        const row = await rowFor('from a stranger');
        expect(row.querySelector('[data-xc-avatar]')).toBeNull();
        const mark = row.querySelector('[data-unknown-avatar]');
        expect(mark).not.toBeNull();
        expect(mark.getAttribute('aria-hidden')).toBe('true');
        expect(mark.querySelector('svg')).not.toBeNull();
    });

    it('puts the tile first in the row, before the name, and keeps the row name readable', async () => {
        mount();
        const row = await rowFor('from aaron');
        const rowLayout = row.querySelector('[data-xc-avatar]').parentElement;
        expect(rowLayout.firstElementChild).toBe(row.querySelector('[data-xc-avatar]'));
        // The tile is decoration: the row still reads as the name and preview.
        expect(within(row).getByText('Aaron Calloway')).toBeInTheDocument();
        expect(row.querySelector('[data-xc-avatar]').getAttribute('aria-hidden')).toBe('true');
    });

    it('shows the contact tile beside the name in the thread header', async () => {
        mount();
        fireEvent.click(await rowFor('from marcus'));
        const heading = await screen.findByRole('heading', { level: 1, name: 'Marcus Webb' });
        const avatar = heading.querySelector('[data-xc-avatar]');
        expect(avatar).not.toBeNull();
        expect(avatar.getAttribute('data-xc-avatar-context')).toBe('header');
        expect(avatar.style.getPropertyValue('--xc-avatar-tone')).toBe('#D93838');
    });

    it('shows the unknown-person mark in the header of a thread with no contact', async () => {
        mount();
        fireEvent.click(await rowFor('from a stranger'));
        const heading = await screen.findByRole('heading', { level: 1 });
        expect(heading.querySelector('[data-unknown-avatar]')).not.toBeNull();
        expect(heading.querySelector('[data-xc-avatar]')).toBeNull();
    });
});
