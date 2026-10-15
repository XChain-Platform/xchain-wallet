// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Activity row context line', () => {
    it('spaces the badge, link mark and counterparty', () => {
        const css = readFileSync('packages/core/src/shared/components/ActivityRow.module.css', 'utf8');
        expect(css).toMatch(/\.context\s*\{[^}]*display:\s*flex[^}]*gap:\s*var\(--xc-space-1\)/s);
        expect(css).toMatch(/\.context > :last-child\s*\{[^}]*text-overflow:\s*ellipsis/s);
    });
});
