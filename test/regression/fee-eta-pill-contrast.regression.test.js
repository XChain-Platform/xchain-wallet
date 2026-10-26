// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: fee ETA pill contrast.
//
//   [P2] 2026-10-24: the Normal-speed ETA pill drew the warning accent on a
//        tint of itself, 4.49:1 in the light theme. It uses the warning text
//        token, which clears 4.5:1 in both themes.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', '..', 'packages', 'core', 'src', 'ui', 'FeeSelector.module.css'), 'utf8');

describe('regression/fee-eta-pill-contrast', () => {
    it('[REGRESSION P2] the Normal ETA pill text uses the warning text token', () => {
        const rule = postcss.parse(css).nodes.find((n) => n.type === 'rule' && n.selector === '.etaNormal');
        const color = rule.nodes.find((n) => n.type === 'decl' && n.prop === 'color');
        expect(color.value).toBe('var(--xc-warning-text)');
    });
});
