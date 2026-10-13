// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every native or custom interactive control keeps the shared focus ring even
// when a component resets the browser outline.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../packages/core/src/ui/tokens.css'), 'utf8');

describe('base focus ring', () => {
    it('covers native and custom controls with the theme token', () => {
        const rule = /:where\(([\s\S]*?)\):focus-visible\s*\{([^}]*)\}/.exec(css);
        expect(rule).not.toBeNull();
        for (const selector of [
            'a[href]',
            'audio[controls]',
            'button',
            'input',
            'select',
            'textarea',
            "[role='button']",
            "[role='link']",
            "[role='tab']",
            "[tabindex]:not([tabindex='-1'])",
            "[contenteditable]:not([contenteditable='false'])",
        ]) {
            expect(rule[1]).toContain(selector);
        }
        expect(rule[2]).toMatch(/outline:\s*2px solid var\(--xc-focus-ring\) !important/);
        expect(rule[2]).toMatch(/outline-offset:\s*-2px !important/);
    });

    it('defines a high-contrast token for the light and both dark theme paths', () => {
        expect(css).toMatch(/:root\s*\{[\s\S]*?--xc-focus-ring:\s*#0F172A;/);
        expect(css.match(/--xc-focus-ring:\s*#FFFFFF;/g)).toHaveLength(2);
    });
});
