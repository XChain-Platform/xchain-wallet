// Copyright © 2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeCss = Object.fromEntries(
    [
        'ParallelComposer',
        'PollDetail',
        'Receive',
        'ResumeConfirm',
        'Send',
    ].map((route) => [
        route,
        readFileSync(`packages/core/src/shared/routes/${route}.module.css`, 'utf8'),
    ]),
);

function rule(cssText, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return cssText.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

describe('route CSS design tokens', () => {
    it('uses the shared pill radius for pill-shaped route elements', () => {
        expect(rule(routeCss.ParallelComposer, '.statusPill'))
            .toMatch(/border-radius:\s*var\(--xc-radius-pill\)/);
        expect(rule(routeCss.PollDetail, '.resultTrack'))
            .toMatch(/border-radius:\s*var\(--xc-radius-pill\)/);
        expect(rule(routeCss.Send, '.toContactName'))
            .toMatch(/border-radius:\s*var\(--xc-radius-pill\)/);
        expect(rule(routeCss.Send, '.successIcon'))
            .toMatch(/border-radius:\s*var\(--xc-radius-pill\)/);
    });

    it('uses icon tokens for route glyphs covered by the icon scale', () => {
        expect(rule(routeCss.Receive, '.assetChainOverlay').match(
            /(?:width|height):\s*var\(--xc-icon-lg\)/g,
        )).toHaveLength(2);
        expect(rule(routeCss.Receive, '.assetChevron'))
            .toMatch(/font-size:\s*var\(--xc-icon-lg\)/);
        expect(rule(routeCss.Send, '.amountUnitSwap svg').match(
            /(?:width|height):\s*var\(--xc-icon-xs\)/g,
        )).toHaveLength(2);
    });

    it('does not leave token-sized raw pill radii or glyph dimensions', () => {
        for (const css of Object.values(routeCss)) {
            const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
            expect(declarations).not.toMatch(/border-radius:\s*999px/);
            expect(declarations).not.toMatch(
                /(?:width|height|font-size):\s*(?:14|20|24)px/,
            );
        }
    });
});
