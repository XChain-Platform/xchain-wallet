// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Edit Contact edits the contact's look with Edit Wallet's own fields
// (TileLookFields: colour, shape, image), beside the name. The look is saved
// on the contact record as { colour, image, shape }, every contact tile reads
// it back after a reload, and a contact saved before looks existed keeps its
// default (initials, the colour picked from its seed, a circle) until its look
// is changed, even when its name is saved.
// jsdom has no image decoder or canvas, so the 64x64 scale is stubbed.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import { WALLET_TONES, walletIdentityTone } from '../../../packages/core/src/shared/components/WalletIdentity.jsx';
import { validateContact } from '../../../packages/core/src/schemas/contact.js';
import { listContacts } from '../../../packages/core/src/flows/contacts.js';
import { readContactLook } from '../../../packages/core/src/shared/utils/contactLook.js';

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LTC = 'ltc1qg82rffhs37lynnvf3tfxcuvtlhm0fwwpv3l5z6';

function contact(id, name, address, extra = {}) {
    return {
        schemaVersion: 1,
        id,
        name,
        notes: '',
        entries: [{ chain: address.startsWith('ltc') ? 'litecoin' : 'bitcoin', address, label: '' }],
        avatarSeed: address,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        ...extra,
    };
}

// A store that keeps what saveContact writes, so a remount is a reload.
function makeMessaging(initial) {
    const store = new Map(initial.map((item) => [item.id, item]));
    return {
        store,
        listContacts: vi.fn(async () => [...store.values()]),
        saveContact: vi.fn(async ({ record }) => {
            const saved = { ...record, updatedAt: '2026-11-02T00:00:00.000Z' };
            store.set(saved.id, saved);
            return saved;
        }),
        deleteContact: vi.fn(async ({ id }) => { store.delete(id); }),
    };
}

function mount(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <ContactsList walletId="w1" onBack={() => {}} />
            </ToastHost>
        </MessagingProvider>,
    );
}

async function openEdit(name) {
    fireEvent.click(await screen.findByRole('button', { name }));
    fireEvent.click(screen.getByRole('button', { name: /^Edit/ }));
    await screen.findByRole('button', { name: 'Update Contact' });
}

function rowAvatar(name) {
    return within(screen.getByRole('list', { name: 'Contacts' }))
        .getByRole('button', { name })
        .querySelector('[data-xc-avatar]');
}

// The stubbed canvas returns a data URL naming the last drawn file.
let lastObjectUrl = '';
const scaledFor = (name) => `data:image/png;base64,${btoa(`scaled:${name}`)}`;

class FakeImage {
    constructor() { this.onload = null; this.onerror = null; this.naturalWidth = 0; this.naturalHeight = 0; }
    set src(url) {
        this._src = url;
        this.naturalWidth = 200; this.naturalHeight = 100;
        setTimeout(() => this.onload?.(), 0);
    }
    get src() { return this._src; }
}

beforeEach(() => {
    vi.stubGlobal('Image', FakeImage);
    URL.createObjectURL = vi.fn((file) => { lastObjectUrl = `blob:${file.name}`; return lastObjectUrl; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => scaledFor(lastObjectUrl.slice(5)));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    globalThis.localStorage?.clear();
});

describe('Edit Contact look', () => {
    it('puts the shared look fields with the name on the Edit form', async () => {
        mount(makeMessaging([contact('c1', 'Aaron Calloway', BTC)]));
        await openEdit('Aaron Calloway');
        expect(screen.getByLabelText('Name')).toHaveValue('Aaron Calloway');
        expect(screen.getByRole('radiogroup', { name: 'Icon colour' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Icon shape: Circle/ })).toBeInTheDocument();
        expect(screen.getByLabelText('Icon image file')).toBeInTheDocument();
        const update = screen.getByRole('button', { name: 'Update Contact' });
        expect(update.className).toMatch(/success/);
        expect(update.querySelector('svg')).not.toBeNull();
        // The current tile sits on top, as on Edit Wallet.
        expect(document.querySelector('[data-contact-look-preview] [data-xc-avatar]').textContent).toBe('AC');
    });

    it('saves a picked colour and shape on the record, and shows them after a reload', async () => {
        const messaging = makeMessaging([contact('c1', 'Marcus Webb', BTC)]);
        const view = mount(messaging);
        await openEdit('Marcus Webb');

        fireEvent.click(screen.getByRole('radio', { name: 'Colour #2E7D32' }));
        fireEvent.click(screen.getByRole('button', { name: /Icon shape: Circle/ }));
        fireEvent.click(screen.getByRole('option', { name: /Rounded square/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Update Contact' }));

        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledOnce());
        const saved = messaging.saveContact.mock.calls[0][0].record;
        expect(saved.look).toEqual({ colour: '#2E7D32', image: null, shape: 'rounded' });
        expect(validateContact(saved).ok).toBe(true);

        // Reload: a fresh mount reads the stored record.
        view.unmount();
        mount(messaging);
        const avatar = await waitFor(() => rowAvatar('Marcus Webb'));
        expect(avatar.textContent).toBe('MW');
        expect(avatar.style.getPropertyValue('--xc-avatar-tone')).toBe('#2E7D32');
        expect(avatar.closest('[data-contact-shape]').getAttribute('data-contact-shape')).toBe('rounded');

        // View Contact and its Edit form read the same stored look.
        await openEdit('Marcus Webb');
        expect(screen.getByRole('radio', { name: 'Colour #2E7D32' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('button', { name: /Icon shape: Rounded square/ })).toBeInTheDocument();
    });

    it('saves an uploaded image and draws it in place of the initials after a reload', async () => {
        const messaging = makeMessaging([contact('c1', 'Erin Shaw', BTC)]);
        const view = mount(messaging);
        await openEdit('Erin Shaw');

        const png = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], 'erin.png', { type: 'image/png' });
        fireEvent.change(screen.getByLabelText('Icon image file'), { target: { files: [png] } });
        await waitFor(() => expect(document.querySelector('[data-contact-look-preview] img')).not.toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Update Contact' }));

        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledOnce());
        const saved = messaging.saveContact.mock.calls[0][0].record;
        expect(saved.look.image).toBe(scaledFor('erin.png'));
        expect(validateContact(saved).ok).toBe(true);

        view.unmount();
        mount(messaging);
        const avatar = await waitFor(() => rowAvatar('Erin Shaw'));
        expect(avatar.querySelector('img').getAttribute('src')).toBe(scaledFor('erin.png'));
    });

    it('keeps a contact with no look on the default: initials, seed colour, circle', async () => {
        const messaging = makeMessaging([contact('c1', 'Aaron Calloway', BTC), contact('c2', 'Marcus Webb', LTC)]);
        mount(messaging);
        // The default is what View Contact always drew: the initials in the
        // seed-picked tone, no shape override.
        const avatar = await waitFor(() => rowAvatar('Aaron Calloway'));
        expect(avatar.textContent).toBe('AC');
        expect(avatar.style.getPropertyValue('--xc-avatar-tone')).toBe(WALLET_TONES[walletIdentityTone(BTC)]);
        expect(avatar.closest('[data-contact-shape]')).toBeNull();
        expect(readContactLook(messaging.store.get('c1'))).toEqual({ colour: null, shape: null, image: null });

        // Renaming without touching the look writes no look: the contact
        // keeps the default rather than taking the first swatch.
        await openEdit('Aaron Calloway');
        expect(screen.getAllByRole('radio').some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Aaron C' } });
        fireEvent.click(screen.getByRole('button', { name: 'Update Contact' }));
        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledOnce());
        const saved = messaging.saveContact.mock.calls[0][0].record;
        expect(saved.name).toBe('Aaron C');
        expect('look' in saved).toBe(false);
        expect(validateContact(saved).ok).toBe(true);
    });

    it('marks the form changed when only the look changes', async () => {
        mount(makeMessaging([contact('c1', 'Aaron Calloway', BTC)]));
        await openEdit('Aaron Calloway');
        fireEvent.click(screen.getByRole('radio', { name: 'Colour #D93838' }));
        // Back with an unsaved look asks before leaving (the form's leave guard).
        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
});

describe('contact look on the record', () => {
    const base = contact('c1', 'Aaron Calloway', BTC);

    it('accepts no look and the wallet tile look shape', () => {
        expect(validateContact(base).ok).toBe(true);
        expect(validateContact({ ...base, look: { colour: '#7B2C8F', shape: 'circle', image: null } }).ok).toBe(true);
        expect(validateContact({ ...base, look: { colour: null, shape: 'rounded', image: scaledFor('a.png') } }).ok).toBe(true);
    });

    it('refuses a remote image, an unknown shape, a non-hex colour and extra keys', () => {
        expect(validateContact({ ...base, look: { image: 'https://example.com/a.png' } }).ok).toBe(false);
        expect(validateContact({ ...base, look: { shape: 'hexagon' } }).ok).toBe(false);
        expect(validateContact({ ...base, look: { colour: 'red; background:url(x)' } }).ok).toBe(false);
        expect(validateContact({ ...base, look: { colour: '#7B2C8F', icon: 'star' } }).ok).toBe(false);
        expect(validateContact({ ...base, look: 'circle' }).ok).toBe(false);
    });

    it('keeps a contact whose stored look is damaged, reading it with the default look', async () => {
        const good = { ...base, look: { colour: '#2E7D32', shape: 'rounded', image: null } };
        const damaged = { ...contact('c2', 'Marcus Webb', LTC), look: { image: 'https://example.com/a.png' } };
        const vault = { contacts: { list: async () => [good, damaged] } };
        const rows = await listContacts({ vault });
        expect(rows.map((r) => r.name)).toEqual(['Aaron Calloway', 'Marcus Webb']);
        expect(rows[0].look).toEqual(good.look);
        expect('look' in rows[1]).toBe(false);
    });
});
