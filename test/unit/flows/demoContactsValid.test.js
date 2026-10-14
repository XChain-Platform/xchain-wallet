// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: every seeded demo contact passes the save checks the Contacts edit
// form (ContactsList.jsx) runs, so a seeded contact can always be edited.

import { describe, it, expect } from 'vitest';
import { synthesizeDemoContacts } from '../../../packages/core/src/flows/demoFixtures.js';
import {
    detectAddressChain,
    isValidAddressAnyNetwork,
    isValidAddressForChain,
} from '../../../packages/core/src/shared/utils/addressValidation.js';
import { isDevMockAddress } from '../../../packages/core/src/sdk/devMockAddresses.js';
import { coinFamilyFor } from '../../../packages/core/src/shared/utils/contactChain.js';

const contacts = synthesizeDemoContacts();
const entries = contacts.flatMap((contact) => contact.entries.map((entry) => ({ contact: contact.name, ...entry })));

describe('demo contacts pass the Contacts edit form checks', () => {
    it('seeds contacts with at least one address each', () => {
        expect(contacts.length).toBeGreaterThan(0);
        for (const contact of contacts) expect(contact.entries.length).toBeGreaterThan(0);
    });

    it.each(entries.map((e) => [`${e.contact} ${e.chain}`, e]))('%s resolves to its own chain', (_label, entry) => {
        // The form resolves the chain from the address first; an address the
        // bytes cannot place comes back 'unknown' and the save asks for a network.
        expect(coinFamilyFor(entry.address.trim(), entry.chain)).toBe(entry.chain);
        expect(detectAddressChain(entry.address)?.coin).toBe(entry.chain);
    });

    it.each(entries.map((e) => [`${e.contact} ${e.chain}`, e]))('%s is a valid address for its network', (_label, entry) => {
        expect(isValidAddressAnyNetwork(entry.address)).toBe(true);
        expect(isValidAddressForChain(entry.address, entry.chain, 'mainnet')).toBe(true);
        // A dev-SDK placeholder would pass the checks above without being real.
        expect(isDevMockAddress(entry.address)).toBe(false);
    });

    it('never repeats an address within or across contacts', () => {
        const addresses = entries.map((entry) => entry.address.toLowerCase());
        expect(new Set(addresses).size).toBe(addresses.length);
    });
});
