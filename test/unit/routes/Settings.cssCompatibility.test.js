// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/routes/Settings.module.css', 'utf8');

describe('Settings CSS compatibility', () => {
    it('does not require relational-selector support for narrow rows', () => {
        expect(css).not.toContain(':has(');
        expect(css).not.toContain('@supports selector');
        expect(css).toMatch(/\.page div\s*\{[\s\S]*?flex-wrap:\s*wrap !important;/);
    });

    it('keeps controls fluid inside the narrow-screen fallback', () => {
        expect(css).toMatch(/\.page :is\([\s\S]*?select,[\s\S]*?input:not/);
        expect(css).toContain('flex: 1 1 100% !important;');
        expect(css).toContain('width: 100% !important;');
        expect(css).toMatch(/\.page div\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
    });
});
