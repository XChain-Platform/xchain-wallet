// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { findContactByAddress, listContacts, saveContact } from '../../../packages/core/src/flows/contacts.js';
import { cleanContactName } from '../../../packages/core/src/schemas/contact.js';
import { contactsFromCsv } from '../../../packages/core/src/shared/utils/contactsCsv.js';

function fakeVault() {
    const rows = new Map();
    return {
        rows,
        contacts: {
            list: vi.fn(async () => [...rows.values()]),
            put: vi.fn(async (item) => { rows.set(item.id, item); }),
            delete: vi.fn(async (id) => rows.delete(id)),
        },
    };
}

const input = (name, address) => ({ name, entries: [{ chain: 'bitcoin', address, label: '' }] });

describe('contact names hide nothing', () => {
    it('removes bidi overrides, zero-width and control characters', () => {
        expect(cleanContactName('‮suoicipsus')).toBe('suoicipsus');
        expect(cleanContactName('Erin​ Calloway‮')).toBe('Erin Calloway');
        expect(cleanContactName('a\nb\u0007\u0000c')).toBe('a b c');
        expect(cleanContactName('  ​  ')).toBe('');
    });

    it('stores the cleaned name', async () => {
        const vault = fakeVault();
        const rec = await saveContact({ vault, input: input('Erin​ Calloway‮', 'bc1qa') });
        expect(rec.name).toBe('Erin Calloway');
    });

    it('treats a zero-width variant as the same name', async () => {
        const vault = fakeVault();
        await saveContact({ vault, input: input('Erin Calloway', 'bc1qa') });
        await expect(saveContact({ vault, input: input('Erin​ Calloway', 'bc1qb') }))
            .rejects.toThrow('already exists');
    });

    it('rejects a name made only of invisible characters', async () => {
        const vault = fakeVault();
        await expect(saveContact({ vault, input: input('​‮', 'bc1qa') })).rejects.toThrow();
    });

    it('csv import reads the cleaned name', () => {
        const csv = 'name,chain,address\n"‮abc",bitcoin,bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq\n';
        const out = contactsFromCsv(csv);
        expect(out.records[0].record.name).toBe('abc');
    });
});

describe('contacts saved before name cleaning display safely', () => {
    const stored = {
        schemaVersion: 1,
        id: 'old-1',
        name: 'Erin​ Calloway‮',
        notes: '',
        entries: [{ chain: 'bitcoin', address: 'bc1qa', label: '' }],
        avatarSeed: 'bc1qa',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('listContacts returns the cleaned name and leaves the stored record alone', async () => {
        const vault = fakeVault();
        vault.rows.set(stored.id, stored);
        const rows = await listContacts({ vault });
        expect(rows[0].name).toBe('Erin Calloway');
        expect(vault.rows.get(stored.id).name).toBe('Erin​ Calloway‮');
        expect(vault.contacts.put).not.toHaveBeenCalled();
    });

    it('findContactByAddress returns the cleaned name', async () => {
        const vault = fakeVault();
        vault.rows.set(stored.id, stored);
        const found = await findContactByAddress({ vault, chain: 'bitcoin', address: 'bc1qa' });
        expect(found.name).toBe('Erin Calloway');
    });

    it('a new contact with the cleaned name collides with the old record', async () => {
        const vault = fakeVault();
        vault.rows.set(stored.id, stored);
        await expect(saveContact({ vault, input: input('Erin Calloway', 'bc1qb') }))
            .rejects.toThrow('A contact named "Erin Calloway" already exists.');
    });
});
