// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The own-address picker (AddressList in picker mode) draws its network filter
// like the standard network field (U59); the Addresses screen keeps the chip.
describe('AddressList network filter trigger', () => {
    it('asks for the field-style trigger only in picker mode', () => {
        const source = readFileSync('packages/core/src/shared/routes/AddressList.jsx', 'utf8');
        expect(source).toMatch(/<NetworkFilterDropdown value=\{network\} onChange=\{setNetwork\} iconOnly=\{!pickerMode\} fieldTrigger=\{pickerMode\} \/>/);
    });
});
