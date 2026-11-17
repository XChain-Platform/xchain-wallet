// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Manage Token's Details rows sit 8px apart: each row pads 8px top and bottom,
// the card inset is 8px, and a stacked label and value keep a small gap.
// jsdom lays nothing out, so this reads the stylesheet rules.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const css = read('packages/core/src/shared/routes/ManageToken.module.css');
const tokens = read('packages/core/src/ui/tokens.css');

function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
}

describe('Manage Token details row spacing', () => {
    it('pads every row 8px top and bottom', () => {
        expect(tokens).toMatch(/--xc-space-2:\s*8px;/);
        expect(rule('.approvedDetailRow')).toMatch(/padding:\s*var\(--xc-space-2\) 0;/);
    });

    it('keeps the card inset at 8px', () => {
        expect(tokens).toContain('--xc-card-pad: var(--xc-space-2);');
        expect(rule('.approvedDetailsCard')).toMatch(/composes:\s*card from/);
    });

    it('keeps a small row gap when label and value stack', () => {
        expect(rule('.approvedDetailRow')).toMatch(/gap:\s*var\(--xc-space-1\) var\(--xc-space-3\);/);
    });
});
