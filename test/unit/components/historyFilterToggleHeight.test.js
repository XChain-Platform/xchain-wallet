// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('History toolbar', () => {
    // The in-page Filters toggle is retired (G04): the filter is the standard
    // title-bar button, drawn by ListFilterMenu at the shared control size.
    it('has no in-page Filters toggle and puts the standard filter on the title line', () => {
        const source = readFileSync('packages/core/src/shared/routes/History.jsx', 'utf8');
        expect(source).not.toContain('phoneFilterToggle}');
        expect(source).not.toContain('history.filters.toggle');
        expect(source).toContain('<ListFilterMenu');
        expect(source).toContain('trailing={filterMenu}');
    });
});
