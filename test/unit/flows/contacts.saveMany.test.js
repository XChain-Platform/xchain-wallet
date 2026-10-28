// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A contacts import saves its records in one vault write. Every write
// re-encrypts the whole vault, so saving a large address book record by
// record costs time in proportion to the square of its size. The batch
// gives each record the checks and messages one-by-one saving would.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveMasterKeyAsync } from '../../../packages/core/src/crypto/index.js';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';
import { listContacts, saveContact, saveContacts } from '../../../packages/core/src/flows/contacts.js';

const KDF = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 1,
    memory: 8192,
    parallelism: 1,
};
const AT = '2026-10-13T18:00:00.000Z';

let masterKey;

async function openVault(stored = []) {
    masterKey ??= await deriveMasterKeyAsync('contacts-batch-device', KDF);
    const backend = new InMemoryBackend();
    const vault = new Vault({ backend, masterKey });
    await vault.open();
    for (const contact of stored) await vault.contacts.put(contact);
    const save = vi.spyOn(backend, 'save');
    return { vault, save };
}

function contact(id, name, addresses) {
    return {
        schemaVersion: 1,
        id,
        name,
        notes: '',
        avatarSeed: addresses[0],
        entries: addresses.map((address) => ({ chain: 'bitcoin', address, label: '' })),
        createdAt: AT,
        updatedAt: AT,
    };
}

const STORED = [
    contact('s1', 'Stored One', ['bc1qstoredone']),
    contact('s2', 'Stored Two', ['bc1qstoredtwo']),
];

const IMPORT = [
    contact('n1', 'New One', ['bc1qnewone']),
    contact('n2', 'stored one', ['bc1qnewtwo']),
    contact('n3', 'New Three', ['BC1QSTOREDTWO']),
    contact('n4', 'New Four', ['bc1qfour', 'bc1qfour']),
    contact('s1', 'Stored One Renamed', ['bc1qstoredone', 'bc1qrenamed']),
    contact('n5', 'Stored One', ['bc1qfive']),
    contact('n6', 'New Six', ['bc1qrenamed']),
    contact('n7', 'new one', ['bc1qseven']),
    { ...contact('n8', '', ['bc1qeight']) },
];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T12:00:00.000Z'));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('saveContacts', () => {
    it('matches saving the same records one by one', async () => {
        const one = await openVault(STORED);
        const sequential = [];
        for (const [index, record] of IMPORT.entries()) {
            try {
                await saveContact({ vault: one.vault, record });
            } catch (err) {
                sequential.push({ index, message: err.message });
            }
        }

        const many = await openVault(STORED);
        const batch = await saveContacts({ vault: many.vault, records: IMPORT });

        // A taken name, a taken address, a repeated address, an address the
        // renamed contact took earlier in the batch, a name taken earlier in
        // the batch, and an empty name. The rename frees "Stored One".
        expect(sequential.map(({ index }) => index)).toEqual([1, 2, 3, 6, 7, 8]);
        expect(batch.failures).toEqual(sequential);
        expect(batch.saved).toHaveLength(IMPORT.length - sequential.length);
        expect(await listContacts({ vault: many.vault })).toEqual(await listContacts({ vault: one.vault }));
    });

    it('writes the vault once for the whole import', async () => {
        const { vault, save } = await openVault(STORED);
        const records = Array.from({ length: 50 }, (_, i) => contact(`c${i}`, `Contact ${i}`, [`bc1qcontact${i}`]));

        const result = await saveContacts({ vault, records });

        expect(result.failures).toEqual([]);
        expect(result.saved).toHaveLength(50);
        expect(save).toHaveBeenCalledTimes(1);
        expect(await vault.contacts.count()).toBe(52);
    });

    it('writes nothing when every record fails', async () => {
        const { vault, save } = await openVault(STORED);

        const result = await saveContacts({ vault, records: [contact('x', 'stored two', ['bc1qx'])] });

        expect(result.saved).toEqual([]);
        expect(result.failures).toEqual([{ index: 0, message: 'A contact named "Stored Two" already exists.' }]);
        expect(save).not.toHaveBeenCalled();
    });
});
