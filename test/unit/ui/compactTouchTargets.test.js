// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Compact pills keep their 24px painted size and the --xc-tap-min pointer
// floor, and on a touch screen add a transparent 44px layer, the Button .sm
// pattern. An Android crawl measured the chart range chips and the fee tier
// labels at about 24px tall with nothing larger around them.

function coarseBlock(css) {
    const start = css.indexOf('@media (pointer: coarse), (hover: none)');
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('\n}\n', start));
}

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    expect(match, selector).not.toBeNull();
    return match[1];
}

describe('compact touch targets', () => {
    it.each([
        ['chart range chips', 'packages/core/src/shared/components/PortfolioChart.module.css', '.range'],
        ['fee tier labels', 'packages/core/src/ui/FeeSelector.module.css', '.sliderTick'],
    ])('%s keep the tap-min floor and gain a 44px touch layer', (_name, path, selector) => {
        const css = readFileSync(path, 'utf8');
        const base = rule(css, selector);
        expect(base).toMatch(/min-height:\s*var\(--xc-tap-min\)/);
        expect(base).toMatch(/position:\s*(relative|absolute)/);

        const layer = coarseBlock(css).match(new RegExp(`\\${selector}::before\\s*\\{([^}]*)\\}`));
        expect(layer).not.toBeNull();
        expect(layer[1]).toMatch(/content:\s*''/);
        expect(layer[1]).toMatch(/position:\s*absolute/);
        expect(layer[1]).toMatch(/width:\s*max\(100%,\s*var\(--xc-control-hit-min/);
        expect(layer[1]).toMatch(/height:\s*max\([^;]*var\(--xc-control-hit-min/);
    });

    it('resolves the touch layer to 44px only on a coarse pointer', () => {
        const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
        expect(tokens).toMatch(/--xc-control-hit-min:\s*24px/);
        expect(coarseBlock(tokens.slice(tokens.indexOf('--xc-control-h-md: 44px') - 200)))
            .toMatch(/--xc-control-hit-min:\s*44px/);
    });

    it('keeps the range layer inside the chart card padding', () => {
        const css = readFileSync('packages/core/src/shared/components/PortfolioChart.module.css', 'utf8');
        // The card clips overflow; the layer ends at its bottom padding and
        // grows upward instead of being cut short below the chips.
        expect(rule(css, '.wrap')).toMatch(/overflow:\s*hidden/);
        // The wrap is the shared card, whose padding (--xc-card-pad) is never
        // under --xc-space-2, so the layer below the chips stays inside it.
        expect(rule(css, '.wrap')).toMatch(/composes:\s*card from '\.\.\/\.\.\/ui\/Card\.module\.css'/);
        const layer = coarseBlock(css).match(/\.range::before\s*\{([^}]*)\}/)[1];
        expect(layer).toMatch(/inset-block-end:\s*calc\(-1 \* var\(--xc-space-2\)\)/);
    });
});
