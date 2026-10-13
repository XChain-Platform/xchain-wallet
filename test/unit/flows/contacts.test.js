// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    deleteContact,
    findContactByAddress,
    listContacts,
    saveContact,
} from '../../../packages/core/src/flows/contacts.js';

const ENTRY = { chain: 'bitcoin', address: 'bc1qalice', label: 'Savings' };

function makeVault(rows = []) {
    return {
        contacts: {
            list: vi.fn().mockResolvedValue(rows),
            put: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(true),
        },
    };
}

describe('contacts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-03T04:05:06.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('lists vault contacts and normalizes a non-array result', async () => {
        const rows = [{ id: 'contact-1' }];
        await expect(listContacts({ vault: makeVault(rows) })).resolves.toBe(rows);
        await expect(listContacts({ vault: makeVault(null) })).resolves.toEqual([]);
    });

    it('finds an exact chain and address pair across contact entries', async () => {
        const alice = { id: 'alice', entries: [ENTRY] };
        const vault = makeVault([{ id: 'empty' }, alice]);

        await expect(findContactByAddress({
            vault,
            chain: 'bitcoin',
            address: 'bc1qalice',
        })).resolves.toBe(alice);
        await expect(findContactByAddress({
            vault,
            chain: 'litecoin',
            address: 'bc1qalice',
        })).resolves.toBeNull();
    });

    it('creates, validates, and persists a contact from input', async () => {
        const vault = makeVault();
        const saved = await saveContact({
            vault,
            input: { name: 'Alice', entries: [ENTRY], notes: 'Friend' },
        });

        expect(saved).toMatchObject({
            schemaVersion: 1,
            name: 'Alice',
            notes: 'Friend',
            entries: [ENTRY],
            avatarSeed: 'bc1qalice',
            createdAt: '2026-02-03T04:05:06.000Z',
            updatedAt: '2026-02-03T04:05:06.000Z',
        });
        expect(saved.id).toEqual(expect.any(String));
        expect(vault.contacts.put).toHaveBeenCalledWith(saved);
    });

    it('updates the timestamp before persisting an existing record', async () => {
        const vault = makeVault();
        const record = {
            schemaVersion: 1,
            id: 'contact-1',
            name: 'Alice',
            notes: '',
            entries: [ENTRY],
            avatarSeed: 'alice',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };

        const saved = await saveContact({ vault, record });

        expect(saved).not.toBe(record);
        expect(saved.updatedAt).toBe('2026-02-03T04:05:06.000Z');
        expect(record.updatedAt).toBe('2026-01-01T00:00:00.000Z');
        expect(vault.contacts.put).toHaveBeenCalledWith(saved);
    });

    it('refuses missing input and malformed records without writing', async () => {
        const vault = makeVault();

        await expect(saveContact({ vault })).rejects.toThrow('record or input is required');
        await expect(saveContact({
            vault,
            record: { id: 'broken' },
        })).rejects.toThrow('saveContact: invalid contact:');
        expect(vault.contacts.put).not.toHaveBeenCalled();
    });

    it('validates lookups and delegates deletion to the vault', async () => {
        const vault = makeVault();

        await expect(findContactByAddress({ vault, chain: '', address: 'a' }))
            .rejects.toThrow('chain is required');
        await expect(findContactByAddress({ vault, chain: 'bitcoin', address: '' }))
            .rejects.toThrow('address is required');
        await expect(deleteContact({ vault, id: '' })).rejects.toThrow('id is required');
        await expect(deleteContact({ vault, id: 'contact-1' })).resolves.toBe(true);
        expect(vault.contacts.delete).toHaveBeenCalledWith('contact-1');
    });
});
