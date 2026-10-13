// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { deleteContact, saveContact } from '../../../packages/core/src/flows/contacts.js';

function record(id, name, entries) {
    return {
        schemaVersion: 1,
        id,
        name,
        notes: '',
        entries,
        avatarSeed: entries[0].address,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

function fakeVault(initial) {
    const rows = new Map(initial.map((item) => [item.id, item]));
    return {
        rows,
        contacts: {
            list: vi.fn(async () => [...rows.values()]),
            put: vi.fn(async (item) => { rows.set(item.id, item); }),
            delete: vi.fn(async (id) => rows.delete(id)),
        },
    };
}

const ENTRY = { chain: 'bitcoin', address: 'bc1qduplicate', label: '' };

describe('saveContact address uniqueness', () => {
    it('rejects duplicate addresses inside one imported record', async () => {
        const vault = fakeVault([]);
        const imported = record('imported', 'Imported', [
            ENTRY,
            { ...ENTRY, address: '  BC1QDUPLICATE  ' },
        ]);

        await expect(saveContact({ vault, record: imported }))
            .rejects.toThrow('address appears more than once');
        expect(vault.contacts.put).not.toHaveBeenCalled();
    });

    it('rejects an address owned by another contact but permits updating its owner', async () => {
        const alice = record('alice', 'Alice', [ENTRY]);
        const vault = fakeVault([alice]);
        const duplicate = record('bob', 'Bob', [{ ...ENTRY, address: 'BC1QDUPLICATE' }]);

        await expect(saveContact({ vault, record: duplicate }))
            .rejects.toThrow('address already belongs to Alice');
        await expect(saveContact({ vault, record: { ...alice, notes: 'Friend' } }))
            .resolves.toMatchObject({ id: 'alice', notes: 'Friend' });
        expect(vault.contacts.put).toHaveBeenCalledOnce();
    });

    it('allows a merge to replace the contacts that own its added addresses', async () => {
        const alice = record('alice', 'Alice', [ENTRY]);
        const duplicate = record('duplicate', 'Alice', [
            { chain: 'litecoin', address: 'ltc1qsecond', label: '' },
        ]);
        const vault = fakeVault([alice, duplicate]);
        const merged = { ...alice, entries: [...alice.entries, ...duplicate.entries] };

        await expect(saveContact({ vault, record: merged, replaceIds: ['duplicate'] }))
            .resolves.toMatchObject({ id: 'alice', entries: merged.entries });
        expect(vault.contacts.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'alice' }));
    });

    it('keeps Base58 address comparison case-sensitive', async () => {
        const vault = fakeVault([record('upper', 'Upper', [
            { chain: 'dogecoin', address: 'DCaseSensitive', label: '' },
        ])]);
        const lower = record('lower', 'Lower', [
            { chain: 'dogecoin', address: 'dcasesensitive', label: '' },
        ]);

        await expect(saveContact({ vault, record: lower })).resolves.toMatchObject({ id: 'lower' });
    });

    it('normalizes chain and Bech32 case but keeps identical text on different chains distinct', async () => {
        const alice = record('alice', 'Alice', [ENTRY]);
        const vault = fakeVault([alice]);
        const samePair = record('bob', 'Bob', [{
            chain: ' BITCOIN ',
            address: 'BC1QDUPLICATE',
            label: '',
        }]);
        const otherChain = record('carol', 'Carol', [{
            chain: 'litecoin',
            address: ENTRY.address,
            label: '',
        }]);

        await expect(saveContact({ vault, record: samePair }))
            .rejects.toThrow('address already belongs to Alice');
        await expect(saveContact({ vault, record: otherChain }))
            .resolves.toMatchObject({ id: 'carol' });
    });

    it('refuses to overwrite a contact that changed after editing began', async () => {
        const stale = record('alice', 'Alice', [ENTRY]);
        const newer = { ...stale, notes: 'Newer note', updatedAt: '2026-02-01T00:00:00.000Z' };
        const vault = fakeVault([newer]);

        await expect(saveContact({
            vault,
            record: { ...stale, notes: 'Stale note' },
            expectedUpdatedAt: stale.updatedAt,
        })).rejects.toThrow('Contact changed since this screen loaded');
        expect(vault.rows.get('alice')).toBe(newer);
        expect(vault.contacts.put).not.toHaveBeenCalled();
    });

    it('serializes an edit and delete so the delete cannot remove the newer revision', async () => {
        const alice = record('alice', 'Alice', [ENTRY]);
        const vault = fakeVault([alice]);

        const edit = saveContact({
            vault,
            record: { ...alice, notes: 'Keep this edit' },
            expectedUpdatedAt: alice.updatedAt,
        });
        const deletion = deleteContact({
            vault,
            id: alice.id,
            expectedUpdatedAt: alice.updatedAt,
        });

        await expect(edit).resolves.toMatchObject({ notes: 'Keep this edit' });
        await expect(deletion).rejects.toThrow('Contact changed since this screen loaded');
        expect(vault.rows.get('alice')).toMatchObject({ notes: 'Keep this edit' });
        expect(vault.contacts.delete).not.toHaveBeenCalled();
    });
});
