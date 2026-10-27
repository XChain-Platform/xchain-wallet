// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: text inside inputs and selects follows the text-size
// setting.
//
//   [P2] 2026-10-24: at the 1.5 text size (root font 24px) labels grew to
//        19.5px while the text inside inputs and selects stayed at the 14px
//        control token. Fix: the control font tokens point at the rem-based
//        type tokens, so a control reads at the same ratio as a label at
//        every text size.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, '..', '..', 'packages', 'core', 'src', 'ui', 'tokens.css'), 'utf8');

function declared(name) {
    const match = tokens.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'));
    return match ? match[1].trim() : null;
}

describe('control text size tokens', () => {
    it.each([
        ['--xc-control-font-sm', 'var(--xc-text-sm)'],
        ['--xc-control-font-md', 'var(--xc-text-md)'],
        ['--xc-control-font-lg', 'var(--xc-text-lg)'],
    ])('%s reads the %s type token', (name, expected) => {
        expect(declared(name)).toBe(expected);
    });

    it('the type tokens it reads are rem sizes that scale with the root font', () => {
        for (const name of ['--xc-text-sm', '--xc-text-md', '--xc-text-lg']) {
            expect(declared(name), name).toMatch(/^[\d.]+rem$/);
        }
    });
});
