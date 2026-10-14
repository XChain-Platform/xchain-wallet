// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: avatar initials at large text sizes.
//
//   2026-10-14: at the largest iOS Dynamic Type setting (the shell maps it to
//   a 1.5 root scale) the header avatar's two initials grew with the rem
//   scale while its circle stayed 28px, and the circle's overflow clip cut
//   about 4px off each letter. The initials now stop growing at a fraction of
//   the circle.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const core = join(here, '..', '..', 'packages', 'core', 'src');
const tokensCss = readFileSync(join(core, 'ui', 'tokens.css'), 'utf8');

function rootToken(name) {
    const match = tokensCss.match(new RegExp(`${name}:\\s*([^;]+);`));
    return match ? match[1].trim() : null;
}

describe('header avatar initials stay inside their circle', () => {
    for (const context of ['header', 'list']) {
        it(`${context} initials are bounded by the ${context} circle size`, () => {
            const value = rootToken(`--xc-avatar-initials-${context}`);
            expect(value).toMatch(/^min\(/);
            expect(value).toContain(`var(--xc-avatar-size-${context})`);
        });

        it(`${context} circle stays a fixed size`, () => {
            expect(rootToken(`--xc-avatar-size-${context}`)).toMatch(/^\d+px$/);
        });
    }

    it('the bound keeps the default-size initials unchanged', () => {
        // 0.4 x 28px = 11.2px is above the 11px (0.6875rem) default, so only
        // enlarged text is held back.
        expect(rootToken('--xc-avatar-size-header')).toBe('28px');
        expect(rootToken('--xc-text-xs')).toBe('0.6875rem');
        expect(rootToken('--xc-avatar-initials-header')).toContain('* 0.4');
    });
});
