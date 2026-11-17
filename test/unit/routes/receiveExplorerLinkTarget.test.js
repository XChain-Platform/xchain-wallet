// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Receive's "View address in block explorer" link once shrank to its 17px
// text line below 400px, under the 24px pointer-target floor (the responsive
// e2e walk measured 334x17 at 360px). It is now a row of the QR's ActionList
// (G101), so it takes the kit ListRow's interactive row, whose stylesheet
// states the floor where the sweep can see it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Receive explorer link pointer target', () => {
    it('the link is an ActionList row that opens a new tab', () => {
        const src = read('packages/core/src/shared/routes/Receive.jsx');
        const row = src.split('<ActionListItem').slice(1)
            .map((block) => block.split(/\n\s*\/>/)[0])
            .filter((block) => block.includes('href={addressExplorerUrl}'));
        expect(row).toHaveLength(1);
        expect(row[0]).toMatch(/target="_blank"/);
        expect(row[0]).toMatch(/rel="noopener noreferrer"/);
    });

    it('the interactive row states the 24px floor and is visible to the tap-target sweep', () => {
        const css = read('packages/core/src/ui/ListRow.module.css');
        const rule = css.match(/\.interactive\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/min-height:\s*var\(--xc-control-h-lg, 24px\)/);
        expect(rule[1]).toMatch(/cursor:\s*pointer/);
    });
});
