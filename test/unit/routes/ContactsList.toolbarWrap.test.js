// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// At phone width the sort control drops to its own row so the network filter
// keeps room for its full "All Networks" label. ListPage owns the wrapping
// toolbar while this route owns the sort breakpoint.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/ContactsList.module.css'),
    'utf8',
);
const listPageCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/ui/ListPage.module.css'),
    'utf8',
);

describe('ContactsList toolbar at phone width', () => {
    it('lets the toolbar wrap', () => {
        const rule = listPageCss.match(/\.toolbar\s*\{[^}]*\}/)[0];
        expect(rule).toMatch(/flex-wrap:\s*wrap/);
    });

    it('gives the sort control its own row at 420px and below', () => {
        const media = css.match(/@media \(max-width: 420px\)\s*\{[^}]*\{[^}]*\}\s*\}/)[0];
        expect(media).toMatch(/\.sort\s*\{[^}]*flex:\s*1 1 100%/);
    });
});
