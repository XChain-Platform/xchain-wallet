// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pins the File format field on Settings: Backup, Export Contacts: the themed
// IconSelect (never a native select), JSON and CSV each with an icon, and the
// export still branching on the chosen format.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/settings/ContactsSection.jsx'),
    'utf8',
);
const page = source.slice(source.indexOf('export function ContactsExportPage'), source.indexOf('export function ContactsSection'));

describe('Export Contacts file format field', () => {
    it('is the themed IconSelect, not a native select', () => {
        expect(page).toMatch(/<IconSelect\b/);
        expect(page).not.toMatch(/<select\b/);
    });

    it('offers JSON and CSV, each with an icon', () => {
        expect(page).toMatch(/value: 'json'[^}]*icon: <Icon\.\w+ \/>/);
        expect(page).toMatch(/value: 'csv'[^}]*icon: <Icon\.\w+ \/>/);
    });

    it('still exports the chosen format', () => {
        expect(page).toMatch(/format === 'csv' \? onExportCsv\(\) : onExport\(\)/);
    });
});
