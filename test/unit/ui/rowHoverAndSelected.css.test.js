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
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');

// Every list row hovers with the one shared fill, and a selected row in a
// master-detail layout reads like the side menu's active item (brand tint and
// leading bar, no border).
describe('list row hover and selected styles', () => {
    it('hovers the kit row with the shared hover token only', () => {
        const css = read('packages/core/src/ui/ListRow.module.css');
        const hover = css.slice(css.indexOf('@media (hover: hover)'), css.indexOf('.interactive:active'));
        expect(hover).toMatch(/background:\s*var\(--xc-control-bg-hover\)/);
        expect(hover).not.toMatch(/accent|box-shadow|border|outline/);
    });

    it('gives Home rows no hover rule of their own', () => {
        const css = read('packages/core/src/shared/components/BalanceList.module.css');
        expect(css).not.toMatch(/\.row(?:Content|Clickable|Pinned)?:hover/);
    });

    it('hovers a DEX market row with the standard fill, not a ring', () => {
        const css = read('packages/core/src/shared/routes/MarketsList.module.css');
        const rule = css.match(/\.row:not\(\[data-selected='true'\]\):has\(\.marketButton:hover:not\(:disabled\)\)\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/background:\s*var\(--xc-control-bg-hover\)/);
        expect(rule[1]).not.toMatch(/box-shadow/);
        expect(css).toMatch(/\.row \.marketButton:is\(:hover, :active\):not\(:disabled\)\s*\{[^}]*box-shadow:\s*none/);
    });

    it('marks the selected DEX row like the side menu, with no border or ring', () => {
        const css = read('packages/core/src/shared/routes/MarketsList.module.css');
        const rule = css.match(/\.row\[data-selected='true'\]\s*\{([^}]*)\}/);
        expect(rule[1]).toMatch(/background:\s*var\(--xc-row-active-bg\)/);
        expect(rule[1]).toMatch(/box-shadow:\s*var\(--xc-shadow-nav-indicator\)/);
        expect(rule[1]).not.toMatch(/border|outline|0 0 0/);
        const nav = read('packages/core/src/shared/components/LeftNav.module.css');
        expect(nav).toMatch(/\.nav \.itemActive[\s\S]*background:\s*var\(--xc-row-active-bg\)/);
    });

    it('keeps the focus ring to keyboard focus', () => {
        const css = read('packages/core/src/ui/ListRow.module.css');
        expect(css).toMatch(/\.interactive:focus-visible\s*\{/);
        expect(css).not.toMatch(/\.interactive:focus\s*\{/);
        expect(read('packages/core/src/shared/routes/MarketsList.module.css')).not.toMatch(/\.(?:row|marketButton)[^{]*:focus\s*\{/);
    });

    it('marks the selected wide History row with the shared split-list tint', () => {
        const css = read('packages/core/src/shared/routes/History.module.css');
        const rule = css.match(/\n\.row\.row\[data-xc-split-row\]\[aria-current='true'\]\s*\{([^}]*)\}/);
        expect(rule[1]).toMatch(/background:\s*var\(--xc-row-active-bg\)/);
        expect(rule[1]).toMatch(/box-shadow:\s*none/);
    });
});
