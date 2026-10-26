// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    contactsFromCsv,
    contactsToCsv,
} from '../../../../packages/core/src/shared/utils/contactsCsv.js';
import { parseCsvRecords } from '../../../../packages/core/src/shared/utils/csv.js';

const STAMP = '2026-01-02T03:04:05.000Z';
const BTC = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

function contact(overrides = {}, label = 'Main') {
    return {
        schemaVersion: 1,
        id: 'contact-1',
        name: 'Alice',
        notes: '',
        entries: [{ chain: 'bitcoin', address: BTC, label }],
        avatarSeed: BTC,
        createdAt: STAMP,
        updatedAt: STAMP,
        ...overrides,
    };
}

describe('contacts CSV formula guard', () => {
    it.each(['=1+1', '+1', '-2+3', '@SUM(A1)', '\tTAB', '\rCR', "'=quoted"])(
        'writes no exported text cell that opens as a formula: %j',
        (lead) => {
            const csv = contactsToCsv([contact({ name: lead, notes: lead }, lead)]);
            const rows = parseCsvRecords(csv);
            for (const cell of rows[1].cells) {
                expect(cell).not.toMatch(/^[=+\-@\t\r]/);
            }
        },
    );

    it('reads every guarded cell back as the exported text', () => {
        const original = contact({
            name: '=HYPERLINK("http://example.test")',
            notes: '+1 line\n-2 line',
        }, '@label');
        const parsed = contactsFromCsv(contactsToCsv([original]));
        expect(parsed.failures).toEqual([]);
        expect(parsed.records).toEqual([{ record: original, line: 2 }]);
    });

    it('round-trips a label that already opens with an apostrophe and a formula character', () => {
        const original = contact({}, "'-5");
        const parsed = contactsFromCsv(contactsToCsv([original]));
        expect(parsed.records[0].record.entries[0].label).toBe("'-5");
    });

    it('leaves ordinary text and apostrophes untouched', () => {
        const csv = contactsToCsv([contact({ name: "O'Brien" }, 'Cold')]);
        expect(csv).toContain("O'Brien");
        expect(csv).not.toContain("''");
    });
});
