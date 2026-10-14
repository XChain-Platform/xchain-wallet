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
