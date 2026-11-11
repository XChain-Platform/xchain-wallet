// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: wallet menu height.
//
//   2026-10-14: the header overflow menu was capped at 520px, so on tall
//   phones it cut its last visible row through the label while hundreds of
//   pixels sat empty below it. The wallet menu that replaced it is bounded by
//   the viewport alone: a full-height sheet on a phone, and a dropdown whose
//   height is the viewport minus the app bar at wider widths.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const core = join(here, '..', '..', 'packages', 'core', 'src');
const paletteCss = readFileSync(join(core, 'shared', 'commandPalette', 'CommandPalette.module.css'), 'utf8');

function ruleBody(css, selector) {
    const match = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : '';
}

describe('wallet menu height', () => {
    it('is bounded by the viewport, not a fixed pixel cap', () => {
        const panel = ruleBody(paletteCss, '.panel.menuPanel');
        expect(panel).toMatch(/max-block-size:\s*var\(--xc-viewport-h/);
        expect(panel).not.toMatch(/(?:max-)?block-size:\s*\d+px/);

        const dropdown = paletteCss.match(/@container wallet-menu \(min-width: 640px\) \{[\s\S]*?\.panel\.menuPanel \{([^}]*)\}/);
        expect(dropdown).not.toBeNull();
        expect(dropdown[1]).toMatch(/max-block-size:\s*calc\(var\(--xc-viewport-h/);
        expect(dropdown[1]).not.toMatch(/max-block-size:[^;]*\d+px/);

        expect(ruleBody(paletteCss, '.walletSurface')).toMatch(/overflow-y:\s*auto/);
    });
});
