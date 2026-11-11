// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { withEnglishCopy } from '../../helpers/englishSource.js';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => withEnglishCopy(readFileSync(join(process.cwd(), path), 'utf8'));

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

describe('device finding fixes', () => {
    it('keeps the More sheet close focus ring inside the padded header', () => {
        const css = read('packages/core/src/shared/components/OverlaySurface.module.css');

        expect(rule(css, '.sheet .header')).toMatch(/padding-inline:\s*var\(--xc-space-4\)/);
    });

    it('distinguishes Marketplace from Dispensers in every navigation registry', () => {
        const leftNav = read('packages/core/src/shared/components/LeftNav.jsx');
        const walletMenu = read('packages/core/src/shared/walletMenu.js');
        const commandRegistry = read('packages/core/src/shared/commandPalette/commandRegistry.js');

        for (const source of [leftNav, commandRegistry]) {
            expect(source).toMatch(/Icon: Icon\[(?:row|item)\.icon\]/);
            expect(source).toMatch(/walletMenu/);
        }
        expect(walletMenu).toMatch(/id: 'market-activity'[^\n]*icon: 'LineChartIcon'/);
        expect(walletMenu).toMatch(/id: 'dispensers-list'[^\n]*icon: 'DollarIcon'/);
    });

    it('hides the menu shortcut hint for touch input', () => {
        const css = read('packages/core/src/shared/commandPalette/CommandPalette.module.css');

        expect(rule(css, '.menuPanel .escHint')).toMatch(/display:\s*none/);
        expect(css).toMatch(
            /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*(?:@supports [^{]+\{\s*)?@container wallet-menu \(min-width: 640px\)\s*\{\s*\.menuPanel \.escHint\s*\{[^}]*display:\s*inline-flex/,
        );
    });
});
