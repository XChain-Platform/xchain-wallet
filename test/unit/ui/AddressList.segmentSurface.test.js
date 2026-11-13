// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'routes', 'AddressList.jsx'), 'utf8');
const css = readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'routes', 'AddressList.module.css'), 'utf8');

describe('address type tabs', () => {
    it('picks the address type from the shared IconSelect in the title-bar filter panel', () => {
        expect(source).toMatch(/<ListFilterMenu[\s\S]*?<IconSelect\s+[\s\S]*?aria-label=\{t\('routes\.addressList\.filterByAddressType'\)\}/);
        expect(source).not.toMatch(/<Tabs\b/);
        expect(source).toMatch(/value=\{sourceFilter\}/);
        expect(source).toMatch(/onChange=\{setSourceFilter\}/);
    });

    it('does not retain the boxed segmented-control styles', () => {
        expect(css).not.toMatch(/\.segmented\s*\{/);
        expect(css).not.toMatch(/\.segmentActive\s*\{/);
    });
});
