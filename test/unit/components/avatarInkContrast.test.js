// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A filled avatar's letters take white or black by the tone's luminance
// (WalletIdentity.module.css). White text on a tone that brightens in the dark
// theme (success #4ADE80, warning #F59E0B) read under 4.5:1. jsdom cannot
// resolve relative colour, so this pins the rule in the stylesheet and checks
// that the rule clears AA for every hex tone an avatar can draw: the wallet
// tones in every theme block of tokens.css and the ticker palette.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

const THRESHOLD = 0.1791;

function luminance(hex) {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// The stylesheet's pick: white under the threshold, black from it up.
const inkFor = (y) => (y < THRESHOLD ? 1 : 0);

describe('avatar ink', () => {
    it('picks white or black in the stylesheet by the tone luminance, ahead of forced colours', () => {
        const css = read('packages/core/src/shared/components/WalletIdentity.module.css');
        const rule = css.indexOf('--xc-avatar-ink: color(from var(--xc-avatar-tone) xyz-d65');
        expect(rule).toBeGreaterThan(-1);
        expect(css.slice(rule, css.indexOf(';', rule)).match(/\(0\.1791 - y\)/g)).toHaveLength(3);
        expect(css.indexOf('--xc-avatar-ink: CanvasText;')).toBeGreaterThan(rule);
        expect(read('packages/core/src/shared/components/WalletIdentity.jsx'))
            .toContain("'var(--xc-avatar-ink, var(--xc-on-accent))'");
    });

    it('sits at the luminance where white and black read alike', () => {
        expect(contrast(THRESHOLD, 1)).toBeCloseTo(contrast(THRESHOLD, 0), 2);
        expect(contrast(THRESHOLD, 1)).toBeGreaterThan(4.5);
    });

    it('clears 4.5:1 on every wallet tone in every theme and on the ticker palette', () => {
        const tokens = read('packages/core/src/ui/tokens.css');
        const themeTones = [...tokens.matchAll(/--xc-(?:accent-primary|success|warning|danger):\s*(#[0-9A-Fa-f]{3,6})\b/g)]
            .map((match) => match[1]);
        const palette = read('packages/core/src/ui/AssetMark.jsx').match(/const PALETTE = \[([\s\S]*?)\];/)[1]
            .match(/#[0-9A-Fa-f]{6}/g);
        expect(themeTones.length).toBeGreaterThanOrEqual(12);
        expect(palette.length).toBeGreaterThanOrEqual(15);
        for (const tone of [...themeTones, ...palette]) {
            const y = luminance(tone);
            expect(contrast(y, inkFor(y)), `${tone} letters`).toBeGreaterThanOrEqual(4.5);
        }
    });
});
