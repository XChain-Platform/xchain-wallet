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

    it('keeps a flush list card nested in a form section or padded card inside any form', () => {
        // Form sections compose flush, so `.flush .flush` would flatten a list
        // inside one (Pair signer's device list) at every width.
        const rule = css.match(/\n\.formCard \.card \.flush,\s*\n\.formCard \.flush \.flush\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/padding:\s*0/);
        expect(rule[1]).toMatch(/background:\s*var\(--xc-card-bg\)/);
        expect(rule[1]).toMatch(/border:\s*var\(--xc-card-border\)/);
        expect(rule[1]).toMatch(/border-radius:\s*var\(--xc-card-radius\)/);
        // It follows the generic nested flattening rule, which it outweighs by one class.
        expect(css.indexOf('.formCard .flush .flush')).toBeGreaterThan(css.search(/\.flush \.flush\s*\{/));
        // Padded cards inside a form still flatten.
        expect(rule[0]).not.toMatch(/\.card\s*\{/);
    });

    it('keeps a preserved nested card inside the wide form card (Link action cards)', () => {
        const rule = media.match(/\.formCard:not\(\.cardless\) \[data-xc-preserve-nested-cards\] \.card\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/padding:\s*var\(--xc-card-pad\)/);
        expect(rule[1]).toMatch(/background:\s*var\(--xc-card-bg\)/);
        expect(rule[1]).toMatch(/border:\s*var\(--xc-card-border\)/);
        expect(rule[1]).toMatch(/border-radius:\s*var\(--xc-card-radius\)/);
        // It comes after the flattening rule in the same block and outweighs it.
        expect(media.indexOf('[data-xc-preserve-nested-cards]'))
            .toBeGreaterThan(media.search(/\.formCard:not\(\.cardless\) \.card\s*\{/));
    });
});
