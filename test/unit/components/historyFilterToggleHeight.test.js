// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('History toolbar', () => {
    it('gives the Filters toggle the same control height as Export', () => {
        const source = readFileSync('packages/core/src/shared/routes/History.jsx', 'utf8');
        const toggle = source.slice(source.indexOf('phoneFilterToggle}>'), source.indexOf('history.filters.toggle'));
        expect(toggle).toContain('className={styles.toolbarControl}');
        expect(toggle).not.toContain('size="sm"');
    });
});
