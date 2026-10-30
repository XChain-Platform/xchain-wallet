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
        const sources = [
            read('packages/core/src/shared/components/LeftNav.jsx'),
            read('packages/core/src/shared/routes/MenuRoute.jsx'),
            read('packages/core/src/shared/commandPalette/commandRegistry.js'),
        ];

        for (const source of sources) {
            expect(source).toMatch(/(?:label|title): 'Marketplace'[^\n]*Icon: Icon\.LineChartIcon/);
        }
        expect(sources[0]).toMatch(/label: 'Dispensers'[^\n]*Icon: Icon\.DollarIcon/);
        expect(sources[2]).toMatch(/title: 'Dispensers'[^\n]*Icon: Icon\.DollarIcon/);
    });

    it('hides the Search shortcut hint for touch input', () => {
        const css = read('packages/core/src/shared/components/AppHeader.module.css');

        expect(css).toMatch(
            /@media \(pointer: coarse\), \(hover: none\)\s*\{\s*\.shortcut\s*\{[^}]*display:\s*none/,
        );
    });
});
