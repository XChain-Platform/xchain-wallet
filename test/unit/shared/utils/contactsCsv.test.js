// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    contactsFromCsv,
    contactsToCsv,
} from '../../../../packages/core/src/shared/utils/contactsCsv.js';

const CREATED = '2026-01-02T03:04:05.000Z';
const BTC = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BTC_SECOND = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const LTC = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

function contact(overrides = {}) {
    return {
        schemaVersion: 1,
        id: 'contact-1',
        name: 'Doe, "Jane"',
        notes: 'Met at work\nTrusted friend',
        entries: [
            { chain: 'bitcoin', address: BTC, label: 'Main, "cold"' },
            { chain: 'litecoin', address: LTC, label: 'Savings' },
        ],
        avatarSeed: BTC,
        createdAt: CREATED,
        updatedAt: CREATED,
        ...overrides,
    };
}

describe('contacts CSV', () => {
    it('round-trips quoted metadata and multiple addresses into one contact', () => {
        const original = contact();
        const csv = contactsToCsv([original]);
        const parsed = contactsFromCsv(csv);

        expect(csv).toContain('"Doe, ""Jane"""');
        expect(csv).toContain('"Met at work\nTrusted friend"');
        expect(parsed).toMatchObject({ failures: [], duplicates: 0 });
        expect(parsed.records).toEqual([{ record: original, line: 2 }]);
    });

    it('detects a quoted, reordered header after a BOM and blank line', () => {
        const csv = '\uFEFF\r\n"ADDRESS","Name","CHAIN","label"\r\n'
            + `${BTC},"Alice, A.",bitcoin,"Primary, wallet"\r\n`;
        const parsed = contactsFromCsv(csv, {
            now: CREATED,
            makeId: () => 'generated-id',
        });

        expect(parsed.failures).toEqual([]);
        expect(parsed.records[0]).toEqual({
            line: 3,
            record: {
                schemaVersion: 1,
                id: 'generated-id',
                name: 'Alice, A.',
                notes: '',
                entries: [{ chain: 'bitcoin', address: BTC, label: 'Primary, wallet' }],
                avatarSeed: BTC,
                createdAt: CREATED,
                updatedAt: CREATED,
            },
        });
    });

    it('reports physical line numbers for bad rows after quoted newlines', () => {
        const csv = 'name,chain,address,notes\n'
            + `Alice,bitcoin,${BTC},"line one\nline two"\n`
            + `Bob,,${BTC_SECOND},bad chain\n`;
        const parsed = contactsFromCsv(csv, { now: CREATED, makeId: () => 'alice' });

        expect(parsed.records).toHaveLength(1);
        expect(parsed.failures).toEqual([{
            subject: 'Bob',
            message: 'Line 4: chain is required.',
        }]);
    });

    it('removes repeated rows and rejects an address assigned to another contact', () => {
        const csv = 'id,name,chain,address\n'
            + `a,Alice,bitcoin,${BTC}\n`
            + `a,Alice,bitcoin,${BTC.toUpperCase()}\n`
            + `b,Bob,bitcoin,${BTC}\n`;
        const parsed = contactsFromCsv(csv, { now: CREATED });

        expect(parsed.duplicates).toBe(1);
        expect(parsed.records.map(({ record }) => record.name)).toEqual(['Alice']);
        expect(parsed.failures).toEqual([{
            subject: 'Bob',
            message: 'Line 4: address duplicates line 2.',
        }]);
    });

    it('rejects a missing header and unterminated quoted field with line numbers', () => {
        expect(() => contactsFromCsv('Alice,bitcoin,bc1qalice\n'))
            .toThrow('Line 1: missing required "name" column.');
        expect(() => contactsFromCsv('name,chain,address\nAlice,bitcoin,"bc1qalice\n'))
            .toThrow('Line 2: unterminated quoted field.');
        expect(() => contactsFromCsv(`name,chain,address\n"Alice"x,bitcoin,${BTC}\n`))
            .toThrow('Line 2: unexpected character after closing quote.');
    });

    it('rejects malformed and wrong-coin addresses per row', () => {
        const csv = 'name,chain,address\n'
            + 'Typo,bitcoin,not-an-address\n'
            + `Wrong coin,bitcoin,${LTC}\n`;
        const parsed = contactsFromCsv(csv, { now: CREATED });

        expect(parsed.records).toEqual([]);
        expect(parsed.failures.map(({ message }) => message)).toEqual([
            'Line 2: "not-an-address" is not a valid supported address.',
            'Line 3: address belongs to litecoin, not bitcoin.',
        ]);
    });
});
