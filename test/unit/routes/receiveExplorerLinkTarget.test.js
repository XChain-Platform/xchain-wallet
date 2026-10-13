// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Receive's "View address on explorer" link sits in the QR action row. In a
// row it stretches to the buttons' height, but below 400px the row becomes a
// column and the bare link shrank to its 17px text line, under the 24px
// pointer-target floor (the responsive e2e walk measured 334x17 at 360px).
// The stylesheet sweep only audits rules it can see, so the link must carry
// the class that states the floor.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Receive explorer link pointer target', () => {
    it('the link carries the explorerLink class', () => {
        const src = read('packages/core/src/shared/routes/Receive.jsx');
        const anchor = src.match(/<a\s[^>]*href=\{addressExplorerUrl\}[^>]*>/);
        expect(anchor).not.toBeNull();
        expect(anchor[0]).toMatch(/className=\{styles\.explorerLink\}/);
    });

    it('explorerLink states the 24px floor and is visible to the tap-target sweep', () => {
        const css = read('packages/core/src/shared/routes/Receive.module.css');
        const rule = css.match(/\.explorerLink\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/min-height:\s*var\(--xc-tap-min\)/);
        expect(rule[1]).toMatch(/cursor:\s*pointer/);
    });
});
