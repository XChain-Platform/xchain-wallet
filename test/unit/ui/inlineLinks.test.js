// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'packages/core/src/ui/tokens.css'), 'utf8');

describe('shared inline link styles', () => {
    it('uses a non-color cue and a theme-aware color for every anchor', () => {
        const body = /:where\(a\[href\]\)\s*\{([^}]*)\}/.exec(css)?.[1];

        expect(body).toBeTruthy();
        expect(body).toMatch(/color:\s*var\(--xc-accent-text\)/);
        expect(body).toMatch(/text-decoration:\s*underline/);
        expect(body).toMatch(/text-underline-offset:\s*0\.15em/);
    });

    it('keeps visited links recognizable and keyboard focus visible', () => {
        expect(css).toMatch(
            /:where\(a\[href\]:visited\)\s*\{[^}]*color:\s*var\(--xc-accent-text\)/s,
        );
        expect(css).toMatch(
            /:where\([\s\S]*?a\[href\][\s\S]*?\):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--xc-focus-ring\) !important/s,
        );
    });
});
