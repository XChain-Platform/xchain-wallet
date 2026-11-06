// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screenCss = readFileSync('packages/core/src/ui/Screen.module.css', 'utf8');
const overlayCss = readFileSync(
    'packages/core/src/shared/components/OverlaySurface.module.css',
    'utf8',
);
const coarseSheetBody = overlayCss.match(
    /@media\s*\(pointer:\s*coarse\)\s*\{\s*\.sheet\s+\.body\s*\{([^}]*)\}/s,
)?.[1] ?? '';

describe('sheet scrollbar clearance', () => {
    it('composes the shared scroll area for the sheet body', () => {
        expect(screenCss).toMatch(/\.scrollArea\s*\{[^}]*scrollbar-gutter:\s*stable/s);
        expect(overlayCss).toMatch(/\.body\s*\{[^}]*composes:\s*scrollArea\b/s);
    });

    it('reserves non-zero token clearance for coarse-pointer scrollbars', () => {
        expect(coarseSheetBody).toMatch(
            /padding-inline-end:\s*var\(--xc-space-(?!0\b)[A-Za-z0-9-]+\)\s*;/,
        );
    });

    it('does not override the body gutter or clearance with zero', () => {
        expect(coarseSheetBody).not.toMatch(/scrollbar-gutter\s*:/);
        expect(coarseSheetBody).not.toMatch(
            /padding-inline-end\s*:\s*(?:0(?:[a-z%]+)?\b|var\(--xc-space-0\))\s*;/i,
        );
    });
});
