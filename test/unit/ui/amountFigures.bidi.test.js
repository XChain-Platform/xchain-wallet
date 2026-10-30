// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An amount that starts with a digit or a sign reorders on a right-to-left
// page: "≈ $11,728.39" and "-2.10%" print with the number or sign on the wrong
// side of their unit. The inline figures below carry their own left-to-right
// isolate so the page direction cannot move a sign or a currency symbol.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(join(process.cwd(), 'packages/core/src', path), 'utf8');

function cssBlock(source, selector) {
    const match = source.match(new RegExp(`(?:^|\\n)\\.${selector}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : '';
}

describe('inline amount figures isolate their direction', () => {
    for (const [file, selector] of [
        ['shared/routes/TokenDetail.module.css', 'balanceHeroAmountFitInner'],
        ['ui/FeeSelector.module.css', 'sliderReadoutFiat'],
        ['shared/routes/StakingList.module.css', 'rewardChip'],
    ]) {
        it(`${selector} reads left to right`, () => {
            const block = cssBlock(read(file), selector);
            expect(block, `${selector} rule in ${file}`).not.toBe('');
            expect(block).toMatch(/direction:\s*ltr/);
            expect(block).toMatch(/unicode-bidi:\s*isolate/);
        });
    }

    it('the market row change figure reads left to right', () => {
        const source = read('shared/routes/MarketsList.jsx');
        const style = source.slice(source.indexOf('aria-label={changeDisplay ?'));
        const block = style.slice(0, style.indexOf('}}'));
        expect(block).toMatch(/direction:\s*'ltr'/);
        expect(block).toMatch(/unicodeBidi:\s*'isolate'/);
    });
});
