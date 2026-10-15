// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Dispenser detail's Actions grid used auto-fit columns with a 64px floor,
// so a 360px phone fit four tiles and left "More" alone on a second row.
// The grid now lays every action in one row of equal columns, whatever the
// width or the number of actions. jsdom has no layout, so this pins the rule.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readCss(path) {
    return readFileSync(join(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    return match ? match[2] : '';
}

describe('Dispenser detail Actions grid', () => {
    it('keeps every action tile in one row of equal columns', () => {
        const css = readCss('packages/core/src/shared/routes/DispenserDetail.module.css');
        const body = ruleBody(css, '.quickActions');
        expect(body).toMatch(/display:\s*grid/);
        expect(body).toMatch(/grid-auto-flow:\s*column/);
        expect(body).toMatch(/grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
        // A width-driven column count is what stranded a tile on its own row.
        expect(body).not.toMatch(/auto-fit|auto-fill/);
        expect(css).not.toMatch(/\.quickActions\s*\{[^}]*grid-template-columns/);
    });
});
