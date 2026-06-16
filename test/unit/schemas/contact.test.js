// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/contact — createContact + validateContact.

import { describe, it, expect } from 'vitest';
import {
    createContact,
    validateContact,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/contact.js';

const BASE_ENTRY = { chain: 'BTC', address: '1abc', label: 'Main' };
const BASE_INPUT = {
    name: 'Alice',
    entries: [BASE_ENTRY],
};

describe('createContact', () => {
    it('creates a well-formed contact', () => {
        const c = createContact(BASE_INPUT);
        expect(c.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof c.id).toBe('string');
        expect(c.name).toBe('Alice');
        expect(c.notes).toBe('');
        expect(c.entries).toEqual([BASE_ENTRY]);
        expect(c.avatarSeed).toBe('1abc');
        expect(typeof c.createdAt).toBe('string');
        expect(c.createdAt).toBe(c.updatedAt);
    });

    it('uses provided notes', () => {
        const c = createContact({ ...BASE_INPUT, notes: 'Friend' });
        expect(c.notes).toBe('Friend');
    });

    it('uses provided avatarSeed', () => {
        const c = createContact({ ...BASE_INPUT, avatarSeed: 'custom-seed' });
        expect(c.avatarSeed).toBe('custom-seed');
    });

    it('defaults avatarSeed to first entry address when not provided', () => {
        const c = createContact(BASE_INPUT);
        expect(c.avatarSeed).toBe('1abc');
    });

    it('defaults avatarSeed to empty string when entries is empty', () => {
        const c = createContact({ ...BASE_INPUT, entries: [] });
        expect(c.avatarSeed).toBe('');
    });

    it('passes validation immediately after creation', () => {
        const r = validateContact(createContact(BASE_INPUT));
        expect(r.ok).toBe(true);
    });

    it('accepts multiple entries', () => {
        const c = createContact({
            name: 'Bob',
            entries: [
                { chain: 'BTC', address: '1btc', label: '' },
                { chain: 'LTC', address: '1ltc', label: 'LTC addr' },
            ],
        });
        expect(c.entries).toHaveLength(2);
    });
});

describe('validateContact', () => {
    it('accepts a valid record', () => {
        const r = validateContact(createContact(BASE_INPUT));
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
        expect(validateContact(null).ok).toBe(false);
        expect(validateContact(42).ok).toBe(false);
        expect(validateContact('x').ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const c = createContact(BASE_INPUT);
        const r = validateContact({ ...c, schemaVersion: 99 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects empty id', () => {
        const c = createContact(BASE_INPUT);
        expect(validateContact({ ...c, id: '' }).ok).toBe(false);
    });

    it('rejects empty name', () => {
        const c = createContact(BASE_INPUT);
        const r = validateContact({ ...c, name: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('name'))).toBe(true);
    });

    it('rejects non-string notes', () => {
        const c = createContact(BASE_INPUT);
        const r = validateContact({ ...c, notes: 42 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('notes'))).toBe(true);
    });

    it('rejects non-array entries', () => {
        const c = createContact(BASE_INPUT);
        const r = validateContact({ ...c, entries: 'bad' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('entries'))).toBe(true);
    });

    it('rejects malformed entry — missing chain', () => {
        const c = createContact(BASE_INPUT);
        const r = validateContact({ ...c, entries: [{ address: '1abc', label: '' }] });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed entry — missing address', () => {
        const c = createContact(BASE_INPUT);
        const r = validateContact({ ...c, entries: [{ chain: 'BTC', label: '' }] });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed entry — non-string label', () => {
        const c = createContact(BASE_INPUT);
        const r = validateContact({ ...c, entries: [{ chain: 'BTC', address: '1a', label: 42 }] });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed entry — not a plain object', () => {
        const c = createContact(BASE_INPUT);
        const r = validateContact({ ...c, entries: ['not-an-object'] });
        expect(r.ok).toBe(false);
    });

    it('accepts entries with empty label string', () => {
        const c = createContact({ ...BASE_INPUT, entries: [{ chain: 'BTC', address: '1abc', label: '' }] });
        expect(validateContact(c).ok).toBe(true);
    });

    it('rejects non-string avatarSeed', () => {
        const c = createContact(BASE_INPUT);
        const r = validateContact({ ...c, avatarSeed: null });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('avatarSeed'))).toBe(true);
    });

    it('rejects invalid createdAt', () => {
        const c = createContact(BASE_INPUT);
        expect(validateContact({ ...c, createdAt: 'not-a-date' }).ok).toBe(false);
    });

    it('rejects invalid updatedAt', () => {
        const c = createContact(BASE_INPUT);
        expect(validateContact({ ...c, updatedAt: 'not-a-date' }).ok).toBe(false);
    });
});
