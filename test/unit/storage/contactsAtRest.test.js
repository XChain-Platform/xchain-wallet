// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Contacts must never reach storage as plaintext: they live in vault.contacts
// inside the AES-GCM vault blob. The Android backup comments rely on this, so
// a regression here would silently make those comments false again.

import { describe, expect, it } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { saveContact } from '../../../packages/core/src/flows/contacts.js';

const KEY = new Uint8Array(32).fill(7);
const NAME = 'ZebraPlaintextName';
const ADDRESS = 'bc1qzebrazebrazebrazebrazebrazebrazebra0000';
const NOTES = 'zebra-secret-notes-marker';

function storageValues(store) {
    if (!store) return [];
    const out = [];
    for (let i = 0; i < store.length; i += 1) out.push(String(store.getItem(store.key(i))));
    return out;
}

describe('contacts at rest', () => {
    it('never stores a saved contact as plaintext and reopens it from the vault', async () => {
        const backend = new InMemoryBackend();
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();

        await saveContact({
            vault,
            input: { name: NAME, notes: NOTES, entries: [{ chain: 'bitcoin', address: ADDRESS, label: 'lbl' }] },
        });

        const blob = await backend.load();
        expect(blob.length).toBeGreaterThan(0);
        const haystacks = [
            Buffer.from(blob).toString('latin1'),
            Buffer.from(blob).toString('utf8'),
            ...storageValues(globalThis.localStorage),
            ...storageValues(globalThis.sessionStorage),
        ];
        for (const hay of haystacks) {
            expect(hay.includes(NAME)).toBe(false);
            expect(hay.includes(ADDRESS)).toBe(false);
            expect(hay.includes(NOTES)).toBe(false);
        }

        const reopened = new Vault({ backend, masterKey: KEY });
        await reopened.open();
        const contacts = await reopened.contacts.list();
        expect(contacts).toHaveLength(1);
        expect(contacts[0].name).toBe(NAME);
        expect(JSON.stringify(contacts[0])).toContain(ADDRESS);
    });
});
