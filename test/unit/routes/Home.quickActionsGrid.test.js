// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's quick actions used auto-fit columns with a 76px floor, so at 360 the
// gaps pushed four tiles into a 3+1 wrap with "Swap" alone on a second row.
// Above 360 the tiles now share one row of equal tracks; below it they are two
// columns and an odd last tile spans both. jsdom has no layout, so this pins
// the rules.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/routes/Home.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:>]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    return match ? match[2] : '';
}

describe('Home quick actions grid', () => {
    it('lays the tiles in one row of equal columns by default', () => {
        const body = ruleBody('.quickActions');
        expect(body).toMatch(/display:\s*grid/);
        expect(body).toMatch(/grid-auto-flow:\s*column/);
        expect(body).toMatch(/grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
        expect(body).not.toMatch(/auto-fit|auto-fill/);
    });

    it('goes two columns below 360 and spans an odd last tile', () => {
        expect(css).toMatch(/@media not all and \(min-width: 360px\)\s*\{\s*\.quickActions\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
        expect(css).toMatch(/\.quickActions > :last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*1 \/ -1/);
    });
});
