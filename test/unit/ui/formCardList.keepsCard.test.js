// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/ui/Card.module.css', 'utf8');

// The wide form card flattens padded section cards only. A list (a flush card)
// inside it keeps its radius, border and background at 360, 820 and 1440.
describe('form card flattening', () => {
    const block = css.slice(css.indexOf('@media (min-width: 600px)'));
    const media = block.slice(0, block.indexOf('\n}\n') + 3);

    it('flattens only the padded card inside a wide form card', () => {
        expect(media).toMatch(/\.formCard:not\(\.cardless\) \.card\s*\{/);
    });

    it('never flattens a flush list card inside a form card', () => {
        expect(media).not.toContain('.flush');
    });

    it('keeps the border, radius and fill on the flush list surface', () => {
        const base = css.match(/\n\.flush\s*\{([^}]*)\}/);
        expect(base).not.toBeNull();
        expect(base[1]).toMatch(/border:\s*var\(--xc-card-border\)/);
        expect(base[1]).toMatch(/border-radius:\s*var\(--xc-card-radius\)/);
        expect(base[1]).toMatch(/background:\s*var\(--xc-card-bg\)/);
    });
});
