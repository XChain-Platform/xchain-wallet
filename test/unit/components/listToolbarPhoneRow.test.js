// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The search box and the type dropdown stay on one row at phone widths. jsdom
// has no layout, so the test pins the rules that decide it.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/components/ListToolbar.module.css'),
    'utf8',
);
const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
};

describe('ListToolbar at phone width', () => {
    it('shrinks the search box and keeps the dropdown at its intrinsic width', () => {
        expect(block('.search')).toMatch(/flex:\s*1 1 9rem/);
        expect(block('.search')).toMatch(/min-width:\s*0/);
        expect(block('.filter')).toMatch(/flex:\s*0 1 auto/);
        expect(block('.filter')).toMatch(/min-width:\s*0/);
    });

    it('never forces the dropdown onto its own line', () => {
        expect(css).not.toMatch(/flex-basis:\s*100%/);
        expect(css).not.toMatch(/flex:\s*1 1 100%/);
        expect(css).not.toMatch(/grid-column/);
        expect(css).not.toMatch(/@media|@container/);
        expect(block('.filter')).not.toMatch(/(?:^|[\s;])(?:width|inline-size):\s*100%/);
    });

    it('still wraps as a fallback when the dropdown and a usable search box cannot fit', () => {
        expect(block('.toolbar')).toMatch(/flex-wrap:\s*wrap/);
        expect(block('.filter')).toMatch(/max-inline-size:\s*100%/);
    });
});
