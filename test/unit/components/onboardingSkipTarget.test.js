// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The first onboarding screen's Skip was 24px tall with no touch hit area,
// the smallest target on the screen. It keeps its quiet text look but takes
// a kit control's size and, on a touch screen, a kit Button's hit area.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('onboarding Skip target', () => {
    const css = readFileSync('packages/core/src/shared/routes/OnboardingCarousel.module.css', 'utf8');
    const rule = (selector) => css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] || '';

    it('sizes Skip from the control scale, above the tap floor', () => {
        const skip = rule('.skipBtn');
        expect(skip).toMatch(/min-block-size:\s*var\(--xc-tap-min\)/);
        expect(skip).toMatch(/min-height:\s*max\(var\(--xc-tap-min\),\s*var\(--xc-control-h-sm\)\)/);
        expect(skip).toMatch(/position:\s*relative/);
    });

    it('gives Skip the touch hit area a kit Button has', () => {
        const coarse = css.slice(css.indexOf('@media (pointer: coarse), (hover: none)'));
        expect(coarse).toMatch(/\.skipBtn::before\s*\{[^}]*width:\s*max\(100%,\s*var\(--xc-control-hit-min/);
        expect(coarse).toMatch(/\.skipBtn::before\s*\{[^}]*height:\s*max\(100%,\s*var\(--xc-control-hit-min/);
    });
});
