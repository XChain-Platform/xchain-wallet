// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One person, one contact. A contact already holds any number of addresses
// (`entries`), but every save-as-contact path created a fresh record, so a
// tester's three addresses for one person became three rows named alike.
// These helpers let the screens add an address to the contact the name
// already belongs to, and fold the duplicates an older wallet left behind.
// They stay out of `flows/contacts.js` on purpose: its `saveContact({input})`
// always creates, and a merge belongs where the screen can say it happened.

const nameKey = (name) => String(name || '').trim().toLowerCase();

// Same address on the same chain, compared the way findContactByAddress does
// (trimmed, case-insensitive: bech32 is case-insensitive by spec).
const entryKey = (e) => `${e?.chain || ''}|${String(e?.address || '').trim().toLowerCase()}`;

/**
 * Order contacts by name, ignoring case and accents, so "alice" and "Alice"
 * sit together and the list reads like an address book.
 *
 * @param {{ name?: string }} a
 * @param {{ name?: string }} b
 */
export function compareContactsByName(a, b) {
    return String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' });
}

/**
 * Newest first, by `createdAt` (ISO strings sort as dates).
 *
 * @param {{ createdAt?: string }} a
 * @param {{ createdAt?: string }} b
 */
export function compareContactsByNewest(a, b) {
    return String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''));
}

/**
 * The saved contact whose name matches, ignoring case and surrounding
 * spaces, or null.
 *
 * @param {any[] | null | undefined} contacts
 * @param {string} name
 */
export function findContactByName(contacts, name) {
    const key = nameKey(name);
    if (!key || !Array.isArray(contacts)) return null;
    return contacts.find((c) => nameKey(c?.name) === key) || null;
}

/**
 * The contact with `entries` appended, skipping any already present.
 *
 * @param {any} contact
 * @param {Array<{ chain: string, address: string, label: string }>} entries
 */
export function withEntriesAdded(contact, entries) {
    const existing = Array.isArray(contact?.entries) ? contact.entries : [];
    const seen = new Set(existing.map(entryKey));
    const added = [];
    for (const e of entries || []) {
        const k = entryKey(e);
        if (seen.has(k)) continue;
        seen.add(k);
        added.push(e);
    }
    return { ...contact, entries: [...existing, ...added] };
}

/**
 * Groups of two or more contacts that share a name.
 *
 * @param {any[] | null | undefined} contacts
 * @returns {any[][]}
 */
export function duplicateNameGroups(contacts) {
    const byName = new Map();
    for (const c of contacts || []) {
        const key = nameKey(c?.name);
        if (!key) continue;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(c);
    }
    return [...byName.values()].filter((g) => g.length > 1);
}

/**
 * Fold one group into its oldest contact: every address once, every
 * distinct non-empty note kept. Returns the record to save and the ids to
 * delete afterwards.
 *
 * @param {any[]} group
 * @returns {{ keep: any, dropIds: string[] }}
 */
export function mergeContactGroup(group) {
    const ordered = [...group].sort((a, b) => String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')));
    const [first, ...rest] = ordered;
    let keep = first;
    for (const c of rest) keep = withEntriesAdded(keep, c.entries);
    const notes = [...new Set(ordered.map((c) => String(c?.notes || '').trim()).filter(Boolean))];
    return { keep: { ...keep, notes: notes.join('\n') }, dropIds: rest.map((c) => c.id) };
}
