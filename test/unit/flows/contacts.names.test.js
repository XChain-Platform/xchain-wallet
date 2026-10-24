// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { saveContact } from '../../../packages/core/src/flows/contacts.js';
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
