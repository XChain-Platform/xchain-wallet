// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Contact CRUD flows: §41.7.4 contact integration + §11.3.4 address
// book. The Contact schema + vault collection already exist
// (packages/core/src/schemas/contact.js + Vault.contacts); these are
// the flow-layer primitives that the shared routes call.
//
// Read-only; `saveContact` / `deleteContact` mutate the vault but
// don't require a password (no signing; contacts are local-only
// metadata). Persistence is whatever backs the vault (encrypted blob
// on the extension's local storage for the popup, browser-backed
// IndexedDB wrapper for the web shell, etc.).

import { createContact, validateContact } from '../schemas/contact.js';

const contactMutationTails = new WeakMap();

/**
 * List every contact in the wallet. Contacts aren't scoped to a
 * specific wallet record; they're shared across all wallets in the
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
 * `chain` matches `ContactEntry.chain` (the human form,
 * 'bitcoin' / 'litecoin' / 'dogecoin', not a chainId).
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
    const needle = normalizedEntryKey({ chain, address });
    for (const c of rows) {
        for (const e of c.entries || []) {
            if (normalizedEntryKey(e) === needle) return c;
        }
    }
    return null;
}

/**
 * Persist a contact. Accepts either an existing Contact record
 * (updates in place, bumping `updatedAt`) or the `createContact`
 * input shape (creates a new one).
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, record?: object, input?: object, replaceIds?: string[], expectedUpdatedAt?: string | null }} opts
 */
export async function saveContact({ vault, record, input, replaceIds = [], expectedUpdatedAt }) {
    if (!vault) throw new Error('saveContact: vault is required');
    if (!record && !input) throw new Error('saveContact: record or input is required');
    if (input && (!input.name || !input.entries || input.entries.length === 0)) {
        throw new Error('saveContact: input.name and input.entries[] are required');
    }
    return withContactMutationLock(vault, async () => {
        const existing = await vault.contacts.list();
        const current = record ? existing.find((contact) => contact.id === record.id) : null;
        assertExpectedVersion(current, expectedUpdatedAt);

        /** @type {any} */
        let rec;
        if (record) {
            rec = { ...record, updatedAt: nextUpdatedAt(current?.updatedAt || record.updatedAt) };
        } else if (input) {
            rec = createContact(input);
        }
        const validation = validateContact(rec);
        if (!validation.ok) {
            throw new Error(`saveContact: invalid contact: ${validation.errors.join('; ')}`);
        }
        const seen = new Set();
        for (const entry of rec.entries) {
            const key = normalizedEntryKey(entry);
            if (seen.has(key)) {
                throw new Error(`saveContact: address appears more than once: ${entry.address}`);
            }
            seen.add(key);
        }
        const replaced = new Set(Array.isArray(replaceIds) ? replaceIds : []);
        for (const contact of existing) {
            if (contact.id === rec.id || replaced.has(contact.id)) continue;
            const duplicate = (contact.entries || []).find((entry) => seen.has(normalizedEntryKey(entry)));
            if (duplicate) {
                throw new Error(`saveContact: address already belongs to ${contact.name}: ${duplicate.address}`);
            }
        }
        await vault.contacts.put(rec);
        return rec;
    });
}

function normalizedEntryKey(entry) {
    return `${String(entry?.chain || '').trim().toLowerCase()}|${normalizedAddress(entry?.address)}`;
}

function normalizedAddress(address) {
    const trimmed = String(address || '').trim();
    const lower = trimmed.toLowerCase();
    return /^(bc|tb|bcrt|ltc|tltc|rltc)1/.test(lower) ? lower : trimmed;
}

function nextUpdatedAt(previous) {
    const previousMs = Date.parse(previous);
    const timestamp = Number.isFinite(previousMs) ? Math.max(Date.now(), previousMs + 1) : Date.now();
    return new Date(timestamp).toISOString();
}

function assertExpectedVersion(current, expectedUpdatedAt) {
    if (expectedUpdatedAt === undefined) return;
    if (expectedUpdatedAt === null ? current : current?.updatedAt !== expectedUpdatedAt) {
        throw new Error('Contact changed since this screen loaded. Reopen it and try again.');
    }
}

async function withContactMutationLock(vault, mutation) {
    const previous = contactMutationTails.get(vault) || Promise.resolve();
    const run = previous.then(mutation);
    const tail = run.catch(() => {});
    contactMutationTails.set(vault, tail);
    try {
        return await run;
    } finally {
        if (contactMutationTails.get(vault) === tail) contactMutationTails.delete(vault);
    }
}

/**
 * Delete a contact by id. When supplied, `expectedUpdatedAt` prevents a
 * confirmation opened for an older revision from deleting a newer edit.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, id: string, expectedUpdatedAt?: string | null }} opts
 */
export async function deleteContact({ vault, id, expectedUpdatedAt }) {
    if (!vault) throw new Error('deleteContact: vault is required');
    if (typeof id !== 'string' || id.length === 0) {
        throw new Error('deleteContact: id is required');
    }
    return withContactMutationLock(vault, async () => {
        const existing = await vault.contacts.list();
        const current = existing.find((contact) => contact.id === id);
        assertExpectedVersion(current, expectedUpdatedAt);
        return vault.contacts.delete(id);
    });
}
