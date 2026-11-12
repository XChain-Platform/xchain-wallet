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

describe('wallet menu CSS layout contracts', () => {
    it('lays the six groups out two across on phones and three across on wide panels', () => {
        expect(source).toMatch(
            /\.walletGrid\s*\{[^}]*grid-template-areas:\s*'wallet assets'\s*'trade earn'\s*'people actions'/s,
        );
        expect(source).toMatch(
            /@container wallet-menu \(min-width: 640px\)[\s\S]*?\.walletGrid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(max-content, 1fr\)\);[^}]*grid-template-areas:\s*'wallet assets trade'\s*'earn people actions'/,
        );
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
        expect(source).toMatch(/@media \(max-height: 700px\)[\s\S]*?\.walletSurface\s*\{[^}]*padding:\s*var\(--xc-space-1\) var\(--xc-space-2\);/);
        expect(source).toMatch(/@media \(max-height: 700px\)[\s\S]*?\.walletGroupList \.walletRow,[\s\S]*?\.walletFooter \.walletFooterRow\s*\{[^}]*--xc-button-height:\s*var\(--xc-wallet-menu-row-h\);[^}]*min-block-size:\s*var\(--xc-wallet-menu-row-h\);/);
    });

    it('reserves no scrollbar lane, so both side margins match', () => {
        expect(source).toMatch(/\.menuPanel \.walletSurface,\s*\.menuPanel \.walletGrid\s*\{[^}]*scrollbar-gutter:\s*auto;/);
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
            /\.walletGroupList \.walletRow\[data-wallet-menu-focused\],[\s\S]*?\.walletFooter \.walletFooterRow\[data-wallet-menu-focused\]\s*\{[^}]*outline:\s*2px solid var\(--xc-focus-ring\);[^}]*outline-offset:\s*-2px;/,
        );
    });

    it('preserves row, current-row, and keyboard-focus edges in forced colors', () => {
        expect(source).toMatch(
            /@media \(forced-colors: active\)\s*\{[\s\S]*?\.walletGroupList \.walletRow,[\s\S]*?\.walletFooter \.walletFooterRow\s*\{[^}]*border-color:\s*Canvas;/,
        );
        expect(source).toMatch(
            /@media \(forced-colors: active\)\s*\{[\s\S]*?\.walletGroupList \.walletRowActive,[\s\S]*?\.walletFooter \.walletRowActive\s*\{[^}]*border-color:\s*Highlight;/,
        );
        expect(source).toMatch(
            /@media \(forced-colors: active\)\s*\{[\s\S]*?\.walletGroupList \.walletRow\[data-wallet-menu-focused\],[\s\S]*?\.walletFooter \.walletFooterRow\[data-wallet-menu-focused\]\s*\{[^}]*outline:\s*2px solid Highlight;/,
        );
    });
});
