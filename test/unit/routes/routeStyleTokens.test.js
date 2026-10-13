// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRouteCss = (name) => readFileSync(
    `packages/core/src/shared/routes/${name}.module.css`,
    'utf8',
);

describe('route styles use the shared geometry tokens', () => {
    it('keeps Settings free of route-owned page gutters', () => {
        const css = readRouteCss('Settings');

        expect(css).not.toMatch(/padding(?:-inline|-left|-right)?:\s*\d+px/);
        expect(css).not.toContain('var(--xc-page-gutter)');
    });

    it('tokens stake chooser control and icon sizes', () => {
        const css = readRouteCss('StakeNew');

        expect(css).toMatch(/\.optionIcon\s*\{[^}]*width:\s*var\(--xc-control-h-md\);[^}]*height:\s*var\(--xc-control-h-md\)/s);
        expect(css).toMatch(/\.chainIcon\s*\{[^}]*width:\s*var\(--xc-icon-xl\);[^}]*height:\s*var\(--xc-icon-xl\)/s);
    });

    it('tokens staking list icons, controls, spacing, radii, and ring', () => {
        const css = readRouteCss('StakingList');

        expect(css).toMatch(/\.iconWrap\s*\{[^}]*width:\s*var\(--xc-control-h-lg\);[^}]*height:\s*var\(--xc-control-h-lg\)/s);
        expect(css).toMatch(/\.chainOverlay\s*\{[^}]*width:\s*var\(--xc-icon-lg\);[^}]*height:\s*var\(--xc-icon-lg\)[^}]*box-shadow:\s*var\(--xc-shadow-surface-ring\)/s);
        expect(css).toMatch(/\.addBtn\s*\{[^}]*width:\s*var\(--xc-control-h-md\);[^}]*height:\s*var\(--xc-control-h-md\)/s);
        expect(css).toMatch(/\.status\s*\{[^}]*border-radius:\s*var\(--xc-radius-pill\)/s);
        expect(css).toMatch(/\.claimable\s*\{[^}]*gap:\s*var\(--xc-space-3\);[^}]*padding:\s*var\(--xc-space-3\);[^}]*margin-bottom:\s*var\(--xc-space-3\);[^}]*border-radius:\s*var\(--xc-radius-md\)/s);
    });

    it('documents untokenized route-specific measurements', () => {
        const wizard = readRouteCss('TokenWizard');
        const unavailable = readRouteCss('VaultUnavailable');

        expect(wizard).toMatch(/\/\* The fixed measure[^*]+\*\/\s*max-width:\s*560px/);
        expect(wizard).toMatch(/\/\* The native checkbox[^*]+\*\/\s*margin-top:\s*3px/);
        expect(unavailable).toMatch(/\/\* The underline[^*]+\*\/\s*text-underline-offset:\s*3px/);
        expect(unavailable).toMatch(/\/\* The focus outline[^*]+\*\/\s*outline-offset:\s*2px/);
    });
});
