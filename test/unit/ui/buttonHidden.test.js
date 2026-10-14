// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Locked screen hides "Forgot password?" with the hidden attribute while
// its panel is open; the button's inline-flex display must not outrank that.
// jsdom applies no stylesheet, so this pins the rule itself.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'ui', 'Button.module.css'),
    'utf8',
);

describe('Button hidden attribute', () => {
    it('lets the hidden attribute remove a button from the layout', () => {
        expect(css).toMatch(/\.btn\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
        expect(css.indexOf('.btn[hidden]')).toBeGreaterThan(css.indexOf('.btn {'));
    });
});
