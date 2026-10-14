// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { createContact } from '../../../packages/core/src/schemas/contact.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import {
    Vault,
    VaultStateError,
    VaultValidationError,
} from '../../../packages/core/src/storage/Vault.js';

const KEY = new Uint8Array(32).fill(41);

function contact(name, address = name.toLowerCase()) {
    return createContact({
        name,
        entries: [{ chain: 'bitcoin', address, label: '' }],
    });
}

describe('Vault edge branches', () => {
    it('rejects missing dependencies and every invalid master-key boundary', () => {
        expect(() => new Vault({ masterKey: KEY })).toThrow(/backend is required/);
        for (const masterKey of [undefined, null, new Array(32), new Uint8Array(31), new Uint8Array(33)]) {
            expect(() => new Vault({ backend: new InMemoryBackend(), masterKey }))
                .toThrow(/32-byte Uint8Array/);
        }
    });

    it('allows a failed open to retry and makes later opens idempotent', async () => {
        const backend = new InMemoryBackend();
        const realLoad = backend.load.bind(backend);
        backend.load = vi.fn()
            .mockRejectedValueOnce(new Error('read interrupted'))
            .mockImplementation(realLoad);
        const vault = new Vault({ backend, masterKey: KEY });

        await expect(vault.open()).rejects.toThrow('read interrupted');
        await expect(vault.open()).resolves.toBeUndefined();
        await expect(vault.open()).resolves.toBeUndefined();
        expect(backend.load).toHaveBeenCalledTimes(2);
    });

    it('rejects reads and writes outside the open lifetime', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: KEY });

        await expect(vault.contacts.list()).rejects.toThrow(VaultStateError);
        await expect(vault.save()).rejects.toThrow(VaultStateError);
        vault.close();
        vault.close();
        await expect(vault.contacts.count()).rejects.toThrow('Vault is not open');
    });

    it('clears safely before open and can then initialize an empty document', async () => {
        const backend = new InMemoryBackend(new Uint8Array([1, 2, 3]));
        const clear = vi.spyOn(backend, 'clear');
        const vault = new Vault({ backend, masterKey: KEY });

        await vault.clear();
        expect(clear).toHaveBeenCalledTimes(1);
        await vault.open();
        await expect(vault.contacts.count()).resolves.toBe(0);
    });

    it('does not persist a delete miss', async () => {
        const backend = new InMemoryBackend();
        const save = vi.spyOn(backend, 'save');
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();

        await expect(vault.contacts.get('missing')).resolves.toBeNull();
        await expect(vault.contacts.delete('missing')).resolves.toBe(false);
        expect(save).not.toHaveBeenCalled();
    });

    it('reports missing ids and schema failures with collection details', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: KEY });
        await vault.open();

        const missingId = await vault.contacts.put({}).catch((err) => err);
        expect(missingId).toBeInstanceOf(VaultValidationError);
        expect(missingId).toMatchObject({
            collection: 'contacts',
            errors: ['record.id is required'],
        });

        const invalid = await vault.contacts.put({ id: 'contact-1' }).catch((err) => err);
        expect(invalid).toBeInstanceOf(VaultValidationError);
        expect(invalid.collection).toBe('contacts');
        expect(invalid.errors.length).toBeGreaterThan(0);
    });

    it('replaces matching records and filters without migrating non-matches', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: KEY });
        await vault.open();
        const first = contact('Alice', 'alice');
        const second = contact('Bob', 'bob');

        await vault.contacts.put(first);
        await vault.contacts.put(second);
        await vault.contacts.put({ ...first, name: 'Alice Updated' });

        await expect(vault.contacts.count()).resolves.toBe(2);
        await expect(vault.contacts.findBy('name', 'Alice Updated'))
            .resolves.toEqual([{ ...first, name: 'Alice Updated' }]);
        await expect(vault.contacts.findBy('name', 'Nobody')).resolves.toEqual([]);
    });

    it('keeps manual-save mutations in memory until save is requested', async () => {
        const backend = new InMemoryBackend();
        const vault = new Vault({ backend, masterKey: KEY, autoSave: false });
        await vault.open();
        await vault.contacts.put(contact('Manual'));

        expect(await backend.load()).toBeNull();
        expect(await vault.contacts.count()).toBe(1);
        await vault.save();

        const reopened = new Vault({ backend, masterKey: KEY });
        await reopened.open();
        await expect(reopened.contacts.count()).resolves.toBe(1);
    });

    it('covers the empty, invalid, stored, and cleared singleton states', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: KEY });
        await vault.open();

        await expect(vault.settings.get()).resolves.toBeNull();
        await expect(vault.settings.put({})).rejects.toThrow(VaultValidationError);

        const settings = createDefaultSettings();
        await vault.settings.put(settings);
        await expect(vault.settings.get()).resolves.toEqual(settings);
        await vault.settings.clear();
        await expect(vault.settings.get()).resolves.toBeNull();
    });
});
