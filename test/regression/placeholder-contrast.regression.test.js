// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: placeholder contrast.
//
//   [P2] 2026-10-24: field placeholders kept the browser's fixed translucent
//        gray, 3.7:1 on the dark theme's field surface. Every input and
//        textarea takes the muted text token, which both themes keep above
//        4.5:1, at full opacity.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', '..', 'packages', 'core', 'src', 'ui', 'tokens.css'), 'utf8');

describe('regression/placeholder-contrast', () => {
    it('[REGRESSION P2] input and textarea placeholders use the muted text token at full opacity', () => {
        const rule = postcss.parse(css).nodes.find((node) => node.type === 'rule'
            && node.selectors.includes('input::placeholder') && node.selectors.includes('textarea::placeholder'));
        expect(rule, 'global placeholder rule').toBeTruthy();
        const decls = Object.fromEntries(rule.nodes.filter((n) => n.type === 'decl').map((n) => [n.prop, n.value]));
        expect(decls).toEqual({ color: 'var(--xc-text-muted)', opacity: '1' });
    });
});
