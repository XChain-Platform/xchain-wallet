// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildExportFilename } from '../../../../packages/core/src/flows/historyExport.js';

afterEach(() => {
    vi.useRealTimers();
});

describe('buildExportFilename', () => {
    it('defaults the scope and uses the UTC day', () => {
        const date = new Date('2026-03-04T23:59:59Z');

        expect(buildExportFilename({ format: 'csv', date }))
            .toBe('xchain-history-all-2026-03-04.csv');
    });

    it('includes an explicit scope and JSON extension', () => {
        const date = new Date('2026-03-04T00:00:00Z');

        expect(buildExportFilename({ scope: 'BTC-XCP', format: 'json', date }))
            .toBe('xchain-history-BTC-XCP-2026-03-04.json');
    });

    it('uses a dated CSV name when the date is omitted', () => {
        expect(buildExportFilename({ format: 'csv' }))
            .toMatch(/^xchain-history-all-\d{4}-\d\d-\d\d\.csv$/);
    });

    it('uses the current UTC day when the date is omitted', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-06T12:00:00Z'));

        expect(buildExportFilename({ format: 'csv' }))
            .toBe('xchain-history-all-2026-05-06.csv');
    });

    it('ignores a non-Date date value', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-06T12:00:00Z'));

        expect(buildExportFilename({ format: 'csv', date: '2026-01-01' }))
            .toBe('xchain-history-all-2026-05-06.csv');
    });
});
