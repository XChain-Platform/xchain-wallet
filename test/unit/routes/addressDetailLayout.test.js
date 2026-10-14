// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Layout guards for the View address screen. jsdom lays nothing out, so these
// read the stylesheet rules that a 360 px screenshot showed going wrong.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const css = read('packages/core/src/shared/routes/AddressList.module.css');

function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
}

describe('View address label editor', () => {
    it('lets the Save button grow to its label instead of breaking it per letter', () => {
        const save = rule('.labelRow > :last-child');
        // A fixed quarter-width basis was narrower than icon plus "Save" on a
        // phone, and the kit's overflow-wrap broke the word one letter a line.
        expect(save).toMatch(/flex:\s*0 0 auto/);
        expect(save).toMatch(/min-width:\s*calc\(/);
        expect(rule('.labelRow > :last-child > span')).toMatch(/white-space:\s*nowrap/);
    });
});

describe('View address copy row', () => {
    it('keeps a gap between the address and its Copy button', () => {
        const row = rule('.detailAddr');
        expect(row).toMatch(/display:\s*flex/);
        expect(row).toMatch(/flex-wrap:\s*wrap/);
        expect(row).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(rule('.detailAddr > :first-child')).toMatch(/min-width:\s*0/);
    });
});

describe('View address quick actions', () => {
    it('keeps up to five tiles on one row at a 360 px phone', () => {
        expect(rule('.quickActions')).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(56px,\s*1fr\)\)/);
    });
});
