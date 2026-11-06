// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The chart range chips (24h, 7d) stay compact on every shell. A touch screen
// grows only the transparent hit layer to 44px; the painted chip keeps its
// 28px height and the extra-small label size, as the Send, Receive, Exchange
// and Swap actions set the scale for the larger controls.

const CSS_PATH = 'packages/core/src/shared/components/PortfolioChart.module.css';
const TOKENS_PATH = 'packages/core/src/ui/tokens.css';
const COARSE = '@media (pointer: coarse), (hover: none)';

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    expect(match, selector).not.toBeNull();
    return match[1];
}

// Every coarse-pointer block in a stylesheet, joined, so a token or layer
// declared in any of them is found.
function coarseBlocks(css) {
    const blocks = [];
    let start = css.indexOf(COARSE);
    while (start > -1) {
        blocks.push(css.slice(start, css.indexOf('\n}\n', start)));
        start = css.indexOf(COARSE, start + COARSE.length);
    }
    expect(blocks.length).toBeGreaterThan(0);
    return blocks.join('\n');
}

describe('chart range chips use a compact size', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const chip = rule(css, '.range');

    it('does not take the touch-scaled small control height or font', () => {
        // --xc-control-h-sm is 36px and --xc-control-font-sm is 1rem on touch.
        expect(chip).not.toMatch(/--xc-control-h-sm/);
        expect(chip).not.toMatch(/--xc-control-font-sm/);
    });

    it('labels at the extra-small text size', () => {
        expect(chip).toMatch(/(?:^|[\s;])font-size:\s*var\(--xc-text-xs\);/);
    });

    it('paints a 28px height that does not scale on touch', () => {
        const height = chip.match(/(?:^|[\s;])height:\s*([^;]+);/);
        expect(height).not.toBeNull();
        expect(height[1].trim()).toMatch(
            /^(28px|calc\(var\(--xc-space-6\) \+ var\(--xc-space-1\)\))$/,
        );
        // The spacing tokens behind the calc resolve to 24px and 4px and have
        // no touch override, so the painted height is 28px on every shell.
        const tokens = readFileSync(TOKENS_PATH, 'utf8');
        expect(tokens).toMatch(/--xc-space-6:\s*24px/);
        expect(tokens).toMatch(/--xc-space-1:\s*4px/);
        expect(coarseBlocks(tokens)).not.toMatch(/--xc-space-[16]:/);
    });

    it('keeps the 24px pointer floor', () => {
        expect(chip).toMatch(/min-height:\s*var\(--xc-tap-min\)/);
    });

    it('keeps the 44px touch layer on a coarse pointer', () => {
        const layer = coarseBlocks(css).match(/\.range::before\s*\{([^}]*)\}/);
        expect(layer).not.toBeNull();
        expect(layer[1]).toMatch(/width:\s*max\(100%,\s*var\(--xc-control-hit-min\)\)/);
        expect(layer[1]).toMatch(/height:\s*max\([^;]*var\(--xc-control-hit-min\)\)/);
    });

    it('leaves the shared touch tokens at their sizes', () => {
        const coarse = coarseBlocks(readFileSync(TOKENS_PATH, 'utf8'));
        expect(coarse).toMatch(/--xc-control-h-sm:\s*36px/);
        expect(coarse).toMatch(/--xc-control-font-sm:\s*1rem/);
        expect(coarse).toMatch(/--xc-control-hit-min:\s*44px/);
    });
});
