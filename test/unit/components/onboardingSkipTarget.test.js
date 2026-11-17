// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The first onboarding screen's Skip used to sit alone in the top right as a
// 24px text link. It is now one of three equal kit buttons (Back, Skip, Next)
// under the progress dots, so it gets the kit button's size and hit area.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('onboarding Skip target', () => {
    const css = readFileSync('packages/core/src/shared/routes/OnboardingCarousel.module.css', 'utf8');
    const source = readFileSync('packages/core/src/shared/routes/OnboardingCarousel.jsx', 'utf8');
    const rule = (selector) => css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] || '';

    it('has no top-right Skip row or text-link Skip rules left', () => {
        expect(css).not.toMatch(/\.skipRow|\.skipBtn/);
        expect(source).not.toMatch(/skipRow|skipBtn|skipAction/);
    });

    it('lays Back, Skip and Next out as three equal columns with 8px gaps', () => {
        const nav = rule('.nav');
        expect(nav).toMatch(/display:\s*grid/);
        expect(nav).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
        expect(nav).toMatch(/gap:\s*var\(--xc-space-2\)/);
    });
});
