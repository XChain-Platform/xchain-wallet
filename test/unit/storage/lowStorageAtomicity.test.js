// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { createAddress } from '../../../packages/core/src/schemas/address.js';
import { createContact } from '../../../packages/core/src/schemas/contact.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { writeHistoryCache } from '../../../packages/core/src/shared/utils/historyCache.js';

class RefusingBackend extends InMemoryBackend {
    refuseWrites = false;

    async save(blob) {
        if (this.refuseWrites) throw new DOMException('Storage is full', 'QuotaExceededError');
        return super.save(blob);
    }
}

const KEY = new Uint8Array(32).fill(7);

function address(label) {
    return createAddress({
        accountId: null,
        chain: 'bitcoin',
        network: 'mainnet',
        source: 'watch-only',
        addressType: 'p2wpkh',
        derivationPath: null,
        address: 'bc1qexample',
        publicKey: '02'.padEnd(66, '0'),
        label,
    });
}

afterEach(() => {
    delete globalThis.localStorage;
});

describe('low-storage writes', () => {
    it('rolls settings, contacts, and labels back when encrypted persistence fails', async () => {
        const backend = new RefusingBackend();
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();
        const settings = createDefaultSettings();
        const contact = createContact({
            name: 'Alice',
            entries: [{ chain: 'bitcoin', address: 'bc1qalice', label: '' }],
        });
        const savedAddress = address('Savings');
        await vault.settings.put(settings);
        await vault.contacts.put(contact);
        await vault.addresses.put(savedAddress);
        backend.refuseWrites = true;

        await expect(vault.settings.put({ ...settings, theme: 'dark' }))
            .rejects.toHaveProperty('name', 'QuotaExceededError');
        await expect(vault.contacts.put({ ...contact, name: 'Changed' }))
            .rejects.toHaveProperty('name', 'QuotaExceededError');
        await expect(vault.addresses.put({ ...savedAddress, label: 'Changed' }))
            .rejects.toHaveProperty('name', 'QuotaExceededError');
        await expect(vault.contacts.delete(contact.id))
            .rejects.toHaveProperty('name', 'QuotaExceededError');

        expect((await vault.settings.get()).theme).toBe(settings.theme);
        expect((await vault.contacts.get(contact.id)).name).toBe('Alice');
        expect((await vault.addresses.get(savedAddress.id)).label).toBe('Savings');

        const reopened = new Vault({ backend, masterKey: KEY });
        await reopened.open();
        expect((await reopened.settings.get()).theme).toBe(settings.theme);
        expect((await reopened.contacts.get(contact.id)).name).toBe('Alice');
        expect((await reopened.addresses.get(savedAddress.id)).label).toBe('Savings');
    });

    it('reports cache writes accurately without throwing when storage is unavailable or full', () => {
        const snapshot = { entries: [], addressesByChain: {}, fetchedAt: 1 };
        expect(writeHistoryCache('wallet-1', null, snapshot)).toBe(false);

        globalThis.localStorage = {
            setItem() { throw new DOMException('Storage is full', 'QuotaExceededError'); },
        };
        expect(writeHistoryCache('wallet-1', null, snapshot)).toBe(false);
    });
});
