// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ListPage notice spacing', () => {
    it('spaces notice rows by the section gap alone, with no extra row margin', () => {
        const css = readFileSync('packages/core/src/ui/ListPage.module.css', 'utf8');
        expect(css).toMatch(/\.page > \[data-variant\]\s*\{[^}]*margin:\s*0/s);
    });
});
