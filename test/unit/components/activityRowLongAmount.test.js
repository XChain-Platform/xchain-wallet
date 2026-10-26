// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/components/ActivityRow.module.css', 'utf8');

describe('Activity row with a long amount', () => {
    it('keeps a floor under the label column so the action label always shows', () => {
        expect(css).toMatch(/\.row\s*\{[^}]*grid-template-columns:\s*auto minmax\(\d+(?:\.\d+)?rem,\s*1fr\) auto auto auto/s);
    });

    it('wraps the amount inside its own column instead of squeezing the label', () => {
        const primary = /\.primary\s*\{([^}]*grid-area:\s*primary[^}]*)\}/s.exec(css)?.[1] ?? '';
        expect(primary).toMatch(/white-space:\s*normal/);
        expect(primary).toMatch(/overflow-wrap:\s*anywhere/);
    });
});
