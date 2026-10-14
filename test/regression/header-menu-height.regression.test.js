// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: header overflow menu height.
//
//   2026-10-14: the header overflow menu was capped at 520px, so on tall
//   phones it cut its last visible row ("Validator hub") through the label
//   while hundreds of pixels sat empty below it. The menu is now bounded by
//   the viewport alone.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const core = join(here, '..', '..', 'packages', 'core', 'src');
const headerCss = readFileSync(join(core, 'shared', 'components', 'AppHeader.module.css'), 'utf8');

function ruleBody(css, selector) {
    const match = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : '';
}

describe('header overflow menu height', () => {
    it('is bounded by the viewport, not a fixed pixel cap', () => {
        const body = ruleBody(headerCss, '.actionMenu');
        const maxHeight = body.match(/max-height:\s*([^;]+);/);
        expect(maxHeight).not.toBeNull();
        expect(maxHeight[1]).toMatch(/vh/);
        expect(maxHeight[1]).not.toMatch(/\d+px/);
        expect(body).toMatch(/overflow-y:\s*auto/);
    });
});
