// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Contact CRUD flows — §41.7.4 contact integration + §11.3.4 address
// book. The Contact schema + vault collection already exist
// (packages/core/src/schemas/contact.js + Vault.contacts); these are
// the flow-layer primitives that the shared routes call.
//
// Read-only; `saveContact` / `deleteContact` mutate the vault but
// don't require a password (no signing — contacts are local-only
// metadata). Persistence is whatever backs the vault (encrypted blob
// on the extension's local storage for the popup, browser-backed
// IndexedDB wrapper for the web shell, etc.).

import { createContact, validateContact } from '../schemas/contact.js';

/**
 * List every contact in the wallet. Contacts aren't scoped to a
 * specific wallet record — they're shared across all wallets in the
 * vault, same as `Settings` / `Signers`.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault }} opts
 */
export async function listContacts({ vault }) {
    if (!vault) throw new Error('listContacts: vault is required');
    const rows = await vault.contacts.list();
    return Array.isArray(rows) ? rows : [];
}

/**
 * Look up a single contact by the exact address on a chain. Used by
 * the messaging inbox to auto-label incoming senders. Returns null
 * when no contact has an entry matching the (chain, address) pair.
 *
 * `chain` matches `ContactEntry.chain` — the human form
 * ('bitcoin' / 'litecoin' / 'dogecoin'), not a chainId.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, chain: string, address: string }} opts
 */
export async function findContactByAddress({ vault, chain, address }) {
    if (!vault) throw new Error('findContactByAddress: vault is required');
    if (typeof chain !== 'string' || chain.length === 0) {
        throw new Error('findContactByAddress: chain is required');
    }
    if (typeof address !== 'string' || address.length === 0) {
        throw new Error('findContactByAddress: address is required');
    }
    const rows = await vault.contacts.list();
    for (const c of rows) {
        for (const e of c.entries || []) {
            if (e.chain === chain && e.address === address) return c;
        }
    }
    return null;
}

/**
 * Persist a contact. Accepts either an existing Contact record
 * (updates in place, bumping `updatedAt`) or the `createContact`
 * input shape (creates a new one).
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, record?: object, input?: object }} opts
 */
export async function saveContact({ vault, record, input }) {
    if (!vault) throw new Error('saveContact: vault is required');
    /** @type {any} */
    let rec;
    if (record) {
        rec = { ...record, updatedAt: new Date().toISOString() };
    } else if (input) {
        if (!input.name || !input.entries || input.entries.length === 0) {
            throw new Error('saveContact: input.name and input.entries[] are required');
        }
        rec = createContact(input);
    } else {
        throw new Error('saveContact: record or input is required');
    }
    const validation = validateContact(rec);
    if (!validation.ok) {
        throw new Error(`saveContact: invalid contact — ${validation.errors.join('; ')}`);
    }
    await vault.contacts.put(rec);
    return rec;
}

/**
 * Delete a contact by id.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, id: string }} opts
 */
export async function deleteContact({ vault, id }) {
    if (!vault) throw new Error('deleteContact: vault is required');
    if (typeof id !== 'string' || id.length === 0) {
        throw new Error('deleteContact: id is required');
    }
    return vault.contacts.delete(id);
}
