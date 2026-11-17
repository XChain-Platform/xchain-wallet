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

const source = readFileSync(
    'packages/core/src/shared/commandPalette/CommandPalette.module.css',
    'utf8',
);
const appHeaderSource = readFileSync(
    'packages/core/src/shared/components/AppHeader.module.css',
    'utf8',
);
const tokensSource = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

describe('wallet menu CSS layout contracts', () => {
    it('floats the four-column sheet inset by the gutter and caps it at the four-column width', () => {
        const wide = source.slice(source.indexOf('@container wallet-menu (min-width: 800px)'));
        const panel = wide.match(/\.panel\.menuPanel\s*\{([^}]*)\}/)[1];
        // The four-column width is the iPad's 834px less a gutter on each side.
        expect(panel).toMatch(/--xc-wallet-menu-four-col-w:\s*calc\(834px - \(2 \* var\(--xc-page-gutter\)\)\);/);
        // Never wider than that token at 834 and above; narrower containers inset by the gutter.
        expect(panel).toMatch(/max-inline-size:\s*var\(--xc-wallet-menu-four-col-w\);/);
        expect(panel).toMatch(/inline-size:\s*min\(var\(--xc-wallet-menu-four-col-w\), calc\(100cqi - \(2 \* var\(--xc-page-gutter\)\)\)\);/);
        // Anchored at the end edge with a gutter, never edge to edge.
        expect(panel).toMatch(/margin-inline-start:\s*auto;/);
        expect(panel).toMatch(/margin-inline-end:\s*var\(--xc-page-gutter\);/);
        expect(panel).not.toMatch(/inline-size:\s*100cqi/);
        expect(panel).not.toMatch(/margin-inline:\s*0/);
        // The wide block keeps the floating shape from the 640px block: all four rounded
        // corners, the border and the shadow, and a gutter above and below.
        expect(wide).not.toMatch(/border-radius:\s*0 0/);
        expect(wide).not.toMatch(/margin-block-start:\s*var\(--xc-wallet-menu-bar-h\);/);
        const mid = source.slice(source.indexOf('@container wallet-menu (min-width: 640px)'), source.indexOf('@container wallet-menu (min-width: 800px)'));
        expect(mid).toMatch(/border-radius:\s*var\(--xc-radius-lg\);/);
        expect(mid).toMatch(/margin-block-start:\s*calc\(var\(--xc-wallet-menu-bar-h\) \+ var\(--xc-space-2\)\);/);
        expect(source).toMatch(/\.panel\s*\{[^}]*box-shadow:\s*var\(--xc-shadow-md\);/);
    });

    it('scrolls inside the sheet and never blocks wheel or touch input', () => {
        const rule = (selector) => {
            const match = source.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`));
            return match ? match[1] : '';
        };
        // The panel is capped at the viewport less the gutters and the scroller inside it takes the rest.
        const mid = source.slice(source.indexOf('@container wallet-menu (min-width: 640px)'));
        expect(mid).toMatch(/max-block-size:\s*calc\(var\(--xc-viewport-h, 100vh\) - var\(--xc-wallet-menu-bar-h\) - \(2 \* var\(--xc-space-2\)\)\);/);
        expect(rule('.walletSurface')).toMatch(/overflow-y:\s*auto;/);
        expect(rule('.walletSurface')).toMatch(/min-block-size:\s*0;/);
        // touch-action: pan-y would block pinch zoom, which the touch-action smoke forbids; the default scrolls it.
        expect(rule('.walletSurface')).not.toMatch(/touch-action/);
        // Nothing in the menu's own CSS turns scrolling off.
        expect(rule('.walletSurface')).not.toMatch(/overflow(-y)?:\s*(hidden|clip)/);
    });

    it('runs the boxes two across, then four across from 800px (layout 1)', () => {
        expect(source).toMatch(/\.walletGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
        expect(source).toMatch(
            /@container wallet-menu \(min-width: 640px\)[\s\S]*?\.walletGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(max-content, 1fr\)\);/,
        );
        expect(source).toMatch(
            /@container wallet-menu \(min-width: 800px\)\s*\{[\s\S]*?\.panel\.menuPanel\s*\{[^}]*max-inline-size:\s*var\(--xc-wallet-menu-four-col-w\);[\s\S]*?\.walletGrid\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\);[^}]*align-items:\s*stretch;/,
        );
        // Heading and rows sit 8px from the box edge.
        expect(source).toMatch(/@container wallet-menu \(min-width: 800px\)[\s\S]*?\.walletGroupHead\s*\{[^}]*padding:\s*var\(--xc-space-2\) var\(--xc-space-2\) var\(--xc-space-1\);/);
        // Four across is the widest layout; no 3 or 6 column step remains.
        expect(source).not.toMatch(/repeat\((3|6), minmax\(0, 1fr\)\)/);
        expect(source).not.toMatch(/min-width: (1100|1700)px/);
        // Boxes flow in menu order: no named areas to leave holes or stretch rows.
        expect(source).not.toMatch(/grid-template-areas|grid-area:/);
    });

    it('keeps every gap in the menu panel at the 8px token', () => {
        const rule = (selector) => {
            const match = source.match(new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`));
            return match ? match[1] : '';
        };
        expect(rule('.walletSurface')).toMatch(/gap:\s*var\(--xc-space-2\);/);
        expect(rule('.walletSurface')).toMatch(/padding:\s*var\(--xc-space-2\);/);
        expect(rule('.walletGrid')).toMatch(/gap:\s*var\(--xc-space-2\);/);
        expect(rule('.walletGrid')).toMatch(/align-items:\s*start;/);
        expect(rule('.walletGrid')).toMatch(/align-content:\s*start;/);
        // The footer is gone: Settings is a row and Lock wallet a header button.
        expect(source).not.toMatch(/walletFooter/);
        expect(rule('.lock')).toMatch(/width:\s*var\(--xc-control-h-md\);/);
        expect(rule('.menuHeader')).toMatch(/padding-block-end:\s*0;/);
        expect(rule('.menuHeader')).toMatch(/border-block-end:\s*0;/);
        // No breakpoint block narrows or widens a menu gap or padding to another token.
        const menuBlocks = source.slice(source.indexOf('.walletSurface {'));
        const gaps = menuBlocks.match(/\bgap:[^;]+;/g) || [];
        expect(gaps.filter((g) => !/gap:\s*var\(--xc-space-2\);/.test(g) && !/gap:\s*var\(--xc-space-2\) var\(--xc-space-2\);/.test(g)))
            .toEqual([]);
        expect(menuBlocks).not.toMatch(/\.walletSurface\s*\{[^}]*padding:[^;]*space-(1|3)\b/);
    });

    it('keeps Lock and Close 8px apart with the app toolbar token at every width', () => {
        const menuActions = source.match(/\.menuActions\s*\{([^}]*)\}/)?.[1] || '';
        const appToolbar = appHeaderSource.match(/\.right\s*\{([^}]*)\}/)?.[1] || '';

        expect(tokensSource).toMatch(/--xc-space-2:\s*8px;/);
        expect(appToolbar).toMatch(/gap:\s*var\(--xc-space-2\);/);
        expect(menuActions).toMatch(/display:\s*flex;/);
        expect(menuActions).toMatch(/gap:\s*var\(--xc-space-2\);/);
        expect(source.match(/\.menuActions\s*\{/g)).toHaveLength(1);
    });

    it('lets the wide menu panel use its content height up to the viewport cap', () => {
        expect(source).toMatch(
            /@container wallet-menu \(min-width: 640px\)[\s\S]*?\.panel\.menuPanel\s*\{[^}]*align-self:\s*flex-start;[^}]*block-size:\s*auto;[^}]*max-block-size:\s*calc\(/,
        );
    });

    it('fits the whole menu in short phone sheets with 8px side margins', () => {
        // Rows share the height the sheet has left, between 32px and 40px, so Settings and Lock wallet always show.
        expect(source).toMatch(/@media \(max-height: 700px\)\s*\{\s*@container wallet-menu not \(min-width: 640px\)/s);
        expect(source).toMatch(/--xc-wallet-menu-row-h:\s*clamp\(32px, calc\(\(var\(--xc-viewport-h, 100vh\) - 136px\) \/ 13\), 40px\);/);
        expect(source).toMatch(/@media \(max-height: 700px\)[\s\S]*?\.walletSurface\s*\{[^}]*padding:\s*var\(--xc-space-2\);/);
        expect(source).toMatch(/@media \(max-height: 700px\)[\s\S]*?\.walletGroupList \.walletRow\s*\{[^}]*--xc-button-height:\s*var\(--xc-wallet-menu-row-h\);[^}]*min-block-size:\s*var\(--xc-wallet-menu-row-h\);/);
    });

    it('reserves no scrollbar lane, so both side margins match', () => {
        expect(source).toMatch(/\.menuPanel \.walletSurface\s*\{[^}]*scrollbar-gutter:\s*auto;/);
    });

    it('scrolls the whole panel body as one area with no inner scroller or pinned footer', () => {
        const body = (selector) => {
            const match = source.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`));
            return match ? match[1] : '';
        };
        expect(body('.walletSurface')).toMatch(/overflow-y:\s*auto/);
        expect(body('.walletSurface')).toMatch(/overscroll-behavior:\s*contain/);
        expect(body('.walletGrid')).not.toMatch(/overflow|scrollArea/);
        expect(source).not.toMatch(/\.walletGrid\s*\{[^}]*composes:/);
    });

    it('uses only the shared focus-visible ring on the search box', () => {
        expect(source).toMatch(/\.input:focus\s*\{[^}]*box-shadow:\s*none;/s);
        expect(source).not.toMatch(/\.input:focus\s*\{[^}]*0 0 0 3px var\(--xc-focus-ring\)/s);
    });

    it('adds the top safe-area inset back to the phone sheet height', () => {
        const fullViewportBlockSize =
            /calc\(var\(--xc-viewport-h, 100vh\) \+ env\(safe-area-inset-top, 0px\)\)/;

        expect(source).toMatch(
            new RegExp(`\\.overlay\\.menuOverlay\\s*\\{[^}]*max-block-size:\\s*${fullViewportBlockSize.source}`, 's'),
        );
        expect(source).toMatch(
            new RegExp(
                `\\.panel\\.menuPanel\\s*\\{[^}]*block-size:\\s*${fullViewportBlockSize.source};[^}]*max-block-size:\\s*${fullViewportBlockSize.source}`,
                's',
            ),
        );
    });

    it('outlines the keyboard-focused row with the shared focus token', () => {
        expect(source).toMatch(
            /\.walletGroupList \.walletRow\[data-wallet-menu-focused\]\s*\{[^}]*outline:\s*2px solid var\(--xc-focus-ring\);[^}]*outline-offset:\s*-2px;/,
        );
    });

    it('preserves row, current-row, and keyboard-focus edges in forced colors', () => {
        expect(source).toMatch(
            /@media \(forced-colors: active\)\s*\{[\s\S]*?\.walletGroupList \.walletRow\s*\{[^}]*border-color:\s*Canvas;/,
        );
        expect(source).toMatch(
            /@media \(forced-colors: active\)\s*\{[\s\S]*?\.walletGroupList \.walletRowActive\s*\{[^}]*border-color:\s*Highlight;/,
        );
        expect(source).toMatch(
            /@media \(forced-colors: active\)\s*\{[\s\S]*?\.walletGroupList \.walletRow\[data-wallet-menu-focused\]\s*\{[^}]*outline:\s*2px solid Highlight;/,
        );
    });

    it('uses standard row separators, chevrons, and whole-word wrapping', () => {
        expect(source).toMatch(/\.walletGroupList > li \+ li\s*\{[^}]*border-block-start:\s*1px solid var\(--xc-border\);/s);
        expect(source).toMatch(/\.groupList > li \+ li\s*\{[^}]*border-block-start:\s*1px solid var\(--xc-border\);/s);
        expect(source).toMatch(/\.rowChevron\s*\{[^}]*--xc-icon-size:\s*32px;[^}]*width:\s*calc\(var\(--xc-icon-size\) \/ 3\);/s);
        expect(source).toMatch(/\.rowTitle\s*\{[^}]*white-space:\s*normal;[^}]*word-break:\s*normal;/s);
        expect(source).toMatch(/\.walletRowLabel\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s);
        expect(source).not.toMatch(/\.row(Title|Subtitle)\s*\{[^}]*text-overflow:\s*ellipsis;/s);
    });
});
