// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every form control has the app's focus ring even without a style of its
// own, and the base rule never outranks a component's (zero specificity).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../packages/core/src/ui/tokens.css'), 'utf8');

describe('base focus ring', () => {
    it('covers inputs, selects, textareas and buttons at zero specificity', () => {
        const rule = /:where\(input, select, textarea, button\):focus-visible\s*\{([^}]*)\}/.exec(css);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/outline:\s*2px solid var\(--xc-accent-primary\)/);
    });
});
