// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('TotalBalanceHero amount face', () => {
    const css = readFileSync('packages/core/src/shared/components/TotalBalanceHero.module.css', 'utf8');
    const rule = css.match(/\.amount\s*\{[^}]*\}/s)[0];

    it('uses a proportional face so separators take no digit cell', () => {
        expect(rule).not.toMatch(/xc-font-mono/);
        expect(rule).toMatch(/font-family:\s*var\(--xc-font-sans\)/);
    });

    it('keeps digits aligned with tabular numerals', () => {
        expect(rule).toMatch(/font-variant-numeric:\s*tabular-nums/);
    });
});
